'use strict';
/* 三档方案生成器（内置模式）
   每个需求生成三档方案：初级(快速判断) / 中级(可评审) / 高级(完整立项)
   每档包含两版文档：产品版 + 技术版。输出 Markdown。 */

function fmtFreq(f) {
  if (!f) return '待确认';
  return `${f.n}次/${f.unit}`;
}
function fmtValue(v) {
  if (!v) return '待确认';
  return v.level + (v.reason ? `（${String(v.reason).slice(0, 40)}）` : '');
}
function escapePipe(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function or(s, fallback = '待确认') {
  return (s !== null && s !== undefined && s !== '') ? s : fallback;
}
function arrOr(a) {
  return Array.isArray(a) && a.length ? a : null;
}

const NON_SYSTEMS = ['口头或经验', '无', '待确认', ''];
function countSystems(sources) {
  return new Set(sources.filter(s => s && !NON_SYSTEMS.includes(s))).size;
}

/* ---------- 自动化潜力 / 工作量估算（价值分析也复用） ---------- */
function assess(profile) {
  if (profile.type === 'decision') {
    const d = profile.decision;
    const inputs = d.inputs || [];
    const autoMethods = inputs.filter(i => ['API实时取', '定时导出', 'RPA抓取'].includes(i.method)).length;
    const autoRate = inputs.length ? Math.round(autoMethods / inputs.length * 100) : 40;
    const integrations = countSystems(inputs.map(i => i.source));
    let effort = 2 + inputs.length * 0.5 + (d.standards || []).length * 0.5 + (d.actions || []).length * 0.3 + integrations * 0.5;
    if ((d.rules || '').length > 80) effort += 1.5;
    if (d.frequency && d.frequency.unit === '天') effort += 1;
    return { autoRate, integrations, effort: Math.max(2, Math.round(effort)), automatableSteps: null, totalSteps: null, manualSteps: null };
  }
  const s = profile.sop;
  const steps = s.steps || [];
  const total = steps.length;
  const auto = steps.filter(st => ['RPA/API自动化', '数据信息处理'].includes(st.type)).length;
  const manual = total - auto;
  const autoRate = total ? Math.round(auto / total * 100) : 40;
  const integrations = countSystems(steps.map(st => st.source));
  let effort = 2 + total * 0.8 + auto * 0.6 + manual * 0.4 + integrations * 0.4;
  if (s.frequency && s.frequency.unit === '天') effort += 1.5;
  return { autoRate, integrations, effort: Math.max(2, Math.round(effort)), automatableSteps: auto, totalSteps: total, manualSteps: manual };
}

/* ================= 产品版 ================= */

/* 旧版初级合并速览保留给历史数据兼容，新需求使用初级产品版 + 技术版。 */
function basicOverview(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const freq = isD ? D.frequency : S.frequency;
  const value = isD ? D.value : S.value;
  const dims = isD ? D.dimensions : S.dimensions;
  const purpose = isD ? D.purpose : S.purpose;
  const ass = assess(profile);
  const L = [];
  L.push(`# 初级方案 · 速览：${or(name, '需求')}`);
  L.push('');
  L.push('> 一页判断「值不值得做」。本档为产品+技术合并速览，进入中级/高级后再分产品版与技术版。');
  L.push('');
  L.push('## 一、需求定位');
  L.push('');
  L.push(`- **归属部门**：${or(isD ? D.department : S.department)}　**形态**：${isD ? '判断型（做一个决策）' : '流程型（跑一条流程）'}`);
  L.push(`- **一句话定位**：${purpose ? `解决「${String(purpose).slice(0, 60)}」` : '待业务补充目的'}`);
  L.push('');
  L.push('## 二、价值判断');
  L.push('');
  L.push(`- **频率**：${fmtFreq(freq)}　**价值大小**：${fmtValue(value)}　**影响维度**：${dims && dims.length ? dims.join(' / ') : '待确认'}`);
  if (isD) {
    L.push(`- **当前耗时**：${or(D.timeCostMin ? D.timeCostMin + ' 分钟/次' : '', '待确认')}　**参与人数**：${or(D.people ? D.people + ' 人' : '', '待确认')}`);
  } else {
    L.push(`- **当前耗时**：${or(S.durationMin ? S.durationMin + ' 分钟/次' : '', '待确认')}　**涉及人数**：${or(S.people ? S.people + ' 人' : '', '待确认')}`);
  }
  L.push('- **初步结论**：' + (value && value.level === '高' ? '价值高、频次可观，**建议立项**，进入中级方案细化。' : value && value.level === '中' ? '有一定价值，**建议做**，先以低投入方案试跑验证。' : '价值待确认，建议先与业务对齐投入产出再决定。'));
  L.push('');
  L.push('## 三、关键要点');
  L.push('');
  if (isD) {
    L.push('| 数据 | 来源系统 | 取数方式 |');
    L.push('| --- | --- | --- |');
    const inputs = arrOr(D.inputs);
    (inputs || [{ name: '待确认', source: '待确认', method: '待确认' }]).slice(0, 8).forEach(i => L.push(`| ${escapePipe(i.name)} | ${escapePipe(or(i.source, '待确认'))} | ${escapePipe(or(i.method, '待确认'))} |`));
    L.push('');
    L.push(`**判断逻辑**：${D.rules ? String(D.rules).slice(0, 90) : '待确认'}（${D.standards ? D.standards.length : 0} 条判断标准 → ${D.actions ? D.actions.length : 0} 类行动）`);
  } else {
    L.push('| 步骤 | 动作 | 类型 | 耗时 |');
    L.push('| --- | --- | --- | --- |');
    const steps = arrOr(S.steps);
    (steps || [{ seq: 1, action: '待确认', type: '待确认', minutes: '' }]).slice(0, 8).forEach(st => L.push(`| ${st.seq} | ${escapePipe(or(st.action, '待确认'))} | ${escapePipe(or(st.type, '待确认'))} | ${or(st.minutes ? st.minutes + '分' : '', '-')} |`));
    L.push('');
    L.push(`**自动化潜力**：${steps ? `${steps.filter(s => ['RPA/API自动化', '数据信息处理'].includes(s.type)).length}/${steps.length} 步可自动化` : '待确认'}`);
  }
  L.push('');
  L.push('## 四、技术快照');
  L.push('');
  L.push(`- **可自动化程度**：约 **${ass.autoRate}%**（${isD ? '按取数方式可自动化比例' : '按步骤类型可自动化比例'}估算）`);
  L.push(`- **涉及系统**：约 ${ass.integrations || '待确认'} 个（数据源见上表）`);
  L.push(`- **工作量粗估**：约 **${ass.effort} 人天**（不含业务确认与验收周期）`);
  L.push('- **主要风险**：数据口径不一致 / 系统接口缺失（无 API 需 RPA 或人工导出兜底）/ 规则覆盖不全（先覆盖高频场景）');
  L.push('');
  L.push('## 五、建议下一步');
  L.push('');
  L.push('- 与业务确认上表中的「待确认」项 → 进入**中级方案**评审（产品版 + 技术版）');
  L.push('- 若只想快速验证价值，可按本速览先做一次手工试点（1~2 周）');
  return L.join('\n');
}

function productBasic(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const purpose = isD ? D.purpose : S.purpose;
  const value = isD ? D.value : S.value;
  const freq = isD ? D.frequency : S.frequency;
  const dims = isD ? D.dimensions : S.dimensions;
  const L = [];
  L.push(`# 初级方案 · 产品版：${or(name, '需求')}`);
  L.push('');
  L.push('> 产品一页速览：帮助业务判断需求价值、目标和首期范围，适合立项前快速评审。');
  L.push('');
  L.push('## 一、需求定位');
  L.push('');
  L.push(`- **归属部门**：${or(isD ? D.department : S.department)}`);
  L.push(`- **需求形态**：${isD ? '单点决策' : 'SOP流程'}`);
  L.push(`- **要解决的问题**：${or(purpose)}`);
  L.push(`- **频率 / 业务价值**：${fmtFreq(freq)} / ${fmtValue(value)}`);
  L.push(`- **影响维度**：${dims && dims.length ? dims.join('、') : '待确认'}`);
  L.push('');
  L.push('## 二、首期目标');
  L.push('');
  L.push(isD
    ? '- 把“取数 → 分析 → 判断 → 行动”固化为可解释的辅助决策流程。'
    : '- 把高频、规则明确的流程步骤先固化，减少人工搬运、等待和漏步。');
  L.push('- 首期只覆盖画像中已确认的高频场景，未确认边界统一标记为“待确认”。');
  L.push('');
  L.push('## 三、首期范围');
  L.push('');
  if (isD) {
    L.push('| 范围 | 内容 |');
    L.push('| --- | --- |');
    L.push(`| 输入 | ${(arrOr(D.inputs) || [{ name: '待确认' }]).slice(0, 6).map(i => escapePipe(or(i.name))).join('、')} |`);
    L.push(`| 处理 | ${or(D.rules, '待确认分析规则')} |`);
    L.push(`| 输出 | ${(arrOr(D.actions) || [{ result: '待确认' }]).slice(0, 6).map(a => escapePipe(or(a.result))).join('、')} |`);
  } else {
    const steps = arrOr(S.steps) || [];
    L.push('| 首期纳入步骤 | 业务结果 |');
    L.push('| --- | --- |');
    (steps.length ? steps : [{ seq: 1, action: '待确认', output: '待确认' }]).slice(0, 8)
      .forEach(st => L.push(`| ${st.seq}. ${escapePipe(or(st.action))} | ${escapePipe(or(st.output))} |`));
  }
  L.push('');
  L.push('## 四、业务验收');
  L.push('');
  L.push(isD
    ? '- 业务能看到每次判断使用的数据、规则、结论和建议行动；关键结论可人工确认。'
    : '- 业务能看到每步状态、执行人、产出物和异常；人工步骤可接管，流程不因单点失败中断。');
  L.push('- 业务确认首期范围、验收口径和暂不覆盖的边界。');
  L.push('');
  L.push('## 五、建议决策');
  L.push('');
  L.push(value && value.level === '高'
    ? '建议进入初级技术评估，并基于试点结果决定是否升级到中级方案。'
    : value && value.level === '中'
      ? '建议先做小范围试点，验证投入产出后再进入中级方案。'
      : '建议先补齐价值、频率和验收口径，再决定是否投入建设。');
  return L.join('\n');
}

function techBasic(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const ass = assess(profile);
  const L = [];
  L.push(`# 初级方案 · 技术版：${or(name, '需求')}`);
  L.push('');
  L.push('> 技术一页速览：快速判断数据可得性、自动化路径、工作量和主要风险。');
  L.push('');
  L.push('## 一、实现判断');
  L.push('');
  L.push(`- **自动化潜力**：约 ${ass.autoRate}%`);
  L.push(`- **涉及系统**：约 ${ass.integrations || '待确认'} 个`);
  L.push(`- **工作量粗估**：约 ${ass.effort} 人天，不含跨部门确认和验收等待`);
  L.push(`- **建议技术路径**：${isD ? '数据接入 → 指标/规则计算 → 结论解释 → 行动派发 → 留痕复盘' : '触发器 → 流程编排 → 自动执行器/人工任务 → 异常兜底 → 留痕看板'}`);
  L.push('');
  L.push('## 二、数据与接入');
  L.push('');
  L.push('| 对象 | 来源/方式 | 初步判断 |');
  L.push('| --- | --- | --- |');
  if (isD) {
    const inputs = arrOr(D.inputs) || [{ name: '待确认', source: '待确认', method: '待确认' }];
    inputs.slice(0, 8).forEach(i => L.push(`| ${escapePipe(or(i.name))} | ${escapePipe(or(i.source))} / ${escapePipe(or(i.method))} | ${i.method === 'API实时取' ? '优先接口接入' : i.method === 'RPA抓取' ? '评估 RPA 稳定性' : '需确认自动获取方式'} |`));
  } else {
    const steps = arrOr(S.steps) || [{ seq: 1, action: '待确认', source: '待确认', method: '待确认', type: '待确认' }];
    steps.slice(0, 8).forEach(st => L.push(`| ${st.seq}. ${escapePipe(or(st.action))} | ${escapePipe(or(st.source))} / ${escapePipe(or(st.method))} | ${st.type === '人工介入' ? '保留人工接管' : '评估自动化执行'} |`));
  }
  L.push('');
  L.push('## 三、首期技术边界');
  L.push('');
  L.push('- 优先覆盖已有接口、稳定导出或规则明确的场景。');
  L.push('- 无接口的数据源先采用定时文件或人工上传，不在初级方案承诺深度系统改造。');
  L.push('- 数据口径、权限、异常处理和上线窗口未确认时，标记为“待确认”，不虚构实现细节。');
  L.push('');
  L.push('## 四、主要风险与下一步');
  L.push('');
  L.push('| 风险 | 影响 | 下一步 |');
  L.push('| --- | --- | --- |');
  L.push('| 数据口径不一致 | 计算或判断结果不可信 | 进入中级方案前完成字段口径确认 |');
  L.push('| 系统没有稳定接口 | 自动化收益下降 | 评估导出、RPA 或人工兜底 |');
  L.push('| 规则覆盖不全 | 异常场景仍需人工 | 先覆盖高频场景并保留人工接管 |');
  L.push('');
  L.push('建议先做技术可行性核验；核验通过后，再进入中级产品版与技术版评审。');
  return L.join('\n');
}

function productIntermediate(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const purpose = isD ? D.purpose : S.purpose;
  const L = [];
  L.push(`# 中级方案 · 产品版：${or(name, '需求')}`);
  L.push('');
  L.push('> 可评审方案：范围、流程、功能、角色、验收标准。');
  L.push('');
  L.push('## 一、背景与目标');
  L.push('');
  L.push(`- **背景**：${isD ? '业务在做' : '业务在跑'}` + `「${or(name, '待确认')}」时${isD ? '每次都要人工判断、凭经验，判断质量不稳定、无法沉淀。' : '流程靠人肉推进，步骤多、易漏、无留痕、耗时长。'}`);
  L.push(`- **目标**：${purpose ? or(purpose) : '待确认'}；同时把经验沉淀为可执行规则，降低对人的依赖。`);
  L.push(`- **衡量指标（建议）**：${isD ? '单次判断耗时下降 ≥60%、判断结果一致率 ≥90%、无漏判' : '单次流程耗时下降 ≥50%、步骤漏做率归零、全程留痕可追溯'}`);
  L.push('');
  L.push('## 二、需求范围');
  L.push('');
  L.push(`- **范围内**：${isD ? '数据自动汇集 → 规则计算 → 自动给出建议与行动清单' : '触发 → 自动执行可自动化步骤 → 人工步骤收到任务 → 结果沉淀与升级'}`);
  L.push('- **范围外（本期）**：跨系统深度改造、移动端、历史数据迁移');
  L.push('');
  L.push('## 三、改造后流程设计');
  L.push('');
  if (isD) {
    L.push('| # | 环节 | 改造前 | 改造后 |');
    L.push('| --- | --- | --- | --- |');
    L.push('| 1 | 取数 | 人工查各系统/问人 | 自动汇集（API/定时/RPA） |');
    L.push('| 2 | 分析 | 人工算、凭经验 | 规则引擎按公式自动算 |');
    L.push('| 3 | 判断 | 人拍板 | 系统按判断标准给建议+理由 |');
    L.push('| 4 | 行动 | 人记、人跟 | 自动生成行动清单并推送执行人 |');
    L.push('| 5 | 复盘 | 无沉淀 | 每次判断留痕，可回溯可优化 |');
    L.push('');
    L.push('## 四、功能清单');
    L.push('');
    const inputs = arrOr(D.inputs);
    L.push('- **F1 数据汇集**：' + (inputs ? `自动获取 ${inputs.length} 项数据（${inputs.map(i => i.name).slice(0, 5).join('、')}${inputs.length > 5 ? ' 等' : ''}）` : '待确认数据清单'));
    L.push('- **F2 规则计算**：按分析规则计算关键指标（' + (D.rules ? String(D.rules).slice(0, 50) + '…' : '待确认') + '）');
    L.push('- **F3 智能建议**：命中判断标准后给出结论 + 理由 + 置信度');
    L.push('- **F4 行动清单**：自动生成待办，指定执行人/地点，支持审批升级');
    L.push('- **F5 复盘看板**：历史判断记录、正确率、耗时趋势');
  } else {
    const steps = arrOr(S.steps) || [];
    L.push('**流程总览（改造后）**：');
    L.push('');
    steps.forEach(st => {
      const auto = ['RPA/API自动化', '数据信息处理'].includes(st.type);
      L.push(`${st.seq}. **${or(st.action, '待确认')}** ${auto ? '自动化' : '人工介入'}${st.minutes ? `（原 ${st.minutes} 分钟）` : ''}`);
    });
    L.push('');
    L.push('## 四、功能清单');
    L.push('');
    L.push('- **F1 流程编排**：按触发条件自动启动流程、按序流转');
    L.push('- **F2 自动执行器**：' + `接管 ${steps.filter(s => ['RPA/API自动化', '数据信息处理'].includes(s.type)).length}/${steps.length} 个可自动化步骤`);
    L.push('- **F3 任务中心**：人工介入步骤生成任务，推送给对应角色，超时升级');
    L.push('- **F4 留痕与看板**：每步状态、耗时、产出物全程记录');
    L.push('- **F5 异常兜底**：失败重试、人工介入通道、流程暂停/恢复');
  }
  L.push('');
  L.push('## 五、角色分工');
  L.push('');
  if (isD) {
    L.push(`| 角色 | 职责 |`);
    L.push('| --- | --- |');
    L.push(`| 业务方（${or(isD ? D.department : S.department)}） | 提供规则、验收判断标准、确认行动清单 |`);
    L.push(`| 决策人（${or(D.decisionMaker)}） | 仅处理系统无法覆盖的异常与升级审批 |`);
    L.push('| 数字化/IT | 数据接入、规则配置、看板搭建 |');
  } else {
    L.push(`| 角色 | 职责 |`);
    L.push('| --- | --- |');
    L.push(`| 业务方（${or(S.department)}） | 确认流程步骤、验收产出 |`);
    L.push(`| 负责人（${or(S.owner)}） | 流程监控、异常处理 |`);
    L.push('| 数字化/IT | 流程编排、自动执行器开发 |');
  }
  L.push('');
  L.push('## 六、验收标准（初版）');
  L.push('');
  if (isD) {
    L.push('- 自动取数成功率 ≥95%，数据口径与业务一致');
    L.push('- 规则计算输出与人工测算一致率 ≥90%');
    L.push('- 判断建议可解释：每个结论附计算依据');
    L.push('- 行动清单准确派发到人，支持一键审批');
  } else {
    L.push('- 流程按时自动触发，无漏步');
    L.push('- 自动化步骤执行成功率 ≥95%');
    L.push('- 人工步骤任务及时推送，超时自动升级');
    L.push('- 全流程可回看：每步谁做的、花了多久、产出什么');
  }
  L.push('');
  L.push('## 七、建议排期');
  L.push('');
  L.push('- **第一阶段（数据打通）**：接入数据源，跑通取数（约 40% 工作量）');
  L.push('- **第二阶段（规则与流程）**：规则引擎/流程编排开发与联调（约 40%）');
  L.push('- **第三阶段（试点与推广）**：试点业务方试用 2 周 → 调整规则 → 推广（约 20%）');
  return L.join('\n');
}

function productAdvanced(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const L = [];
  L.push(`# 高级方案 · 产品版（PRD）：${or(name, '需求')}`);
  L.push('');
  L.push('> 完整立项文档：背景、目标、角色、流程、功能详设、数据字典、异常与边界、验收、KPI。');
  L.push('');
  L.push('## 一、背景与目标');
  L.push('');
  if (isD) {
    L.push(`- **现状痛点**：${or(D.department)}在做「${or(name)}」时，需人工跨 ${D.inputs.length || '多'} 个数据源取数、手工计算、凭经验判断，单次耗时 ${or(D.timeCostMin ? D.timeCostMin + ' 分钟' : '', '待确认')}，${or(D.people ? D.people + ' 人参与' : '多人参与')}，判断结果不沉淀、无法复盘。`);
    L.push(`- **频率与价值**：${fmtFreq(D.frequency)}，价值${fmtValue(D.value)}，影响维度：${(D.dimensions || []).join('、') || '待确认'}。`);
    L.push(`- **项目目标**：${or(D.purpose)}。建设后单次判断耗时下降 ≥70%，判断一致率 ≥95%，决策留痕率 100%。`);
  } else {
    L.push(`- **现状痛点**：${or(S.department)}的「${or(name)}」流程共 ${S.steps.length || '多'} 个步骤、${or(S.people ? S.people + ' 人参与' : '多人参与')}，单次耗时 ${or(S.durationMin ? S.durationMin + ' 分钟' : '待确认')}，依赖人工衔接，易漏步、无留痕。`);
    L.push(`- **频率与价值**：${fmtFreq(S.frequency)}，价值${fmtValue(S.value)}，影响维度：${(S.dimensions || []).join('、') || '待确认'}。`);
    L.push(`- **项目目标**：${or(S.purpose)}。建设后流程耗时下降 ≥60%，漏步率归零，全程可追溯。`);
  }
  L.push('');
  L.push('## 二、用户与角色');
  L.push('');
  if (isD) {
    L.push('| 角色 | 说明 | 权限 |');
    L.push('| --- | --- | --- |');
    L.push(`| ${or(D.decisionMaker, '决策人')} | 最终拍板，处理升级审批 | 查看、审批、确认 |`);
    L.push(`| ${or(D.department, '业务方')} | 维护数据口径与判断规则 | 编辑规则、查看建议 |`);
    L.push('| 数字化管理员 | 数据源配置、规则调试 | 全部 |');
    L.push('| 系统 | 自动取数、计算、推送 | — |');
  } else {
    L.push('| 角色 | 说明 | 权限 |');
    L.push('| --- | --- | --- |');
    L.push(`| ${or(S.owner, '负责人')} | 流程监控、异常处理、任务分派 | 查看、处理、升级 |`);
    L.push(`| ${or(S.department, '业务方')} | 各步骤执行人 | 处理分配任务 |`);
    L.push('| 数字化管理员 | 流程编排、执行器配置 | 全部 |');
  }
  L.push('');
  L.push('## 三、流程与功能详设');
  L.push('');
  if (isD) {
    L.push('### 3.1 端到端流程');
    L.push('');
    L.push('`触发（频率/手动）→ 自动取数 → 数据校验 → 规则计算 → 匹配判断标准 → 生成结论+理由 → 生成行动清单 → 推送执行人 → 执行反馈 → 复盘沉淀`');
    L.push('');
    L.push('### 3.2 功能详设');
    L.push('');
    L.push('**F1 数据汇集中心**');
    L.push('');
    L.push('| 数据项 | 来源系统 | 取数方式 | 说明 |');
    L.push('| --- | --- | --- | --- |');
    const inputs = arrOr(D.inputs);
    (inputs || [{ name: '待确认', source: '待确认', method: '待确认', note: '' }]).forEach(i => L.push(`| ${escapePipe(i.name)} | ${escapePipe(or(i.source, '待确认'))} | ${escapePipe(or(i.method, '待确认'))} | ${escapePipe(i.note || '')} |`));
    L.push('');
    L.push('**F2 规则计算引擎**');
    L.push('');
    L.push(`- 分析规则：${or(D.rules, '待确认')}`);
    L.push('- 输出：关键指标计算结果、各方案模拟损益（若适用）');
    L.push('');
    L.push('**F3 判断标准匹配**');
    L.push('');
    L.push('| 情况/条件 | 判断结果 | 明确程度 |');
    L.push('| --- | --- | --- |');
    const standards = arrOr(D.standards);
    (standards || [{ condition: '待确认', result: '待确认', clarity: '待确认' }]).forEach(s => L.push(`| ${escapePipe(s.condition)} | ${escapePipe(s.result)} | ${escapePipe(s.clarity || '待确认')} |`));
    L.push('');
    L.push('**F4 行动清单与派发**');
    L.push('');
    L.push('| 判断结果 | 谁执行 | 具体做什么 | 在哪里操作 |');
    L.push('| --- | --- | --- | --- |');
    const actions = arrOr(D.actions);
    (actions || [{ result: '待确认', who: '待确认', what: '待确认', where: '待确认' }]).forEach(a => L.push(`| ${escapePipe(a.result)} | ${escapePipe(a.who || '待确认')} | ${escapePipe(a.what || '待确认')} | ${escapePipe(a.where || '待确认')} |`));
    L.push('');
    L.push('**F5 复盘看板**：历史判断 → 结果 vs 实际 → 规则命中率 → 优化建议。');
    L.push('');
    L.push('### 3.3 数据字典（节选）');
    L.push('');
    L.push('| 字段 | 类型 | 来源 | 说明 |');
    L.push('| --- | --- | --- | --- |');
    L.push('| 判断ID | string | 系统生成 | 每次判断唯一标识 |');
    L.push('| 触发时间 | datetime | 系统 | 判断发起时间 |');
    L.push('| 指标结果 | map | 规则引擎 | 关键指标计算结果 |');
    L.push('| 命中标准 | string | 匹配器 | 命中的判断标准条目 |');
    L.push('| 建议结论 | string | 匹配器 | 输出的判断结论 |');
    L.push('| 行动清单 | array | 生成器 | 派发的行动任务 |');
  } else {
    const steps = arrOr(S.steps) || [];
    L.push('### 3.1 步骤详设');
    L.push('');
    L.push('| 序号 | 具体动作 | 输入 | 触发 | 类型 | 输出 | 当前耗时 | 来源/取数 | 靠人原因 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    steps.forEach(st => L.push(`| ${st.seq} | ${escapePipe(or(st.action, '待确认'))} | ${escapePipe(st.input || '-')} | ${escapePipe(st.trigger || '-')} | ${escapePipe(or(st.type, '待确认'))} | ${escapePipe(st.output || '-')} | ${or(st.minutes ? st.minutes + '分' : '-')} | ${escapePipe(st.source ? st.source + (st.method ? '/' + st.method : '') : '-')} | ${escapePipe(st.reason || '-')} |`));
    L.push('');
    L.push('### 3.2 功能详设');
    L.push('');
    L.push('**F1 流程编排器**：配置触发条件（时间/事件/手动）→ 启动流程 → 按序调度步骤 → 状态流转（待执行/执行中/成功/失败/人工待办）。');
    L.push('**F2 自动执行器**：接管所有「RPA/API自动化」与「数据信息处理」步骤，支持失败重试 3 次、告警。');
    L.push('**F3 任务中心**：所有「人工介入」步骤生成任务卡片，推送到企微/飞书/钉钉，超时自动升级给负责人。');
    L.push('**F4 异常兜底**：步骤失败 → 暂停流程 → 通知负责人 → 可选择重试/跳过/终止。');
    L.push('**F5 留痕看板**：每次流程运行的每步：谁做的、耗时、输入输出快照、异常记录。');
    L.push('');
    L.push('### 3.3 数据字典（节选）');
    L.push('');
    L.push('| 字段 | 类型 | 来源 | 说明 |');
    L.push('| --- | --- | --- | --- |');
    L.push('| 流程实例ID | string | 编排器 | 每次运行唯一标识 |');
    L.push('| 步骤ID | string | 编排器 | 步骤唯一标识 |');
    L.push('| 步骤状态 | enum | 编排器 | 待执行/执行中/成功/失败/人工待办 |');
    L.push('| 产出物 | object | 各执行器 | 步骤输出快照 |');
    L.push('| 执行人/耗时 | string/number | 任务中心 | 人工步骤留痕 |');
  }
  L.push('');
  L.push('## 四、异常与边界');
  L.push('');
  L.push('- 数据缺失/口径变化：取数失败自动告警，规则中标注"数据不可用"降级为人工判断');
  L.push('- 规则未覆盖场景：进入人工兜底通道，同时记录案例供规则迭代');
  L.push('- 升级审批超时：自动二次提醒 → 升级到更高层');
  L.push('- 非功能边界：并发按业务频率 × 3 设计，安全按企业合规要求');
  L.push('');
  L.push('## 五、验收标准与 KPI');
  L.push('');
  L.push('| 维度 | 验收标准 | 上线后 KPI |');
  L.push('| --- | --- | --- |');
  L.push(`| 效率 | 单次${isD ? '判断' : '流程'}耗时下降 ≥60% | 持续下降，月度复盘 |`);
  L.push(`| 质量 | ${isD ? '结论与人工一致率 ≥90%' : '漏步率归零、成功率 ≥95%'} | 月度质量报告 |`);
  L.push('| 留痕 | 100% 记录可追溯 | 复盘覆盖全部案例 |');
  L.push('| 满意度 | 业务方验收通过 | 业务满意度 ≥4/5 |');
  L.push('');
  L.push('## 六、里程碑');
  L.push('');
  L.push('| 阶段 | 内容 | 里程碑 |');
  L.push('| --- | --- | --- |');
  L.push('| M1 数据打通 | 数据源接入、口径确认 | 取数跑通、业务签字 |');
  L.push('| M2 规则上线 | 规则引擎/编排器开发 | UAT 通过 |');
  L.push('| M3 试点 | 业务试点 2 周 | 试点复盘报告 |');
  L.push('| M4 推广 | 全量推广、培训 | 正式上线 |');
  return L.join('\n');
}

/* ================= 技术版 ================= */

function techIntermediate(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const ass = assess(profile);
  const L = [];
  L.push(`# 中级方案 · 技术版：${or(name, '需求')}`);
  L.push('');
  L.push('> 技术评审版：取数方案、自动化实现思路、集成点、排期。');
  L.push('');
  L.push('## 一、取数方案（逐条）');
  L.push('');
  L.push('| 数据/步骤 | 来源系统 | 取数方式 | 实现要点 |');
  L.push('| --- | --- | --- | --- |');
  if (isD) {
    const inputs = arrOr(D.inputs) || [];
    (inputs.length ? inputs : [{ name: '待确认', source: '待确认', method: '待确认' }]).forEach(i => {
      const tip = i.method === 'API实时取' ? '对接开放接口，定时任务轮询' : i.method === '定时导出' ? '配置定时导出任务，自动归档' : i.method === 'RPA抓取' ? 'RPA 流程录制，异常重试' : i.method === '人工提供' ? '表单/机器人收集，减少人工' : '待与业务确认获取通道';
      L.push(`| ${escapePipe(i.name)} | ${escapePipe(or(i.source, '待确认'))} | ${escapePipe(or(i.method, '待确认'))} | ${tip} |`);
    });
  } else {
    const steps = arrOr(S.steps) || [];
    (steps.length ? steps : [{ seq: 1, action: '待确认', source: '待确认', method: '待确认' }]).forEach(st => {
      const tip = st.type === '人工介入' ? `保留人工：${or(st.reason, '待确认原因')}` : '接入编排器自动执行';
      L.push(`| ${st.seq}. ${escapePipe(or(st.action, '待确认'))} | ${escapePipe(or(st.source, '-'))} | ${escapePipe(or(st.method, '-'))} | ${tip} |`);
    });
  }
  L.push('');
  L.push('## 二、自动化实现思路');
  L.push('');
  if (isD) {
    L.push('1. **取数层**：按取数方式适配三类通道 —— API 适配器 / 定时导出任务 / RPA 机器人，统一入临时库');
    L.push('2. **计算层**：规则引擎按分析规则计算指标，支持公式配置化，输出指标结果集');
    L.push('3. **判断层**：判断标准表（条件→结论→明确程度）规则化匹配，输出结论+理由');
    L.push('4. **行动层**：结论→行动映射表，生成待办并推送到企微/飞书/钉钉，支持审批流');
    L.push('5. **留痕层**：全链路日志与快照，支持复盘');
  } else {
    L.push('1. **编排层**：流程编排器（触发条件 → 步骤序列 → 状态机）');
    L.push('2. **执行器**：RPA/API 执行器 + 数据处理执行器（清洗、转换、计算）');
    L.push('3. **任务层**：人工介入步骤 → 任务卡片 → 消息推送 → 超时升级');
    L.push('4. **兜底层**：失败重试、告警、人工接管通道');
    L.push('5. **留痕层**：运行日志、每步快照、耗时统计');
  }
  L.push('');
  L.push('## 三、系统集成点');
  L.push('');
  L.push('| 集成对象 | 方式 | 说明 |');
  L.push('| --- | --- | --- |');
  L.push('| 消息（企微/飞书/钉钉） | Webhook/开放接口 | 任务推送、审批、通知 |');
  L.push(`| 数据源（${ass.integrations || '待确认'} 个系统） | API/定时/RPA | 数据汇集 |`);
  L.push('| 现有审批流 | 接口对接 | 升级审批闭环 |');
  L.push('');
  L.push('## 四、工作量与排期');
  L.push('');
  L.push(`- **总工作量**：约 ${ass.effort} 人天`);
  L.push(`- **排期建议**：数据打通（${Math.round(ass.effort * 0.4)} 人天）→ 规则/编排开发（${Math.round(ass.effort * 0.4)} 人天）→ 试点联调（${Math.round(ass.effort * 0.2)} 人天）`);
  L.push('- 建议 2~3 周内完成试点版本，滚动迭代');
  L.push('');
  L.push('## 五、技术风险与依赖');
  L.push('');
  L.push('- 依赖第三方系统接口可用性与稳定性（需商务/IT 确认）');
  L.push('- RPA 场景需评估环境（如影刀）与账号权限');
  L.push('- 数据质量：脏数据、口径漂移需建立校验规则');
  return L.join('\n');
}

function techAdvanced(profile) {
  const isD = profile.type === 'decision';
  const D = profile.decision, S = profile.sop;
  const name = isD ? D.name : S.name;
  const ass = assess(profile);
  const L = [];
  L.push(`# 高级方案 · 技术版（完整技术方案）：${or(name, '需求')}`);
  L.push('');
  L.push('> 立项级技术文档：总体架构、数据流、详细设计、非功能需求、实施计划、风险与回退。');
  L.push('');
  L.push('## 一、总体架构');
  L.push('');
  if (isD) {
    L.push('```');
    L.push('┌────────────────────────────────────────────────┐');
    L.push('│                 决策支持平台                     │');
    L.push('├──────────┬──────────┬──────────┬───────────────┤');
    L.push('│ 数据汇集层 │ 规则计算层 │ 判断决策层 │  行动派发层    │');
    L.push('│ API适配器 │ 指标计算  │ 标准匹配  │ 待办生成       │');
    L.push('│ 定时任务  │ 损益模拟  │ 结论生成  │ 消息推送       │');
    L.push('│ RPA机器人 │ 校验清洗  │ 理由解释  │ 审批升级       │');
    L.push('├──────────┴──────────┴──────────┴───────────────┤');
    L.push('│              留痕与复盘层（日志/快照/看板）         │');
    L.push('└────────────────────────────────────────────────┘');
    L.push('```');
    L.push('');
    L.push('## 二、数据流');
    L.push('');
    L.push('`业务数据源(API/导出/RPA) → 数据汇集层(统一口径) → 指标计算 → 判断标准匹配 → 结论+行动 → 推送执行 → 复盘沉淀`');
    L.push('');
    L.push('| 环节 | 输入 | 处理 | 输出 |');
    L.push('| --- | --- | --- | --- |');
    L.push('| 数据汇集 | 各源原始数据 | 抽取、清洗、映射 | 统一数据集 |');
    L.push('| 指标计算 | 统一数据集 | 分析规则公式化 | 关键指标 |');
    L.push('| 判断匹配 | 关键指标 | 判断标准表匹配 | 结论+理由+置信度 |');
    L.push('| 行动生成 | 结论 | 行动映射 | 待办清单 |');
    L.push('| 推送执行 | 待办清单 | 消息/审批流 | 执行记录 |');
    L.push('');
    L.push('## 三、详细设计要点');
    L.push('');
    L.push('- **规则引擎**：公式/条件可视化配置，版本化管理，灰度生效');
    L.push('- **判断标准表**：条件表达式 + 优先级 + 明确程度（明确阈值/大概范围/凭经验）');
    L.push('- **数据校验**：空值/越界/口径漂移检测，失败降级为人工并告警');
    L.push('- **留痕**：每次判断全链路 trace，支持回溯与规则迭代');
  } else {
    L.push('```');
    L.push('┌──────────────────────────────────────────────────┐');
    L.push('│                 流程自动化平台                     │');
    L.push('├───────────┬───────────┬──────────┬───────────────┤');
    L.push('│ 流程编排层  │ 自动执行器  │ 任务中心  │  监控兜底层    │');
    L.push('│ 触发管理   │ RPA/API   │ 人工任务 │ 失败重试/告警  │');
    L.push('│ 步骤状态机  │ 数据处理  │ 超时升级 │ 人工接管      │');
    L.push('├───────────┴───────────┴──────────┴───────────────┤');
    L.push('│           留痕层（运行日志/快照/耗时统计）            │');
    L.push('└──────────────────────────────────────────────────┘');
    L.push('```');
    L.push('');
    L.push('## 二、数据流');
    L.push('');
    L.push('`触发事件/定时 → 流程实例创建 → 按序执行步骤（自动/人工） → 产出物传递 → 结束/升级 → 留痕归档`');
    L.push('');
    L.push('| 环节 | 输入 | 处理 | 输出 |');
    L.push('| --- | --- | --- | --- |');
    L.push('| 触发 | 定时/事件/手动 | 规则匹配 | 流程实例 |');
    L.push('| 自动步骤 | 上游产出 | 执行器处理 | 步骤产出 |');
    L.push('| 人工步骤 | 任务卡 | 执行人处理 | 确认结果 |');
    L.push('| 升级 | 超时/异常 | 升级链 | 高层处理 |');
    L.push('');
    L.push('## 三、详细设计要点');
    L.push('');
    L.push('- **编排器**：步骤 DAG/顺序定义，状态机（待执行/执行中/成功/失败/人工待办），断点续跑');
    L.push('- **执行器**：RPA/API 执行器插件化，数据处理执行器支持清洗/转换/计算');
    L.push('- **任务中心**：任务卡 + 企微/飞书/钉钉推送 + 超时升级链（执行人→负责人→总监）');
    L.push('- **兜底**：失败自动重试 3 次，仍失败暂停并通知，支持人工接管');
  }
  L.push('');
  L.push('## 四、非功能需求');
  L.push('');
  L.push('- **性能**：按业务频率 ×3 的并发设计，单次处理目标 < 5 分钟');
  L.push('- **可靠**：核心链路可用性 ≥99%，失败可重试可恢复');
  L.push('- **安全合规**：最小权限、操作留痕、敏感数据脱敏（按合规要求）');
  L.push('- **可维护**：规则/流程配置化，不写死在代码里');
  L.push('');
  L.push('## 五、实施计划');
  L.push('');
  L.push('| 阶段 | 任务 | 输出 | 人天 |');
  L.push('| --- | --- | --- | --- |');
  L.push('| 需求确认 | 口径、阈值、步骤逐项确认 | 业务签字版需求 | 2 |');
  L.push('| 数据打通 | 数据源接入、校验规则 | 取数跑通报告 | ' + Math.round(ass.effort * 0.35) + ' |');
  L.push('| 核心开发 | 规则引擎/编排器/任务中心 | 可测试版本 | ' + Math.round(ass.effort * 0.4) + ' |');
  L.push('| 联调测试 | UAT、异常演练 | UAT 报告 | ' + Math.round(ass.effort * 0.15) + ' |');
  L.push('| 试点上线 | 试点 2 周、调整规则 | 试点复盘 | ' + Math.round(ass.effort * 0.1) + ' |');
  L.push('');
  L.push(`**合计：约 ${ass.effort} 人天**`);
  L.push('');
  L.push('## 六、风险清单与对策');
  L.push('');
  L.push('| 风险 | 等级 | 对策 |');
  L.push('| --- | --- | --- |');
  L.push('| 系统无 API 接口 | 中 | 评估 RPA 或人工导出+二次录入兜底 |');
  L.push('| 数据口径不清 | 高 | 需求阶段逐项签字确认，建立口径字典 |');
  L.push('| 规则覆盖不全 | 中 | 高频场景优先，异常案例滚动补充规则 |');
  L.push('| 跨部门配合不到位 | 中 | 明确 RACI，项目周例会 |');
  L.push('| 上线后规则漂移 | 低 | 月度复盘、规则版本化 |');
  L.push('');
  L.push('## 七、回退方案');
  L.push('');
  L.push('- 试运行期（前 2 周）保留原有人工流程并行，双轨运行');
  L.push('- 任一步骤失败可一键切换回人工通道');
  L.push('- 规则配置全部可回滚至上一版本');
  return L.join('\n');
}

/* ---------- 对外主入口 ----------
   三档结构：初级/中级/高级均输出产品版 + 技术版，共 6 份文档。
   overview 仅作为旧数据兼容字段，不再为新需求生成。 */
function generateAll(requirement) {
  const profile = requirement.profile;
  const now = new Date().toISOString();
  return {
    basic: { product: productBasic(profile), tech: techBasic(profile), generatedAt: now },
    intermediate: { product: productIntermediate(profile), tech: techIntermediate(profile), generatedAt: now },
    advanced: { product: productAdvanced(profile), tech: techAdvanced(profile), generatedAt: now }
  };
}

module.exports = { generateAll, assess };
