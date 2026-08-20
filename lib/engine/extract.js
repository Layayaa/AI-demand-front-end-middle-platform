'use strict';
/* 规则化信息抽取：从业务人员的自由文本回答中提取结构化字段。
   枚举/知识源与《表1-单点决策拆解表》《表2-SOP流程拆解表》一致。 */

const SOURCES = ['金蝶云', '电商后台', '生意参谋', '客服系统', 'WMS仓储', '飞书', '钉钉', '企微', '影刀', 'Excel或本地文件', 'Excel', '本地文件', '口头或经验', '无'];
const METHODS = ['API实时取', '定时导出', 'RPA抓取', '人工提供', '拿不到·待确认', '拿不到'];
const DIMENSIONS = ['收入', '成本', '客户满意度', '库存风险', '合规风险', '其他'];

function findFirst(text, list) {
  for (const it of list) {
    if (text.includes(it)) return it;
  }
  return '';
}

function norm(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/* ---------- 需求类型：单点决策 / SOP流程 ---------- */
function detectType(text) {
  const t = norm(text);
  if (!t) return null;
  const decisionWords = ['决策', '判断', '该不该', '要不要', '选哪个', '是否', '还是', '拍板', '定夺', '决定', '审批', '要不要做'];
  const sopWords = ['流程', 'SOP', '步骤', '先', '然后', '接着', '每天都要', '每周都要', '串行', '环节', '走一遍', '一条龙', '管线',
    '下载', '导入', '拉取', '抓取', '批量', '汇总', '整理', '生成', '推送', '每天', '每周', '每月'];
  let d = 0, s = 0;
  decisionWords.forEach(w => { if (t.includes(w)) d++; });
  sopWords.forEach(w => { if (t.includes(w)) s++; });
  // 显式关键词优先
  if (t.includes('决策拆解') || t.includes('单点决策')) return 'decision';
  if (t.includes('SOP') || t.includes('流程拆解')) return 'sop';
  // 决策词包含"判断/该不该/还是"且无流程词
  if (d > s && d >= 1) return 'decision';
  if (s > d && s >= 1) return 'sop';
  if (/[0-9一二三四五六七八九十]+步/.test(t) || /步骤/.test(t)) return 'sop';
  return null;
}

/* ---------- 频率：如 "3次/天" "每周一次" ---------- */
function extractFrequency(text) {
  const t = norm(text);
  let n = '', unit = '';
  const m = t.match(/(\d+)\s*次?\s*[\/／]\s*(天|周|月|年)/);
  if (m) { n = m[1]; unit = m[2]; }
  else {
    const m2 = t.match(/(每|一)(天|周|月|年)(?:大概|约|差不多)?\s*(\d+)?\s*次?/);
    if (m2) { n = m2[3] || '1'; unit = m2[2]; }
    else if (t.includes('每天')) { n = '1'; unit = '天'; }
    else if (t.includes('每周')) { n = '1'; unit = '周'; }
    else if (t.includes('每月')) { n = '1'; unit = '月'; }
    else if (t.includes('每年')) { n = '1'; unit = '年'; }
  }
  if (unit) return { n: n || '1', unit, raw: t };
  return null;
}

/* ---------- 价值大小 ---------- */
function extractValue(text) {
  const t = norm(text);
  const idx = t.indexOf('价值');
  // 找价值后的 高/中/低
  const seg = idx >= 0 ? t.slice(idx, idx + 20) : t;
  if (seg.includes('高')) return { level: '高', reason: t };
  if (seg.includes('中')) return { level: '中', reason: t };
  if (seg.includes('低')) return { level: '低', reason: t };
  // 没有"价值"字样，看整句
  if (/价值(是|为|算)?(很)?高/.test(t)) return { level: '高', reason: t };
  if (/价值(是|为|算)?(很)?中/.test(t)) return { level: '中', reason: t };
  if (/价值(是|为|算)?(很)?低/.test(t)) return { level: '低', reason: t };
  return null;
}

/* ---------- 业务影响维度（可多选） ---------- */
function extractDimensions(text) {
  const t = norm(text);
  const found = DIMENSIONS.filter(d => t.includes(d));
  // 兼容 "客户满意" 等简写
  if (t.includes('客户满意')) found.push('客户满意度');
  if (t.includes('库存')) found.push('库存风险');
  if (t.includes('合规')) found.push('合规风险');
  if (t.includes('现金流') || t.includes('资金')) found.push('成本');
  return [...new Set(found)].filter(d => d !== '其他' || t.includes('其他'));
}

/* ---------- 分钟 / 人数 ---------- */
function extractMinutes(text) {
  const t = norm(text);
  const m = t.match(/(\d+)\s*分钟?/);
  if (m) return parseInt(m[1], 10);
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*小[时時]/);
  if (m2) return Math.round(parseFloat(m2[1]) * 60);
  return null;
}
function extractPeople(text) {
  const t = norm(text);
  const m = t.match(/(\d+)\s*个?人/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/* ---------- 数据来源系统 / 取数方式 ---------- */
function extractSource(text) {
  const t = norm(text);
  for (const s of SOURCES) {
    if (t.includes(s)) {
      if (s === 'Excel') return 'Excel或本地文件';
      if (s === '本地文件') return 'Excel或本地文件';
      return s;
    }
  }
  return '';
}
function extractMethod(text) {
  const t = norm(text);
  for (const m of METHODS) {
    if (t.includes(m)) return m === '拿不到' ? '拿不到·待确认' : m;
  }
  if (t.includes('API')) return 'API实时取';
  if (t.includes('接口')) return 'API实时取';
  if (t.includes('导出')) return '定时导出';
  if (t.includes('爬') || t.includes('抓')) return 'RPA抓取';
  if (/(人工|手动|口头|手工)/.test(t)) {
    // "人工介入/人工处理" 只是步骤类型，不是取数方式
    if (/(人工介入|人工处理)/.test(t) && !/(人工提供|人工采集|人工录入|人工填写|人工输入|人工上报|人工统计|人工整理|人工导出|人工汇总|人工核对|人肉)/.test(t)) return '';
    return '人工提供';
  }
  return '';
}

/* ---------- 步骤类型（按《类型判断指南》） ---------- */
function extractStepType(text) {
  const t = norm(text);
  // 明确写了"人工介入"优先
  if (/人工介入|需要人|人来(做|处理|核对|确认|审核)/.test(t)) return '人工介入';
  if (/(自动化|点击|填写|提交|发|推送|通知|导出|截图|下载|创建|同步|搬)/.test(t)) {
    if (/(判断|决定|审批|拍板|选|是否|多少|评估|分析后)/.test(t) && /(需|要|看情况|凭经验)/.test(t)) return '分析决策';
    return 'RPA/API自动化';
  }
  if (/(整理|汇总|计算|转换|提取|生成|清洗|核对|比对|统计)/.test(t)) return '数据信息处理';
  if (/(判断|决定|选择|是否|多少|审批|拍板|评估|结论|定夺)/.test(t)) return '分析决策';
  if (/(创意|设计|沟通|谈判|异常|兜底|确认|审核|最终)/.test(t)) return '人工介入';
  return '人工介入';
}

/* ---------- 输入数据条目：名称+来源+取数方式 ---------- */
function extractInput(text) {
  const t = norm(text);
  if (!t || t.length < 2) return null;
  const source = extractSource(t);
  const method = extractMethod(t);
  // 名称：优先取引号/书名号内，或"XX数据/报表/记录/信息"片段
  let name = '';
  const q = t.match(/[「“"']([^「”"']{2,30})[」”"']/);
  if (q) name = q[1];
  else {
    const m = t.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:数据|报表|记录|信息|清单|表|量|额|价|成本|库存|销量|毛利|评分|聊天记录|订单|价格|趋势))(?:\s|，|,|来自|从|的|$)/);
    if (m) name = m[1];
  }
  // 去掉来源/方式字样避免名称污染
  if (source) name = name.replace(source, '');
  if (method) name = name.replace(method, '');
  name = name.replace(/来自|从|获取|拉取|的/g, '').trim();
  if (!name) name = t.split(/[，,。;；]/)[0].slice(0, 20);
  return { name: name || '待确认', source, method, note: '' };
}

/* ---------- 判断标准条目：条件→结论→明确程度 ---------- */
function extractStandard(text) {
  const t = norm(text);
  if (!t || t.length < 2) return null;
  const clarity = findFirst(t, ['明确阈值', '大概范围', '凭经验']);
  let condition = '', result = '';
  // 用 → / => / ：分割
  const sep = t.match(/(?:→|=>|＝>|：|->|➡)/);
  if (sep) {
    condition = t.slice(0, sep.index).trim();
    result = t.slice(sep.index + sep[0].length).trim();
  } else {
    const m = t.match(/^(如果|当|若)?(.+?)(?:就|则|那么|，)?(.*)$/);
    if (m) { condition = m[2]; result = m[3]; }
  }
  condition = condition.replace(/^(如果|当|若|情况|条件)/, '').trim();
  result = result.replace(/^(就|则|那么|结论是|做)/, '').trim();
  // 明确程度从结果中剥离（如 "→ 同意退款，明确阈值"）
  const clarityIdx = result.search(/(明确阈值|大概范围|凭经验)/);
  if (clarityIdx >= 0) {
    if (clarityIdx === 0) result = '';
    else result = result.slice(0, clarityIdx).replace(/[，,。；;、]+$/, '').trim();
  }
  if (!result && condition) { result = '待确认'; }
  return { condition: condition || t.slice(0, 30), result: result || '待确认', clarity: clarity || '' };
}

/* ---------- 行动条目：判断结果→谁→做什么→在哪 ---------- */
function extractAction(text) {
  const t = norm(text);
  if (!t || t.length < 2) return null;
  let result = '', who = '', what = '', where = '';
  const segs = t.split(/[；;]/).map(s => s.trim()).filter(Boolean);
  const first = segs[0] || t;
  // 找执行角色
  const roleM = first.match(/(运营|客服|仓储|财务|采购|商品|主管|总监|经理|专员|店长|负责人|管理员|销售|供应链|活动|设计|法务|财务人员)/);
  // 判断结果：箭头前
  const sep = first.match(/(?:→|=>|：|->|➡)/);
  if (sep) {
    result = first.slice(0, sep.index).replace(/^(判断结果|结论|结果)/, '').trim();
    const rest = first.slice(sep.index + sep[0].length);
    if (roleM && rest.includes(roleM[1])) {
      const ri = rest.indexOf(roleM[1]);
      who = roleM[1];
      what = rest.slice(0, ri) + rest.slice(ri + roleM[1].length);
    } else {
      what = rest;
    }
    what = what.replace(/^由/, '').replace(/^(在|于)/, '').trim();
  } else {
    result = first.replace(/^(判断结果|结论|结果)/, '').trim();
    what = first;
  }
  // 清理箭头/分隔符，拆分"做什么"与"在哪操作"
  what = what.replace(/^[→=>：:\->➡\s，,]+/, '').replace(/[→=>：:\->➡\s，,]+$/, '').trim();
  const whereSplit = what.search(/[→，,]/);
  if (whereSplit > 0) {
    const maybeWhere = what.slice(whereSplit + 1).replace(/^[→=>：:\->➡\s，,]+/, '').trim();
    if (maybeWhere) { where = maybeWhere; what = what.slice(0, whereSplit).trim(); }
  }
  const whereM = what.match(/(?:在|于|提交到|发到|同步到)([^，,。；;]{2,16}(?:系统|后台|平台|表|单|群|审批|工具|ERP|WMS|企微|飞书|钉钉))/);
  if (whereM && !where) { where = whereM[1].replace(/^[在于]/, ''); what = what.replace(whereM[0], '').trim(); }
  what = what.replace(/[→=>：:\->➡，,]+$/g, '').trim();
  if (!who && roleM) who = roleM[1];
  return { result: result || '待确认', who, what: what || '待确认', where, note: '' };
}

/* ---------- 流程步骤条目 ---------- */
function extractStep(text) {
  const t = norm(text);
  if (!t || t.length < 2) return null;
  const source = extractSource(t);
  const method = extractMethod(t);
  const minutes = extractMinutes(t);
  const type = extractStepType(t);
  let action = t.replace(/^(第\d+步[:：]?|步骤\d+[:：]?|(\d+)[.、)])/, '').trim();
  // 拆分 输出
  let input = '', output = '';
  const inM = t.match(/输入(?:是|为|[:：=]|＝)?\s*[:：=]?\s*([^，,。;；]{2,30})/);
  const outM = t.match(/输出(?:是|为|[:：=]|＝)?\s*[:：=]?\s*([^，,。;；]{2,30})/);
  if (inM) input = inM[1].trim();
  if (outM) output = outM[1].trim();
  action = action.replace(/(输入(?:是|为)?[:：=]?[^，,。;；]+|输出(?:是|为)?[:：=]?[^，,。;；]+)/g, '').trim();
  action = action.replace(/来自|通过|用/g, '').trim();
  // 清理动作文本尾部噪声：重复标点、耗时、取数方式、步骤类型等（这些字段已单独抽取）
  action = action.replace(/[，,、]{2,}/g, '，')
    .replace(/[，,、]\s*(API实时取|定时导出|RPA抓取|人工提供|拿不到·待确认)\s*$/, '')
    .replace(/[，,、]\s*(人工介入|人工处理)\s*$/, '')
    .replace(/[，,、]\s*\d+\s*(分钟|小时)\s*$/, '')
    .replace(/[，,、\s]+$/, '')
    .trim();
  const trigger = t.match(/触发(?:条件)?[:：=]?\s*([^，,。;；]{2,24})/);
  return {
    seq: 0,
    action: action || '待确认',
    input, output,
    trigger: trigger ? trigger[1].trim() : '',
    type, minutes: minutes || '', source, method,
    note: '', linkedDecision: '', reason: ''
  };
}

/* ---------- 靠人原因 ---------- */
function extractReason(text) {
  const t = norm(text);
  if (/(无系统支持|只能手动)/.test(t)) return '无系统支持·只能手动搬';
  if (/(固定规则|没配成自动)/.test(t)) return '有固定规则·但没配成自动';
  if (/(经验|拍板)/.test(t)) return '看数据·凭经验拍板';
  if (/(创意|沟通|谈判|异常|兜底)/.test(t)) return '创意/沟通/谈判/异常兜底';
  return t ? t.slice(0, 24) : '';
}

/* ---------- 通用文本字段 ---------- */
function extractName(text) {
  const t = norm(text);
  if (!t) return '';
  return t.split(/[，,。;；：:]/)[0].slice(0, 30);
}
function extractPurpose(text) {
  const t = norm(text).replace(/^(目的是|目的|为了|为什么要做|因为)/, '');
  return t.slice(0, 80);
}

/* 停止词：结束某个可重复列表 */
const STOP_WORDS = ['没有了', '没啦', '没了', '没有', '就这些', '结束了', '结束', '差不多', '够了', '完事', '就这样'];
function isStop(text) {
  const t = norm(text);
  return STOP_WORDS.some(w => t === w || t.startsWith(w)) || /^(没了|没有|就这些|就这样|差不多|结束)/.test(t);
}
/* 跳过词 */
const SKIP_WORDS = ['跳过', '不知道', '没想好', '先不填', '略过', '算了吧', '无', '不重要', '随便', '不清楚', '不影响', '没什么影响', '没有影响', '不想说', '不好说'];
function isSkip(text) {
  const t = norm(text);
  return SKIP_WORDS.some(w => t === w || t.startsWith(w)) && t.length <= 12;
}
/* 确认词 */
function isConfirm(text) {
  const t = norm(text);
  return /^(没问题|可以|OK|ok|好的|对|是的|嗯|确认|就这样|行|可以了|同意|没错|正确|perfect|好)$/.test(t) ||
    t === '没问题' || t === 'ok' || t === 'OK';
}

module.exports = {
  SOURCES, METHODS, DIMENSIONS, STOP_WORDS,
  norm, findFirst,
  detectType,
  extractFrequency, extractValue, extractDimensions,
  extractMinutes, extractPeople,
  extractSource, extractMethod, extractStepType,
  extractInput, extractStandard, extractAction, extractStep,
  extractReason, extractName, extractPurpose,
  isStop, isSkip, isConfirm
};
