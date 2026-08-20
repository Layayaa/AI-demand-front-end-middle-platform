'use strict';
/* 前置澄清对话引擎（内置模式）
   以《表1-单点决策拆解表》《表2-SOP流程拆解表》为提问框架，
   一次一个问题，逐步把业务模糊需求聊成结构化「需求画像」。
   阶段：type(判断类型) → decision|sop(补全字段) → confirm(确认画像) → done(可生成方案) */
const ex = require('./extract');

const STAGE_LABELS = ['确认需求类型', '补全决策画像', '补全流程画像', '确认画像', '可生成方案'];
// 5 个阶段，与 chatStageIndex 对应

function newProfile() {
  return {
    type: null, // 'decision' | 'sop'
    decision: {
      name: '', department: '', decisionMaker: '',
      frequency: null, value: null, dimensions: [],
      purpose: '', timeCostMin: null, people: null, description: '',
      inputs: [], rules: '', standards: [], actions: []
    },
    sop: {
      name: '', department: '', owner: '',
      frequency: null, value: null, dimensions: [],
      durationMin: null, people: null, purpose: '', description: '',
      steps: []
    },
    skipped: [],
    closedLists: [],
    completeness: 0
  };
}

/* ---------- 问题定义 ---------- */
const DECISION_QUESTIONS = [
  { key: 'name', label: '决策名称', prompt: '这个决策叫什么名字？一句话说清「在什么场景下做什么判断」。', hint: '例如：滞销SKU该降价、清仓还是做货损？', parse: 'name', optional: false },
  { key: 'department', label: '归属部门', prompt: '归属哪个部门/岗位？', hint: '例如：商品运营', parse: 'name', optional: true },
  { key: 'decisionMaker', label: '决策人', prompt: '谁是最终拍板人（决策人）？', hint: '例如：运营主管', parse: 'name', optional: false },
  { key: 'frequency', label: '决策频率', prompt: '这个判断多久做一次？请带上数字和单位。', hint: '例如：3次/天、1次/周、2次/月', parse: 'frequency', optional: false, chips: ['1次/天', '1次/周', '1次/月', '1次/年'] },
  { key: 'value', label: '价值大小', prompt: '这个决策的价值大小？（高 / 中 / 低）顺便说下为什么。', hint: '价值按对业务的影响估，不一定要很精确', parse: 'value', optional: false, chips: ['高', '中', '低'] },
  { key: 'dimensions', label: '业务影响维度', prompt: '影响哪些业务维度？可多选：收入 / 成本 / 客户满意度 / 库存风险 / 合规风险 / 其他。', hint: '例如：库存风险、成本', parse: 'dimensions', optional: true, chips: ['收入', '成本', '客户满意度', '库存风险', '合规风险'] },
  { key: 'purpose', label: '决策目的', prompt: '做这个决策的目的是什么（为什么做）？一句话即可。', hint: '例如：避免资金沉淀、仓储费持续增加', parse: 'purpose', optional: false },
  { key: 'timeCostMin', label: '每次耗时', prompt: '当前每次做这个判断大约耗时多少分钟？', hint: '例如：30', parse: 'minutes', optional: true },
  { key: 'people', label: '参与人数', prompt: '通常几个人参与这个判断？', hint: '例如：2', parse: 'people', optional: true },
  { key: 'description', label: '整体描述', prompt: '（可选·建议）用一段话讲下整体怎么流转：谁在什么场景 → 基于哪些信息 → 怎么分析 → 做什么判断 → 触发什么行动。', hint: '不想细说可以说"跳过"', parse: 'desc', optional: true },
  { key: 'inputs', label: '输入数据', prompt: '做判断需要哪些输入数据？请逐个说，每条包含：数据名称、来源系统、取数方式。', hint: '例如：近30天销量，来自生意参谋，定时导出。说完一条说"下一条"，全部说完说"没有了"', parse: 'input', optional: false, repeat: true },
  { key: 'rules', label: '分析规则', prompt: '拿到数据后怎么分析/计算？尽量写成步骤或公式。', hint: '建议：先算关键指标 → 再模拟各方案损益 → 后比选。例如：库存周转天数 = 当前库存 ÷ 近30天日均销量', parse: 'rules', optional: false },
  { key: 'standards', label: '判断标准', prompt: '根据分析结果怎么下判断？请逐个说，每条包含：什么情况/条件 → 得出什么结论 → 明确程度。', hint: '例如：周转天数≤60天且毛利>25% → 维持现价，明确阈值。说"没有了"结束', parse: 'standard', optional: false, repeat: true },
  { key: 'actions', label: '对应行动', prompt: '每种判断结果对应什么行动？请逐个说，每条包含：判断结果 → 谁执行 → 具体做什么 → 在哪里操作。', hint: '例如：维持现价 → 运营 → 加入推广池观察2周 → 商品后台。说"没有了"结束', parse: 'action', optional: false, repeat: true }
];

const SOP_QUESTIONS = [
  { key: 'name', label: '流程名称', prompt: '这条流程叫什么名字？', hint: '例如：商品优化建议', parse: 'name', optional: false },
  { key: 'department', label: '归属部门', prompt: '归属哪个部门？', hint: '例如：商品运营', parse: 'name', optional: true },
  { key: 'owner', label: '负责人', prompt: '流程负责人是谁？', hint: '例如：小黄', parse: 'name', optional: true },
  { key: 'frequency', label: '流程频率', prompt: '这条流程多久跑一次？请带上数字和单位。', hint: '例如：1次/天、1次/周', parse: 'frequency', optional: false, chips: ['1次/天', '1次/周', '1次/月', '1次/年'] },
  { key: 'value', label: '价值大小', prompt: '这条流程的价值大小？（高 / 中 / 低）顺便说下为什么。', hint: '价值按对业务的影响估', parse: 'value', optional: false, chips: ['高', '中', '低'] },
  { key: 'dimensions', label: '业务影响维度', prompt: '影响哪些业务维度？可多选：收入 / 成本 / 客户满意度 / 库存风险 / 合规风险 / 其他。', hint: '例如：收入、客户满意度', parse: 'dimensions', optional: true, chips: ['收入', '成本', '客户满意度', '库存风险', '合规风险'] },
  { key: 'durationMin', label: '每次耗时', prompt: '每次跑完整条流程大约多少分钟？', hint: '例如：10', parse: 'minutes', optional: true },
  { key: 'people', label: '涉及人数', prompt: '整条流程涉及几个人？', hint: '例如：5', parse: 'people', optional: true },
  { key: 'purpose', label: '流程目的', prompt: '流程目的是什么（为什么做）？一句话即可。', hint: '例如：提升商品销售，不断递进优化商品', parse: 'purpose', optional: false },
  { key: 'description', label: '整体描述', prompt: '（可选·建议）用一段话讲下整体怎么流转：什么触发 → 依次做什么 → 各步谁做 → 产出什么。', hint: '不想细说可以说"跳过"', parse: 'desc', optional: true },
  { key: 'steps', label: '步骤拆解', prompt: '请按顺序说流程的每一步。每条包含：具体动作（带执行角色）、输入、输出、耗时分钟、数据来源系统、取数方式。', hint: '例如：第1步：RPA从客服系统拉取聊天记录，输入=客服聊天记录，输出=聊天记录清单，5分钟，客服系统，API实时取。说完一条说"下一条"，全部说完说"没有了"', parse: 'step', optional: false, repeat: true }
];

const REASONS_QUESTION = {
  key: 'stepReason', label: '靠人原因',
  prompt: '这一步目前靠人做，主要原因是？（选一个最贴切的）',
  hint: '无系统支持·只能手动搬 / 有固定规则·但没配成自动 / 看数据·凭经验拍板 / 创意·沟通·谈判·异常兜底',
  parse: 'reason', optional: true,
  chips: ['无系统支持·只能手动搬', '有固定规则·但没配成自动', '看数据·凭经验拍板', '创意/沟通/谈判/异常兜底']
};

const FIELD_WEIGHTS = {
  name: 8, department: 4, decisionMaker: 5, frequency: 12, value: 12, dimensions: 8,
  purpose: 8, timeCostMin: 4, people: 3, description: 4, inputs: 10, rules: 10,
  standards: 10, actions: 8, owner: 4, durationMin: 4, steps: 14, stepReason: 2
};

/* ---------- 画像完整度 ---------- */
function completenessOf(profile) {
  const d = profile.decision, s = profile.sop;
  const total = { name: 8, department: 4, decisionMaker: 5, frequency: 12, value: 12, dimensions: 8, purpose: 8, timeCostMin: 4, people: 3, description: 4, inputs: 10, rules: 10, standards: 10, actions: 8, owner: 4, durationMin: 4, steps: 14, stepReason: 2 };
  let got = 0, all = 0;
  if (profile.type === 'decision') {
    ['name', 'department', 'decisionMaker', 'frequency', 'value', 'dimensions', 'purpose', 'timeCostMin', 'people', 'description'].forEach(k => {
      all += total[k];
      const v = d[k];
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) got += total[k];
    });
    all += total.inputs; if (d.inputs.length >= 1) got += total.inputs;
    all += total.rules; if (d.rules) got += total.rules;
    all += total.standards; if (d.standards.length >= 1) got += total.standards;
    all += total.actions; if (d.actions.length >= 1) got += total.actions;
  } else if (profile.type === 'sop') {
    ['name', 'department', 'owner', 'frequency', 'value', 'dimensions', 'durationMin', 'people', 'purpose', 'description'].forEach(k => {
      all += total[k];
      const v = s[k];
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) got += total[k];
    });
    all += total.steps; if (s.steps.length >= 1) got += total.steps;
  }
  const pct = all ? Math.min(100, Math.round(got / all * 100)) : 0;
  return pct;
}

/* ---------- 每个问题的“是否已填” ---------- */
function isFilled(profile, q) {
  const d = profile.decision, s = profile.sop;
  switch (q.key) {
    case 'inputs': return (profile.closedLists || []).includes('inputs');
    case 'standards': return (profile.closedLists || []).includes('standards');
    case 'actions': return (profile.closedLists || []).includes('actions');
    case 'steps': return (profile.closedLists || []).includes('steps');
    case 'frequency': return !!(profile.type === 'decision' ? d.frequency : s.frequency);
    case 'value': return !!(profile.type === 'decision' ? d.value : s.value);
    case 'dimensions': return (profile.type === 'decision' ? d.dimensions : s.dimensions).length >= 1;
    case 'stepReason': return s.steps.length > 0 && s.steps[s.steps.length - 1].reason;
    default: {
      const v = (profile.type === 'decision' ? d : s)[q.key];
      return v !== null && v !== undefined && v !== '';
    }
  }
}

/* ---------- 应用一条用户回答到画像 ----------
   两阶段：Phase A 精确解析当前问题；Phase B 宽容补全其他类型化字段，
   支持用户"一次回答多条信息"，不会把答非所问的内容写进文本字段。 */
function applyAnswer(profile, text) {
  const t = ex.norm(text);
  const d = profile.decision, s = profile.sop;
  const target = profile.type === 'decision' ? d : s;
  const key = currentQuestionKey(profile);

  // 靠人原因（key 形如 stepReason:2）必须在跳过词判断之前处理：
  // "无系统支持·只能手动搬"以"无"开头，会被通用跳过词误判
  if (key.startsWith('stepReason:')) {
    if (/^(跳过|没有了|没想好|不知道)$/.test(t)) return { skipped: true }; // 点"跳过"等
    const seq = parseInt(key.split(':')[1], 10);
    const step = s.steps.find(st => st.seq === seq);
    const r = ex.extractReason(t);
    if (step && r) step.reason = r; else return { unrecognized: true };
    return {};
  }

  if (ex.isStop(t)) {
    if (isRepeatable(key)) return { closed: true };
    return { skipped: true }; // 非列表问题说"没有了"也视为跳过，避免卡住
  }
  if (ex.isSkip(t)) return { skipped: true };
  // "下一条/继续"这类无信息量回答：不要写入任何字段
  if (/^(下一条|继续|再来|然后呢|然后|还有呢|还有吗)/.test(t)) return { unrecognized: true };
  // 纯确认词（对/嗯/好/可以…）不是文本字段的有效回答，避免把"对"写进"归属部门"
  if (/^(对|嗯|好|可以|是的|是|行|ok|OK|好的|没问题|对的对的|对的)$/.test(t) &&
      ['name', 'department', 'decisionMaker', 'owner', 'purpose'].includes(key)) {
    return { unrecognized: true };
  }

  // 类型判断阶段
  if (profile.stage === 'type') {
    const tp = ex.detectType(t);
    if (tp) { profile.type = tp; return { typeSet: tp }; }
    return { typeUnclear: true };
  }

  const res = {};
  let phaseBFilled = false;

  // 确认阶段：自由补充，尝试补齐空字段
  if (key === 'confirm') {
    const name = ex.extractName(t);
    if (name && (!target.name || target.name === '待确认') && !/补充|修改|改成|不对|错了|更正/.test(t)) target.name = name;
    const f = ex.extractFrequency(t);
    if (f && !target.frequency) target.frequency = f;
    const v = ex.extractValue(t);
    if (v && !target.value) target.value = v;
    const dims = ex.extractDimensions(t);
    if (dims.length && /影响|维度|涉及|关系到|主要/.test(t)) target.dimensions = [...new Set([...(target.dimensions || []), ...dims])];
    const pu = ex.extractPurpose(t);
    if (pu && !target.purpose) target.purpose = pu;
    const m = ex.extractMinutes(t);
    if (m !== null) {
      if (profile.type === 'decision') d.timeCostMin = d.timeCostMin || m;
      else s.durationMin = s.durationMin || m;
    }
    const p = ex.extractPeople(t);
    if (p !== null && !target.people) target.people = p;
    return res;
  }

  // ---- Phase A：当前问题的精确解析 ----
  switch (key) {
    case 'frequency': {
      const f = ex.extractFrequency(t);
      if (f) target.frequency = f; else res.unrecognized = true;
      break;
    }
    case 'value': {
      const v = ex.extractValue(t);
      if (v) target.value = v; else res.unrecognized = true;
      break;
    }
    case 'dimensions': {
      const dims = ex.extractDimensions(t);
      if (dims.length) target.dimensions = [...new Set([...(target.dimensions || []), ...dims])];
      else res.unrecognized = true;
      break;
    }
    case 'timeCostMin': {
      const m = ex.extractMinutes(t);
      if (m !== null) target.timeCostMin = m; else res.unrecognized = true;
      break;
    }
    case 'people': {
      const p = ex.extractPeople(t);
      if (p !== null) target.people = p; else res.unrecognized = true;
      break;
    }
    case 'inputs': {
      const item = ex.extractInput(t);
      if (item) d.inputs.push({ ...item }); else res.unrecognized = true;
      break;
    }
    case 'standards': {
      const item = ex.extractStandard(t);
      if (item) d.standards.push({ ...item }); else res.unrecognized = true;
      break;
    }
    case 'actions': {
      const item = ex.extractAction(t);
      if (item) d.actions.push({ ...item }); else res.unrecognized = true;
      break;
    }
    case 'steps': {
      const item = ex.extractStep(t);
      if (item) { item.seq = s.steps.length + 1; s.steps.push({ ...item }); }
      else res.unrecognized = true;
      break;
    }
    case 'stepReason': {
      const m = key.match(/^stepReason:(\d+)/);
      const step = m ? s.steps.find(st => st.seq === parseInt(m[1], 10)) : null;
      const r = ex.extractReason(t);
      if (step && r) step.reason = r; else res.unrecognized = true;
      break;
    }
    case 'rules': target.rules = t; break;
    case 'purpose':
      // 目的字段：只拒绝"纯数字时长/人数"或"明显在说数据来源"的回答
      if (/^\s*\d+\s*(分钟|小时|人|个人)/.test(t) || /(来自|来源|取数|数据源|系统|报表|记录|接口|API)/.test(t) || t.length > 90) res.unrecognized = true;
      else target.purpose = ex.extractPurpose(t);
      break;
    case 'name':
      if (!looksLikeOtherInfo(t)) target.name = ex.extractName(t); else res.unrecognized = true;
      break;
    case 'department':
      if (!looksLikeOtherInfo(t)) target.department = ex.extractName(t); else res.unrecognized = true;
      break;
    case 'decisionMaker':
      if (!looksLikeOtherInfo(t)) target.decisionMaker = ex.extractName(t); else res.unrecognized = true;
      break;
    case 'owner':
      if (!looksLikeOtherInfo(t)) target.owner = ex.extractName(t); else res.unrecognized = true;
      break;
    case 'durationMin': {
      const m = ex.extractMinutes(t);
      if (m !== null) target.durationMin = m; else res.unrecognized = true;
      break;
    }
    case 'description': target.description = t; break;
    default: break;
  }

  // ---- Phase B：类型化字段的宽容补全（字段为空时，且不是当前问题本身） ----
  if (!target.frequency && key !== 'frequency') {
    const f = ex.extractFrequency(t);
    if (f) { target.frequency = f; phaseBFilled = true; }
  }
  if (!target.value && key !== 'value') {
    const v = ex.extractValue(t);
    if (v) { target.value = v; phaseBFilled = true; }
  }
  if (key !== 'dimensions' && /影响|维度|涉及|关系到|主要/.test(t)) {
    const dims = ex.extractDimensions(t);
    if (dims.length) { target.dimensions = [...new Set([...(target.dimensions || []), ...dims])]; phaseBFilled = true; }
  }
  if (key !== 'timeCostMin' && key !== 'durationMin') {
    const m = ex.extractMinutes(t);
    if (m !== null) {
      if (profile.type === 'decision') d.timeCostMin = d.timeCostMin || m;
      else s.durationMin = s.durationMin || m;
      phaseBFilled = true;
    }
  }
  if (key !== 'people') {
    const p = ex.extractPeople(t);
    if (p !== null && !target.people) { target.people = p; phaseBFilled = true; }
  }

  // ---- Phase C：仍未识别且没命中任何类型化字段时，尝试补"目的"叙事字段 ----
  if (res.unrecognized && !phaseBFilled && !/^\d/.test(t)) {
    if (!target.purpose && t.length >= 4 && !/(来自|来源|取数|数据源|系统|报表|记录|接口|API)/.test(t)) {
      target.purpose = ex.extractPurpose(t);
      res.unrecognized = false;
    }
  }
  return res;
}

function isRepeatable(key) {
  return ['inputs', 'standards', 'actions', 'steps'].includes(key);
}

/* 判断回答是否明显在说别的字段（频率/价值/维度/数据来源等），用于保护短文本字段不被写脏 */
function looksLikeOtherInfo(t) {
  return /(每天|每周|每月|每年|\d+\s*次|\d+\s*[\/／]\s*(天|周|月|年)|价值|影响|维度|涉及|关系到|来自|来源|取数|数据源|系统|报表|记录|接口|API)/.test(t) && t.length > 6;
}

/* 当前正在问的问题 key（含 repeat 列表的"收集态"） */
function currentQuestionKey(profile) {
  if (profile.stage === 'type') return 'type';
  const list = profile.type === 'decision' ? DECISION_QUESTIONS : SOP_QUESTIONS;
  for (const q of list) {
    if (!isFilled(profile, q) && !profile.skipped.includes(q.key)) return q.key;
  }
  // 人工介入步骤的靠人原因（逐个问，key 带步骤序号）
  if (profile.type === 'sop') {
    const manual = profile.sop.steps.find(st => st.type === '人工介入' && !st.reason);
    if (manual && !profile.skipped.includes('stepReason:' + manual.seq)) return 'stepReason:' + manual.seq;
  }
  return 'confirm';
}

function questionByKey(profile, key) {
  const list = profile.type === 'decision' ? DECISION_QUESTIONS : SOP_QUESTIONS;
  return list.find(q => q.key === key) || null;
}

/* ---------- 构造 AI 下一条消息 ---------- */
function buildNextQuestion(profile) {
  if (profile.stage === 'type') {
    return {
      text: '我还在理解你的需求，帮我确认一下它的核心更像哪种：\n\n1. **做一个判断/决策** —— 比如：这个SKU该降价还是清仓？这单该不该退款？\n2. **跑一条流程** —— 比如：每天"收集数据 → 分析 → 出建议 → 推给运营"这样多步走。\n3. **都不太确定** —— 那继续描述场景，我来判断。\n\n回复「1」「2」或继续描述即可。',
      chips: ['1. 做判断/决策', '2. 跑一条流程', '3. 不确定'],
      stage: 'type'
    };
  }
  if (profile.type === 'decision' || profile.type === 'sop') {
    const key = currentQuestionKey(profile);
    if (key === 'confirm') {
      return { text: null, stage: 'confirm', confirm: true };
    }
    if (key.startsWith('stepReason:')) {
      const seq = parseInt(key.split(':')[1], 10);
      const step = profile.sop.steps.find(st => st.seq === seq);
      if (step) {
        return {
          text: `第 ${step.seq} 步「${step.action}」目前标注为**人工介入**，这一步目前靠人做，主要原因是？\n\n${REASONS_QUESTION.hint}`,
          chips: REASONS_QUESTION.chips.concat(['跳过']), stage: 'sop'
        };
      }
    }
    const q = questionByKey(profile, key);
    if (q) {
      let text = `${q.prompt}\n\n> ${q.hint}`;
      // 列表类问题给出当前已收集条数；所有非列表问题都补"跳过"选项
      let chips = q.chips || [];
      if (q.repeat) {
        const d = profile.decision, s = profile.sop;
        const n = key === 'inputs' ? d.inputs.length : key === 'standards' ? d.standards.length : key === 'actions' ? d.actions.length : s.steps.length;
        text = (n > 0 ? `已收集 ${n} 条，继续下一条：` : '') + text;
        text += '\n\n回复「**没有了**」即可结束这一部分。';
        chips = chips.concat(['没有了']);
      } else {
        chips = chips.concat(['跳过']);
      }
      return { text, chips, stage: profile.type };
    }
  }
  return { text: '我们先把关键信息补齐，你可以继续补充，或点击下方按钮生成三档方案。', chips: [], stage: 'confirm' };
}

/* ---------- 汇总画像（确认阶段的总结消息） ---------- */
function buildSummary(profile) {
  const L = [];
  L.push('我已按框架把你的需求梳理成下面这份**需求画像**，你看下有没有要补充或改的。\n');
  if (profile.type === 'decision') {
    const d = profile.decision;
    L.push('**类型：单点决策**（数据 → 分析 → 判断 → 行动）');
    L.push(`- **决策名称**：${d.name || '待确认'}`);
    L.push(`- **归属部门 / 决策人**：${d.department || '待确认'} / ${d.decisionMaker || '待确认'}`);
    L.push(`- **频率 / 价值**：${d.frequency ? `${d.frequency.n}次/${d.frequency.unit}` : '待确认'} / ${d.value ? d.value.level : '待确认'}`);
    L.push(`- **影响维度**：${d.dimensions.length ? d.dimensions.join('、') : '待确认'}`);
    L.push(`- **决策目的**：${d.purpose || '待确认'}`);
    if (d.timeCostMin || d.people) L.push(`- **每次耗时 / 参与人数**：${d.timeCostMin ? d.timeCostMin + ' 分钟' : '待确认'} / ${d.people ? d.people + ' 人' : '待确认'}`);
    if (d.inputs.length) {
      L.push(`- **输入数据（${d.inputs.length} 条）**：`);
      d.inputs.forEach(i => L.push(`  · ${i.name}${i.source ? `（来源：${i.source}` : ''}${i.method ? `，取数：${i.method}` : ''}${i.source || i.method ? '）' : ''}`));
    }
    if (d.rules) L.push(`- **分析规则**：${d.rules.slice(0, 120)}`);
    if (d.standards.length) {
      L.push(`- **判断标准（${d.standards.length} 条）**：`);
      d.standards.forEach(st => L.push(`  · ${st.condition} → ${st.result}${st.clarity ? `（${st.clarity}）` : ''}`));
    }
    if (d.actions.length) {
      L.push(`- **对应行动（${d.actions.length} 条）**：`);
      d.actions.forEach(a => L.push(`  · ${a.result} → ${a.who || '待确认'} ${a.what || ''}${a.where ? `（${a.where}）` : ''}`));
    }
  } else {
    const s = profile.sop;
    L.push('**类型：SOP流程**（多步骤串行流程）');
    L.push(`- **流程名称**：${s.name || '待确认'}`);
    L.push(`- **归属部门 / 负责人**：${s.department || '待确认'} / ${s.owner || '待确认'}`);
    L.push(`- **频率 / 价值**：${s.frequency ? `${s.frequency.n}次/${s.frequency.unit}` : '待确认'} / ${s.value ? s.value.level : '待确认'}`);
    L.push(`- **影响维度**：${s.dimensions.length ? s.dimensions.join('、') : '待确认'}`);
    L.push(`- **流程目的**：${s.purpose || '待确认'}`);
    if (s.durationMin || s.people) L.push(`- **每次耗时 / 涉及人数**：${s.durationMin ? s.durationMin + ' 分钟' : '待确认'} / ${s.people ? s.people + ' 人' : '待确认'}`);
    if (s.steps.length) {
      L.push(`- **步骤拆解（${s.steps.length} 步）**：`);
      s.steps.forEach(st => L.push(`  · ${st.seq}. ${st.action}${st.type ? `【${st.type}】` : ''}${st.minutes ? `（${st.minutes}分钟）` : ''}${st.source ? `，来源：${st.source}` : ''}`));
    }
  }
  L.push('\n回复「**没问题**」我就确认画像并解锁三档方案；也可以继续补充修改。');
  return L.join('\n');
}

/* 规则引擎算出的"仍缺失的标准字段"，供 LLM 模式做追问参考 */
function missingFields(profile) {
  if (!profile || profile.stage === 'type' || !profile.type) return [];
  const list = profile.type === 'decision' ? DECISION_QUESTIONS : SOP_QUESTIONS;
  return list
    .filter(q => !isFilled(profile, q) && !(profile.skipped || []).includes(q.key))
    .map(q => ({ key: q.key, label: q.label, prompt: q.prompt }));
}

/* ---------- 主入口：处理一轮对话 ---------- */
function chatTurn(requirement, userText) {
  const profile = requirement.profile || (requirement.profile = newProfile());
  const text = ex.norm(userText);

  // 阶段推进
  if (!profile.stage) profile.stage = 'type';
  if (profile.stage === 'type' && profile.type === null) {
    // 用户选择类型
    const pick = text.match(/^\s*([123])\s*$/);
    if (pick) {
      profile.type = pick[1] === '1' ? 'decision' : pick[1] === '2' ? 'sop' : null;
      if (pick[1] === '3') profile.type = null;
    } else if (text.includes('帮我判断') || text.includes('说不清') || text.includes('你帮我')) {
      profile.type = null;
    } else {
      const tp = ex.detectType(text);
      if (tp) profile.type = tp;
    }
    if (profile.type) {
      // 已从标题/表单预填的信息，不再重复提问
      const title = (requirement.title || '').replace(/^(我要|我想|做一个|建设|上线|实现|搞定)/, '').trim();
      if (title && !profile[profile.type].name) profile[profile.type].name = ex.extractName(title);
      if (requirement.department && !profile[profile.type].department) profile[profile.type].department = requirement.department;
      if (profile.type === 'decision') requirement.status = 'clarifying';
      profile.stage = profile.type;
      profile.completeness = completenessOf(profile);
      return { stageIndex: profile.type === 'decision' ? 1 : 2, stageLabel: profile.type === 'decision' ? '补全决策画像' : '补全流程画像' };
    }
    // 仍无法判断 → 让用户描述场景
    return { stageIndex: 0, stageLabel: '确认需求类型', typeUnclear: true };
  }

  // 确认阶段
  if (profile.stage === 'confirm' || currentQuestionKey(profile) === 'confirm') {
    profile.stage = 'confirm';
    if (ex.isConfirm(text) || ex.isStop(text)) {
      profile.stage = 'done';
      profile.completeness = completenessOf(profile);
      requirement.status = 'profiled';
      return { stageIndex: 4, stageLabel: '可生成方案', done: true };
    }
    // 用户补充/修改：作为自由补充
    applyAnswer(profile, text);
    profile.completeness = completenessOf(profile);
    return { stageIndex: 3, stageLabel: '确认画像', amended: true };
  }

  // 常规字段收集
  const res = applyAnswer(profile, text);
  profile.completeness = completenessOf(profile);
  if (res.closed) {
    // 列表回答"没有了"：关闭该列表（无论是否有条目）
    const k = currentQuestionKey(profile);
    if (isRepeatable(k)) {
      profile.closedLists = [...new Set([...(profile.closedLists || []), k])];
      profile.skipped = (profile.skipped || []).filter(x => x !== k);
    }
  }
  if (res.skipped) {
    const key = currentQuestionKey(profile);
    if (key && !isRepeatable(key)) profile.skipped.push(key);
    profile.skipped = [...new Set(profile.skipped)];
  }
  // 连续 2 次答不上同一问题 → 自动跳过并提示（避免死循环追问）
  if (res.unrecognized) {
    profile.askCount = profile.askCount || {};
    const k = currentQuestionKey(profile);
    if (k && !isRepeatable(k) && k !== 'confirm' && k !== 'type') {
      profile.askCount[k] = (profile.askCount[k] || 0) + 1;
      if (profile.askCount[k] >= 2) {
        profile.skipped = [...new Set([...(profile.skipped || []), k])];
        res.autoSkipped = true;
        res.unrecognized = false;
      }
    }
  } else {
    profile.askCount = {};
  }
  // 判断是否进入确认阶段
  const nextKey = currentQuestionKey(profile);
  if (nextKey === 'confirm') {
    profile.stage = 'confirm';
    requirement.status = 'analyzing';
    return { stageIndex: 3, stageLabel: '确认画像', confirmReady: true };
  }
  const stageIndex = profile.type === 'decision' ? 1 : 2;
  return {
    stageIndex,
    stageLabel: profile.type === 'decision' ? '补全决策画像' : '补全流程画像',
    unrecognized: !!res.unrecognized,
    skipped: !!res.skipped,
    listClosed: !!res.closed,
    autoSkipped: !!res.autoSkipped
  };
}

module.exports = {
  newProfile, completenessOf, chatTurn, buildNextQuestion, buildSummary,
  STAGE_LABELS, currentQuestionKey, missingFields
};
