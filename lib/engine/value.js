'use strict';
/* 价值优先级分析：对每个需求计算 0~100 价值分 + 优先级 P0/P1/P2 + 理由 + 建议行动。
   维度：价值大小(35) + 频率(15) + 耗时投入(15) + 影响维度(12) + 自动化潜力(15) + 参与人数(8) */

const { assess } = require('./plans');

const FREQ_SCORE = { 天: 15, 周: 12, 月: 8, 年: 4 };
const VALUE_SCORE = { 高: 35, 中: 22, 低: 10 };
const DIM_SCORE = { 收入: 3, 成本: 2.5, 客户满意度: 2.5, 库存风险: 2, 合规风险: 3, 其他: 1 };

function analyze(requirement) {
  const p = requirement.profile;
  const id = requirement.id;
  const title = requirement.title || '未命名需求';
  const created = requirement.createdAt;

  if (!p || (!p.decision && !p.sop)) {
    return { id, title, created, score: 0, level: 'P2', reasons: ['画像未完成，暂无法评估'], status: requirement.status, recommendation: '待 AI 前置澄清后评估' };
  }

  const isD = p.type === 'decision';
  const obj = isD ? p.decision : p.sop;
  const ass = assess(p);

  let score = 0;
  const parts = [];

  // 1. 价值大小 35
  const vs = obj.value && obj.value.level ? VALUE_SCORE[obj.value.level] || 15 : 8;
  score += vs;
  parts.push({ label: '价值大小', base: 35, got: vs, note: obj.value ? `业务自评：${obj.value.level}` : '价值未标注' });

  // 2. 频率 15
  const fs = obj.frequency ? FREQ_SCORE[obj.frequency.unit] || 6 : 5;
  score += fs;
  parts.push({ label: '发生频率', base: 15, got: fs, note: obj.frequency ? `每${obj.frequency.unit} ${obj.frequency.n} 次` : '频率未标注' });

  // 3. 耗时投入 15 —— 单次耗时越高，自动化省时越有价值
  const minutes = isD ? obj.timeCostMin : obj.durationMin;
  const ts = minutes ? Math.min(15, Math.round(minutes / 8)) : 4;
  score += ts;
  parts.push({ label: '耗时投入', base: 15, got: ts, note: minutes ? `单次 ${minutes} 分钟` : '单次耗时未标注' });

  // 4. 影响维度 12
  const dims = (obj.dimensions || []).filter(Boolean);
  const ds = dims.length ? Math.min(12, Math.round(dims.reduce((a, d) => a + (DIM_SCORE[d] || 1.5), 0))) : 2;
  score += ds;
  parts.push({ label: '影响维度', base: 12, got: ds, note: dims.length ? dims.join('、') : '维度未标注' });

  // 5. 自动化潜力 15
  const as = Math.round(ass.autoRate / 100 * 15);
  score += as;
  parts.push({ label: '自动化潜力', base: 15, got: as, note: `约 ${ass.autoRate}% 可自动化` });

  // 6. 参与人数 8
  const people = isD ? obj.people : obj.people;
  const ps = people ? Math.min(8, Math.round(people * 1.6)) : 2;
  score += ps;
  parts.push({ label: '参与人数', base: 8, got: ps, note: people ? `${people} 人` : '人数未标注' });

  score = Math.min(100, Math.round(score));
  const level = score >= 80 ? 'P0' : score >= 60 ? 'P1' : 'P2';

  // 理由（取贡献最大的 3 项）
  const sorted = [...parts].sort((a, b) => (b.got / b.base) - (a.got / a.base));
  const reasons = sorted.slice(0, 3).map(pt => `${pt.label}：${pt.note}（${pt.got}/${pt.base}）`);
  if (ass.effort) reasons.push(`预计投入约 ${ass.effort} 人天`);

  // 建议行动
  const recommendation =
    level === 'P0' ? `高价值、高频率、自动化潜力大（${ass.autoRate}%），建议立即立项，优先进入高级方案评审` :
    level === 'P1' ? `价值中等偏上，建议排入本季度计划，先按中级方案细化后启动` :
    `价值一般或画像信息不足，建议先补齐画像，暂缓投入或与同类需求合并评估`;

  // 项目级评估（规模/风险/工作量人月/置信度/维度）
  const assessment = assessProject(p, ass, profileCompleteness(requirement));

  return {
    id, title, created, score, level, parts, reasons, recommendation,
    status: requirement.status,
    effort: ass.effort,
    autoRate: ass.autoRate,
    type: p.type || 'unknown',
    assessment
  };
}

/* 画像完整度（同 interview.completenessOf，避免循环依赖时直接复用公式） */
function profileCompleteness(requirement) {
  const p = requirement.profile;
  if (!p) return 0;
  return p.completeness || 0;
}

/* ---------- 项目级评估 ----------
   借鉴 ReqPilot 的评估维度，但由内置规则计算：
   规模(人月) / 风险等级 / 工作量区间 / 置信度 / 6 维评估分 */
function assessProject(p, ass, completeness) {
  const effortDays = Math.max(2, ass.effort || 2);
  const pmMin = Math.max(0.5, Math.round(effortDays / 22 * 0.8 * 10) / 10);
  const pmMax = Math.max(0.5, Math.round(effortDays / 22 * 1.3 * 10) / 10);
  const projectSize = pmMax <= 1 ? '小型' : pmMax <= 3 ? '中型' : pmMax <= 6 ? '大型' : '超大型';

  // 风险分
  let risk = 0;
  if (completeness < 70) risk += 2;
  if (ass.integrations >= 5) risk += 2; else if (ass.integrations >= 3) risk += 1;
  const manualRatio = ass.totalSteps ? ass.manualSteps / ass.totalSteps : 0;
  if (manualRatio >= 0.5) risk += 1;
  let hasMissingRules = false, hasUnclearInputs = false;
  if (p.type === 'decision') {
    hasMissingRules = !(p.decision.standards || []).length || !(p.decision.actions || []).length;
    hasUnclearInputs = (p.decision.inputs || []).some(i => !i.source || !i.method);
  }
  if (hasMissingRules) risk += 1;
  if (hasUnclearInputs) risk += 1;
  const riskLevel = risk >= 4 ? '高' : risk >= 2 ? '中' : '低';

  // 置信度
  const confidence = completeness >= 85 ? '高' : completeness >= 60 ? '中' : '低';

  // 六维评估（0-100）
  const dValue = p.type === 'decision' ? p.decision.value : p.sop.value;
  const valueScore = dValue ? (VALUE_SCORE[dValue.level] || 15) : 8;
  const dims = [
    {
      key: 'business_value', name: '业务价值', score: Math.round(valueScore / 35 * 100),
      level: valueScore >= 30 ? '高' : valueScore >= 18 ? '中' : '低',
      evidence: [dValue ? `业务自评：${dValue.level}` : '价值未标注']
    },
    {
      key: 'completeness', name: '信息完整度', score: completeness,
      level: completeness >= 85 ? '高' : completeness >= 60 ? '中' : '低',
      evidence: [completeness >= 85 ? '画像齐全，可进入方案评审' : '存在待确认项，建议先补齐']
    },
    {
      key: 'automation', name: '自动化潜力', score: ass.autoRate,
      level: ass.autoRate >= 70 ? '高' : ass.autoRate >= 40 ? '中' : '低',
      evidence: [`约 ${ass.autoRate}% 环节可自动化`]
    },
    {
      key: 'complexity', name: '复杂度', score: Math.min(100, Math.round(effortDays * 4)),
      level: effortDays >= 15 ? '高' : effortDays >= 8 ? '中' : '低',
      evidence: [`预估 ${effortDays} 人天（${pmMin}~${pmMax} 人月）`]
    },
    {
      key: 'integration', name: '集成风险', score: Math.min(100, ass.integrations * 16),
      level: ass.integrations >= 5 ? '高' : ass.integrations >= 3 ? '中' : '低',
      evidence: [ass.integrations ? `涉及 ${ass.integrations} 个外部系统` : '无明确外部系统']
    },
    {
      key: 'manual_dependency', name: '人工依赖', score: Math.min(100, Math.round(manualRatio * 100)),
      level: manualRatio >= 0.5 ? '高' : manualRatio >= 0.2 ? '中' : '低',
      evidence: [p.type === 'sop' ? `${ass.manualSteps || 0} 步需人工介入` : '判断型需求，人工依赖看判断标准覆盖']
    }
  ];

  return {
    project_size: projectSize,
    risk_level: riskLevel,
    effort_pm_min: pmMin,
    effort_pm_max: pmMax,
    confidence,
    dimensions: dims,
    gaps: [
      ...(completeness < 70 ? ['画像完整度不足，关键字段待确认'] : []),
      ...(hasUnclearInputs ? ['部分输入数据来源/取数方式未确认'] : []),
      ...(hasMissingRules ? ['判断标准或对应行动不完整'] : []),
      ...(ass.integrations >= 3 ? [`跨 ${ass.integrations} 个系统集成，需逐项确认接口`] : [])
    ]
  };
}

function rankAll(requirements) {
  return requirements
    .map(r => analyze(r))
    .sort((a, b) => b.score - a.score);
}

function methodology() {
  return [
    '价值大小（35 分）：业务自评高/中/低',
    '发生频率（15 分）：次/天 > 次/周 > 次/月 > 次/年',
    '耗时投入（15 分）：单次耗时越高，自动化省时价值越大',
    '影响维度（12 分）：收入 / 合规 / 成本 / 客户满意度 / 库存风险等',
    '自动化潜力（15 分）：按取数方式或步骤类型可自动化比例估算',
    '参与人数（8 分）：涉及人数越多，协同成本越高',
    '总分 100 分：≥80 = P0（立即做），60~79 = P1（本季度做），<60 = P2（暂缓/合并）'
  ];
}

module.exports = { analyze, rankAll, methodology };
