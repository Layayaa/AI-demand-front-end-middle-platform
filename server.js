'use strict';
/* 需求前置分析平台 · 本地服务（零依赖，node server.js 即启动）
   路由：
     GET  /                        静态页面
     GET  /api/health              健康检查
     GET  /api/settings            读取设置
     PUT  /api/settings            保存设置
     POST /api/settings/test       测试 LLM 连接
     GET  /api/knowledge/status    知识库状态
     POST /api/knowledge/test      测试知识库
     POST /api/knowledge/search    检索知识库
     GET  /api/requirements        需求列表（含价值分析）
     POST /api/requirements        新建需求
     GET  /api/requirements/:id    需求详情
     POST /api/requirements/:id/chat    AI 前置澄清对话
     POST /api/requirements/:id/plans   生成三档方案
     POST /api/requirements/:id/status  更新进度状态
     GET  /api/priority            价值优先级分析
     POST /api/data/reset          清空数据
     POST /api/data/seed           恢复示例数据
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const interview = require('./lib/engine/interview');
const plans = require('./lib/engine/plans');
const value = require('./lib/engine/value');
const llm = require('./lib/engine/llm');
const hybrid = require('./lib/engine/hybrid');
const knowledge = require('./lib/knowledge');
const { seedIfEmpty } = require('./lib/seed');
const { stripDeep, stripEmoji } = require('./lib/strip-emoji');

const PORT = process.env.PORT || 3210;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(stripDeep(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function newId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const n = String(Math.floor(Math.random() * 900) + 100);
  return `R-${ymd}-${n}`;
}

function pushHistory(req, status, note) {
  req.statusHistory = req.statusHistory || [];
  req.statusHistory.push({ status, at: new Date().toISOString(), note: note || '' });
  req.status = status;
  req.updatedAt = new Date().toISOString();
}

const STATUS_LABEL = {
  submitted: '已提交', clarifying: 'AI前置澄清中', analyzing: '画像分析中',
  profiled: '需求画像完成', planning: '方案生成中', review: '待业务评审', done: '已完成'
};

/* ---------- 澄清对话编排 ---------- */
async function chatEndpoint(req, body) {
  const message = String(body.message || '').trim();
  if (!message) return { code: 400, body: { error: '消息不能为空' } };
  const settings = db.load().settings;
  req.chat = req.chat || [];
  if (req.chat.length > 200) req.chat = req.chat.slice(-150);

  req.chat.push({ role: 'user', content: message, at: new Date().toISOString() });
  const turn = interview.chatTurn(req, message);
  const profile = req.profile;

  let aiText = null;
  let hybridSuggestions = null;
  let llmFailed = false;
  if (settings.aiMode === 'llm') {
    try {
      // 混合模式：LLM 自主追问 + 规则校验画像 + 交付前自检缺口
      const knowledgeContext = await knowledge.contextFor(
        settings,
        [req.title, req.summary, message].filter(Boolean).join('\n')
      );
      const hr = await hybrid.hybridReply(req, message, turn, settings, knowledgeContext);
      aiText = hr.text;
      hybridSuggestions = hr.suggestions || null;
    } catch (e) {
      llmFailed = true;
      console.error('[llm] 澄清调用失败，回退内置引擎:', e.message);
    }
  }
  if (!aiText) {
    if (turn.done) {
      aiText = '需求画像已确认。完整度 **' + (profile.completeness || 0) + '%**。\n\n点击右侧「**生成三档方案**」，我会输出初级、中级、高级三档，每档各含产品版与技术版，共 6 份文档。';
    } else if (turn.confirmReady || profile.stage === 'confirm') {
      aiText = interview.buildSummary(profile);
    } else if (turn.typeUnclear || (profile.stage === 'type' && !profile.type)) {
      const q = interview.buildNextQuestion(profile);
      aiText = '我还没太明白这个需求属于哪种形态。\n\n' + q.text;
    } else {
      const q = interview.buildNextQuestion(profile);
      let prefix = '';
      if (turn.autoSkipped) prefix = '这一项看起来不太好回答，我先帮你跳过，之后可以随时补充。\n\n';
      else if (turn.unrecognized) prefix = '抱歉，刚才那条信息我没能识别出来，麻烦换种说法或给个例子？\n\n';
      if (turn.skipped) prefix = '好的，这一项先跳过。\n\n';
      aiText = prefix + q.text;
    }
  }

  req.chat.push({ role: 'assistant', content: aiText, at: new Date().toISOString() });

  // 进度状态流转
  if (req.status === 'submitted' && turn.stageIndex >= 1) pushHistory(req, 'clarifying', '开始 AI 前置澄清');
  if (turn.confirmReady && req.status === 'clarifying') pushHistory(req, 'analyzing', '画像接近完整，进入确认阶段');
  if (turn.done && req.status !== 'profiled') pushHistory(req, 'profiled', '需求画像完成');

  const nq = interview.buildNextQuestion(profile);
  const suggestions = hybridSuggestions !== null ? hybridSuggestions : ((nq && nq.chips) || []);
  req.lastSuggestions = suggestions; // 供前端刷新后仍能弹出选项
  return {
    code: 200,
    body: {
      reply: aiText,
      suggestions,
      stageIndex: turn.stageIndex,
      stageLabel: turn.stageLabel,
      completeness: profile.completeness || 0,
      profile,
      status: req.status,
      statusLabel: STATUS_LABEL[req.status] || req.status,
      canGenerate: profile.stage === 'done' || profile.completeness >= 60,
      llmFailed,
      llmMode: settings.aiMode === 'llm'
    }
  };
}

/* ---------- 三档方案生成 ---------- */
async function plansEndpoint(req, body) {
  const settings = db.load().settings;
  const tiers = Array.isArray(body.tiers) && body.tiers.length
    ? body.tiers.filter(t => ['basic', 'intermediate', 'advanced'].includes(t))
    : ['basic', 'intermediate', 'advanced'];

  pushHistory(req, 'planning', '方案生成中（初/中/高级各含产品版+技术版，共 6 份）');
  const builtinAll = plans.generateAll(req);
  const result = {};
  const llmMode = settings.aiMode === 'llm';
  const profile = req.profile || {};
  const knowledgeContext = await knowledge.contextFor(
    settings,
    [
      req.title,
      req.summary,
      profile.type === 'decision' ? profile.decision && profile.decision.purpose : profile.sop && profile.sop.purpose,
      profile.type === 'decision' ? profile.decision && profile.decision.department : profile.sop && profile.sop.department
    ].filter(Boolean).join('\n')
  );

  // 三档结构：初级/中级/高级均输出产品版+技术版（共 6 份）
  const DOC_MAP = { basic: ['product', 'tech'], intermediate: ['product', 'tech'], advanced: ['product', 'tech'] };
  const jobs = [];
  tiers.forEach(tier => {
    (DOC_MAP[tier] || ['overview']).forEach(doc => jobs.push({ tier, doc }));
  });

  const modeOf = {};
  if (llmMode) {
    await Promise.all(jobs.map(async (job) => {
      try {
        const md = await llm.generateDoc(settings, req, job.tier, job.doc, knowledgeContext);
        if (!result[job.tier]) result[job.tier] = { generatedAt: new Date().toISOString() };
        result[job.tier][job.doc] = md;
        modeOf[job.tier + '.' + job.doc] = 'llm';
      } catch (e) {
        console.error('[llm] 方案生成失败，回退内置引擎:', job.tier, job.doc, e.message);
        if (!result[job.tier]) result[job.tier] = { generatedAt: new Date().toISOString() };
        result[job.tier][job.doc] = builtinAll[job.tier][job.doc];
        modeOf[job.tier + '.' + job.doc] = 'builtin';
      }
    }));
  } else {
    jobs.forEach(job => {
      if (!result[job.tier]) result[job.tier] = { generatedAt: new Date().toISOString() };
      result[job.tier][job.doc] = builtinAll[job.tier][job.doc];
      modeOf[job.tier + '.' + job.doc] = 'builtin';
    });
  }
  // 标注生成模式
  jobs.forEach(job => {
    result[job.tier]['mode_' + job.doc] = modeOf[job.tier + '.' + job.doc] || 'builtin';
  });

  req.plans = { ...req.plans, ...result };
  req.value = value.analyze(req);
  pushHistory(req, 'review', '三档方案已生成，待业务评审');

  return { code: 200, body: { plans: req.plans, value: req.value, status: req.status, statusLabel: STATUS_LABEL[req.status] } };
}

/* ---------- 静态资源 ---------- */
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  let full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const cache = ext === '.html' ? 'no-store' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

/* ---------- 路由 ---------- */
const ROUTES = [];

function route(method, pattern, handler) {
  ROUTES.push({ method, re: new RegExp('^' + pattern + '$'), handler });
}

route('GET', '/api/health', () => ({ code: 200, body: { ok: true, name: '需求前置分析平台', time: new Date().toISOString() } }));
route('GET', '/api/settings', () => ({ code: 200, body: db.load().settings }));
route('PUT', '/api/settings', async (req, body) => {
  const d = db.load();
  if (body.aiMode) d.settings.aiMode = body.aiMode === 'llm' ? 'llm' : 'builtin';
  if (body.llm) {
    d.settings.llm = {
      baseUrl: String(body.llm.baseUrl || d.settings.llm.baseUrl || 'https://api.deepseek.com'),
      apiKey: String(body.llm.apiKey !== undefined ? body.llm.apiKey : (d.settings.llm.apiKey || '')),
      model: String(body.llm.model || d.settings.llm.model || 'deepseek-chat')
    };
  }
  if (body.knowledge) {
    d.settings.knowledge = knowledge.normalizeConfig({
      knowledge: {
        ...d.settings.knowledge,
        ...body.knowledge
      }
    });
  }
  db.save();
  return { code: 200, body: d.settings };
});
route('POST', '/api/settings/test', async (req, body) => {
  const d = db.load();
  const settings = { ...d.settings, llm: { ...d.settings.llm, ...(body.llm || {}) } };
  try {
    const reply = await llm.testConnection(settings);
    return { code: 200, body: { ok: true, reply } };
  } catch (e) {
    return { code: 200, body: { ok: false, error: e.message } };
  }
});
route('GET', '/api/knowledge/status', () => ({
  code: 200,
  body: knowledge.status(db.load().settings)
}));
route('POST', '/api/knowledge/test', async (req, body) => {
  const d = db.load();
  const settings = {
    ...d.settings,
    knowledge: knowledge.normalizeConfig({
      knowledge: { ...d.settings.knowledge, ...(body.knowledge || {}) }
    })
  };
  try {
    return { code: 200, body: await knowledge.test(settings) };
  } catch (e) {
    return { code: 200, body: { ok: false, error: e.message } };
  }
});
route('POST', '/api/knowledge/search', async (req, body) => {
  const query = String(body.query || '').trim();
  if (!query) return { code: 400, body: { error: '检索词不能为空' } };
  const d = db.load();
  const settings = {
    ...d.settings,
    knowledge: knowledge.normalizeConfig({
      knowledge: { ...d.settings.knowledge, ...(body.knowledge || {}) }
    })
  };
  return { code: 200, body: await knowledge.search(settings, query) };
});

route('GET', '/api/requirements', () => {
  const d = db.load();
  const list = d.requirements.map(r => ({
    id: r.id, title: r.title, summary: r.summary, department: r.department,
    type: r.type, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    completeness: (r.profile && r.profile.completeness) || 0,
    chatCount: (r.chat || []).length,
    plans: !!(r.plans && r.plans.basic),
    value: r.value,
    demo: !!r.demo
  }));
  return { code: 200, body: list };
});
route('POST', '/api/requirements', async (req, body) => {
  const d = db.load();
  const title = String(body.title || '').trim();
  if (!title) return { code: 400, body: { error: '需求名称不能为空' } };
  const r = {
    id: newId(),
    title: title.slice(0, 60),
    summary: String(body.summary || '').trim().slice(0, 300),
    department: String(body.department || '').trim().slice(0, 30),
    type: null,
    status: 'submitted',
    statusHistory: [{ status: 'submitted', at: new Date().toISOString(), note: '业务提交需求' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    profile: interview.newProfile(),
    chat: [],
    lastSuggestions: [],
    plans: null,
    value: null,
    demo: false
  };
  // 首条 AI 欢迎语（顾问式：让业务直接描述，AI 自己判断）
  r.chat.push({
    role: 'assistant',
    content: `你好，我是你的 **AI 需求顾问**，收到需求「**${title}**」${r.department ? `（${r.department}）` : ''}。\n\n在出方案之前，我想先帮你把这个需求**聊清楚**，这样出来的方案才真正可落地。\n\n你可以直接告诉我：\n\n1. **想解决什么问题**（业务场景、现状痛点）\n2. **现在是怎么做的**（靠人判断？还是多步流程？大概多久一次？）\n3. **希望达成什么效果**\n\n不用讲究格式，想到什么说什么，我来帮你梳理成清晰的方案。`,
    at: new Date().toISOString()
  });
  d.requirements.unshift(r);
  db.save();
  return { code: 200, body: r };
});
route('GET', '/api/requirements/([^/]+)', (req) => {
  const d = db.load();
  const r = d.requirements.find(x => x.id === req.params[0]);
  if (!r) return { code: 404, body: { error: '需求不存在' } };
  return { code: 200, body: r };
});
route('POST', '/api/requirements/([^/]+)/chat', async (req, body) => {
  const d = db.load();
  const r = d.requirements.find(x => x.id === req.params[0]);
  if (!r) return { code: 404, body: { error: '需求不存在' } };
  const out = await chatEndpoint(r, body);
  db.save();
  return out;
});
route('POST', '/api/requirements/([^/]+)/plans', async (req, body) => {
  const d = db.load();
  const r = d.requirements.find(x => x.id === req.params[0]);
  if (!r) return { code: 404, body: { error: '需求不存在' } };
  if (!r.profile || (!r.profile.decision && !r.profile.sop) || !r.profile.type) {
    return { code: 400, body: { error: '需求画像尚未完成，请先完成 AI 前置澄清' } };
  }
  const out = await plansEndpoint(r, body || {});
  db.save();
  return out;
});
route('POST', '/api/requirements/([^/]+)/status', (req, body) => {
  const d = db.load();
  const r = d.requirements.find(x => x.id === req.params[0]);
  if (!r) return { code: 404, body: { error: '需求不存在' } };
  const s = String(body.status || '');
  if (!STATUS_LABEL[s]) return { code: 400, body: { error: '非法状态' } };
  pushHistory(r, s, body.note || '业务更新进度');
  db.save();
  return { code: 200, body: { status: r.status, statusHistory: r.statusHistory } };
});

route('GET', '/api/priority', () => {
  const d = db.load();
  return { code: 200, body: { items: value.rankAll(d.requirements), methodology: value.methodology() } };
});
route('GET', '/api/requirements/([^/]+)/documents/([^/]+)/(overview|product|tech)/download', (req) => {
  const d = db.load();
  const r = d.requirements.find(x => x.id === req.params[0]);
  if (!r) return { code: 404, body: { error: '需求不存在' } };
  const tier = req.params[1];
  const doc = req.params[2];
  if (!r.plans || !r.plans[tier] || !r.plans[tier][doc]) {
    return { code: 404, body: { error: '文档不存在，请先生成三档方案' } };
  }
  const docx = require('./lib/docx');
  const tierLabel = { basic: '初级方案', intermediate: '中级方案', advanced: '高级方案' }[tier] || tier;
  const docLabel = doc === 'product' ? '产品版' : doc === 'tech' ? '技术版' : '速览';
  const md = stripEmoji(r.plans[tier][doc]);
  const meta = `需求前置分析平台 · 自动生成 · ${r.title} · 生成于 ${new Date(r.plans[tier].generatedAt || Date.now()).toLocaleString('zh-CN')}`;
  const buf = docx.mdToDocx(md, `${tierLabel}${doc === 'product' || doc === 'tech' ? ' · ' + docLabel : ' · 速览'}：${r.title}`, meta);
  const fname = encodeURIComponent(`${r.title}_${tierLabel}_${docLabel}.docx`);
  return {
    code: 200,
    body: buf,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${fname}`
    }
  };
});
route('POST', '/api/data/reset', () => {
  db.reset();
  return { code: 200, body: { ok: true } };
});
route('POST', '/api/data/seed', () => {
  db.reset();
  seedIfEmpty();
  return { code: 200, body: { ok: true } };
});

/* ---------- HTTP 入口 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    let body = {};
    try {
      if (method === 'POST' || method === 'PUT') body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: '请求体解析失败' });
    }
    for (const rt of ROUTES) {
      if (rt.method !== method) continue;
      const m = pathname.match(rt.re);
      if (!m) continue;
      req.params = m.slice(1);
      try {
        const out = await rt.handler(req, body);
        if (Buffer.isBuffer(out.body)) {
          res.writeHead(out.code || 200, out.headers || { 'Content-Type': 'application/octet-stream' });
          res.end(out.body);
          return;
        }
        return sendJson(res, out.code, out.body);
      } catch (e) {
        console.error('[server] 路由错误:', e);
        return sendJson(res, 500, { error: '服务器内部错误: ' + e.message });
      }
    }
    return sendJson(res, 404, { error: '接口不存在' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  seedIfEmpty();
  console.log('──────────────────────────────────────────────');
  console.log('  需求前置分析平台已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log('  (Ctrl+C 停止)');
  console.log('──────────────────────────────────────────────');
});
