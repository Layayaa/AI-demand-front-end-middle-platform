'use strict';

/*
 * 可插拔知识库层。
 *
 * 核心业务只依赖 search()/contextFor()，不依赖具体检索引擎：
 * - local：挂载本地目录，零依赖关键词检索；
 * - ragflow：调用 RAGFlow /api/v1/retrieval；
 * - http：调用任意约定为 POST JSON 的检索服务。
 *
 * 知识库默认关闭。检索失败只返回空上下文，不阻断提需、澄清和方案生成。
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DEFAULT_MOUNT_PATH = path.join(ROOT_DIR, 'knowledge');
const TEXT_EXTS = new Set(['.md', '.txt', '.markdown', '.json', '.csv', '.yaml', '.yml', '.log']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 300;

function defaults() {
  return {
    enabled: false,
    provider: 'local',
    mountPath: DEFAULT_MOUNT_PATH,
    baseUrl: '',
    searchUrl: '',
    apiKey: '',
    datasetId: '',
    topK: 5,
    maxChars: 6000
  };
}

function config(settings) {
  return { ...defaults(), ...((settings && settings.knowledge) || {}) };
}

function numberInRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function normalizeConfig(settings) {
  const cfg = config(settings);
  return {
    ...cfg,
    enabled: cfg.enabled === true,
    provider: ['local', 'ragflow', 'http'].includes(cfg.provider) ? cfg.provider : 'local',
    mountPath: String(cfg.mountPath || DEFAULT_MOUNT_PATH),
    baseUrl: String(cfg.baseUrl || '').replace(/\/+$/, ''),
    searchUrl: String(cfg.searchUrl || '').replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || ''),
    datasetId: String(cfg.datasetId || ''),
    topK: numberInRange(cfg.topK, 5, 1, 20),
    maxChars: numberInRange(cfg.maxChars, 6000, 1000, 20000)
  };
}

function supportedFile(filePath) {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

function walk(dir, out, depth = 0) {
  if (out.length >= MAX_FILES || depth > 6) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else if (entry.isFile() && supportedFile(full)) out.push(full);
  }
}

function readLocalDocuments(mountPath) {
  const root = path.resolve(mountPath);
  if (!fs.existsSync(root)) {
    return { root, exists: false, documents: [] };
  }
  const files = [];
  walk(root, files);
  const documents = [];
  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) continue;
      const text = path.extname(filePath).toLowerCase() === '.json' ? prettyJson(raw) : raw;
      documents.push({
        source: path.relative(root, filePath) || path.basename(filePath),
        title: path.basename(filePath),
        text: text.slice(0, 120000)
      });
    } catch (e) {
      // 单个文件不可读时跳过，不影响其他知识文件。
    }
  }
  return { root, exists: true, documents };
}

function prettyJson(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (e) {
    return raw;
  }
}

function queryTokens(query) {
  const text = String(query || '').toLowerCase();
  const tokens = new Set((text.match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) || []).filter(Boolean));
  const cjkRuns = text.match(/[\u4e00-\u9fff]+/g) || [];
  cjkRuns.forEach(run => {
    for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
  });
  return [...tokens].filter(token => token.length >= 2);
}

function snippet(text, tokens) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = source.toLowerCase();
  const hit = tokens.map(token => lower.indexOf(token)).filter(index => index >= 0).sort((a, b) => a - b)[0];
  if (hit === undefined) return source.slice(0, 720);
  const start = Math.max(0, hit - 220);
  return (start > 0 ? '…' : '') + source.slice(start, start + 720) + (start + 720 < source.length ? '…' : '');
}

function searchLocal(cfg, query) {
  const local = readLocalDocuments(cfg.mountPath);
  const tokens = queryTokens(query);
  const items = local.documents.map(doc => {
    const haystack = `${doc.title}\n${doc.source}\n${doc.text}`.toLowerCase();
    const score = tokens.reduce((total, token) => {
      let at = 0;
      let hits = 0;
      while ((at = haystack.indexOf(token, at)) >= 0 && hits < 20) {
        hits += 1;
        at += token.length;
      }
      return total + hits;
    }, 0) + tokens.filter(token => doc.title.toLowerCase().includes(token)).length * 5;
    return {
      title: doc.title,
      source: doc.source,
      text: snippet(doc.text, tokens),
      score
    };
  }).filter(item => item.score > 0 || !tokens.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.topK);
  return {
    provider: 'local',
    items,
    meta: { mountPath: local.root, fileCount: local.documents.length, exists: local.exists }
  };
}

function authHeaders(cfg) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  return headers;
}

async function requestJson(url, cfg, body) {
  if (!url) throw new Error('未配置知识库检索地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`知识库返回 HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const data = payload.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['chunks', 'results', 'records', 'items']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  for (const key of ['chunks', 'results', 'records', 'items']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizeRemoteRows(payload) {
  return rowsFromPayload(payload).map(row => ({
    title: String(row.document_name || row.title || row.name || row.document?.name || '知识库片段'),
    source: String(row.source || row.document_id || row.document?.id || row.url || '远程知识库'),
    text: String(row.content || row.text || row.chunk || row.highlight || row.document?.content || '').trim(),
    score: Number(row.similarity || row.score || row.vector_similarity || row.term_similarity || 0)
  })).filter(row => row.text);
}

async function searchRemote(cfg, query) {
  const url = cfg.provider === 'ragflow'
    ? `${cfg.baseUrl}/api/v1/retrieval`
    : (cfg.searchUrl || cfg.baseUrl);
  const body = cfg.provider === 'ragflow'
    ? {
      question: query,
      dataset_ids: cfg.datasetId ? [cfg.datasetId] : [],
      page: 1,
      page_size: cfg.topK,
      similarity_threshold: 0.2,
      vector_similarity_weight: 0.7,
      keyword: true,
      highlight: true
    }
    : { query, topK: cfg.topK, datasetId: cfg.datasetId || undefined };
  const payload = await requestJson(url, cfg, body);
  return {
    provider: cfg.provider,
    items: normalizeRemoteRows(payload).slice(0, cfg.topK),
    meta: { endpoint: url, datasetId: cfg.datasetId || '' }
  };
}

async function search(settings, query) {
  const cfg = normalizeConfig(settings);
  if (!cfg.enabled || !String(query || '').trim()) {
    return { provider: cfg.provider, items: [], context: '', meta: { enabled: false } };
  }
  try {
    const result = cfg.provider === 'local' ? searchLocal(cfg, query) : await searchRemote(cfg, query);
    return { ...result, context: buildContext(result.items, cfg.maxChars), meta: { ...result.meta, enabled: true } };
  } catch (error) {
    return {
      provider: cfg.provider,
      items: [],
      context: '',
      error: error.message,
      meta: { enabled: true }
    };
  }
}

async function contextFor(settings, query) {
  const result = await search(settings, query);
  return result.context || '';
}

function buildContext(items, maxChars) {
  const blocks = [];
  let total = 0;
  for (const item of items || []) {
    const block = `[${item.source || item.title || '知识库'}]\n${item.text}`;
    if (total + block.length > maxChars) {
      const remain = maxChars - total;
      if (remain > 80) blocks.push(block.slice(0, remain));
      break;
    }
    blocks.push(block);
    total += block.length;
  }
  return blocks.join('\n\n');
}

function status(settings) {
  const cfg = normalizeConfig(settings);
  if (cfg.provider === 'local') {
    const local = readLocalDocuments(cfg.mountPath);
    return {
      enabled: cfg.enabled,
      provider: cfg.provider,
      ready: local.exists,
      mountPath: local.root,
      fileCount: local.documents.length
    };
  }
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    ready: Boolean(cfg.baseUrl && (cfg.provider !== 'ragflow' || cfg.datasetId)),
    baseUrl: cfg.baseUrl,
    searchUrl: cfg.searchUrl,
    datasetId: cfg.datasetId
  };
}

async function test(settings) {
  const cfg = normalizeConfig(settings);
  if (cfg.provider === 'local') {
    const out = searchLocal(cfg, '需求 方案 产品 技术');
    return { ok: Boolean(out.meta.exists), ...out.meta, resultCount: out.items.length };
  }
  const out = await search({ knowledge: { ...cfg, enabled: true } }, '需求方案');
  return { ok: !out.error, error: out.error || '', resultCount: out.items.length, meta: out.meta };
}

module.exports = {
  defaults,
  normalizeConfig,
  search,
  contextFor,
  status,
  test,
  buildContext
};
