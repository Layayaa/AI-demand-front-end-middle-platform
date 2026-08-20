'use strict';
/* LLM 适配器：兼容 OpenAI Chat Completions 协议
   （DeepSeek / OpenAI / 通义千问 compatible-mode / Kimi 等均可配置）
   未配置 API Key 或调用失败时，上层回退到内置引擎。 */

const FRAMEWORK_SYS = `你是「需求前置分析平台」的 AI 需求顾问，服务对象是提需求的业务人员。你的职责是帮他们把模糊的需求"聊清楚"，最终产出一份结构化需求画像。

业务人员不懂任何框架术语，请你：
1. 让用户**自由描述**（想解决什么问题、现在怎么做的、多久一次、希望什么效果），不要一上来就让用户做选择题，也不要向用户解释"单点决策/SOP流程"这类概念。
2. 你在心里判断这个需求的形态（见下方内部框架），判断不出来时再用通俗语言请用户确认。
3. 以下框架仅作你的**内部 checklist**，用于确保信息不遗漏、画像结构化，而不是要用户配合填表。

【内部框架】
- 判断型（单点决策）= 一个判断点：基于什么数据 → 做什么分析 → 得出什么结论 → 对应什么行动。
- 流程型（SOP流程）= 多步骤串行流程：什么触发 → 依次做什么 → 各步谁做 → 产出什么 → 靠哪些数据。

【字段 checklist】
- 判断型：决策名称/归属部门/决策人/频率(数字+单位)/价值大小(高·中·低)/业务影响维度(收入·成本·客户满意度·库存风险·合规风险·其他)/决策目的/每次耗时(分钟)/参与人数/输入数据(名称+来源系统+取数方式)/分析规则(可执行步骤或公式)/判断标准(条件→结论→明确程度:明确阈值·大概范围·凭经验)/对应行动(判断结果→谁执行→具体做什么→在哪里操作)
- 流程型：流程名称/归属部门/负责人/频率/价值大小/影响维度/每次耗时/涉及人数/流程目的/步骤拆解(每步:具体动作(带执行角色)/输入/过程触发条件/步骤类型/输出/耗时分钟/数据来源系统/取数方式/若人工介入需靠人原因)
- 取数方式枚举：API实时取 / 定时导出 / RPA抓取 / 人工提供 / 拿不到·待确认
- 数据来源系统枚举：金蝶云 / 电商后台 / 生意参谋 / 客服系统 / WMS仓储 / 飞书 / 钉钉 / 企微 / 影刀 / Excel或本地文件 / 口头或经验 / 无
- 步骤类型枚举：RPA/API自动化 / 数据信息处理 / 分析决策 / 人工介入

对话纪律：
1. 一次只问一个问题，语气专业、友善、口语化，避免一次抛多个问题。
2. 用户回答后，把能提取的信息记入画像，再问下一个缺失项。
3. 当关键信息齐全时，主动用 Markdown 总结画像，并询问"是否生成三档方案（初级 / 中级 / 高级）"。
4. 用户说"没问题/可以/OK"表示确认画像。`;

function chatCompletion(settings, messages, { timeoutMs = 120000, temperature = 0.4 } = {}) {
  const cfg = settings.llm || {};
  if (!cfg.apiKey) return Promise.reject(new Error('未配置 API Key'));
  const base = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model || 'deepseek-chat', messages, temperature, stream: false }),
    signal: ctrl.signal
  }).then(async (res) => {
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM 请求失败 HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('LLM 返回为空');
    return content.trim();
  }).catch((e) => {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('LLM 请求超时');
    throw e;
  });
}

function knowledgeInstructions(knowledgeContext) {
  if (!knowledgeContext) return '';
  return `\n\n【可选知识库参考】\n以下内容来自已挂载的公司知识库，只能作为背景参考；若与业务本轮明确描述冲突，以业务描述为准。需要使用时，请标注来源文件名。\n${knowledgeContext}`;
}

/* 澄清对话：返回 LLM 回复文本。
   context = { missing: [{key,label,prompt}], completeness, knowledgeContext } */
async function clarify(settings, requirement, history, context) {
  const profile = requirement.profile || {};
  context = context || {};
  const missing = context.missing || [];
  const missingText = missing.length
    ? '规则引擎提示画像仍缺少这些标准字段：\n' + missing.map(m => `- ${m.label}：${m.prompt.slice(0, 40)}…`).join('\n')
    : '画像的标准字段已齐全，可引导用户确认画像。';
  const sys = FRAMEWORK_SYS + `\n\n当前需求画像(JSON)：\n${JSON.stringify(profile, null, 2)}\n\n当前画像完整度：${context.completeness ?? 0}%\n${missingText}\n\n本轮对话策略：你是主导对话的 AI 需求顾问——根据画像现状**自主决定**下一步问什么（优先处理上述缺失项；也可追问画像外但影响方案的关键点，如合规、边界、口径、上线窗口）；一次只问一个问题；用户答完先在心里更新画像再问下一项；不要重复已明确的信息。` + knowledgeInstructions(context.knowledgeContext);
  const messages = [{ role: 'system', content: sys }];
  const tail = history.slice(-20);
  tail.forEach(m => messages.push({ role: m.role, content: m.content }));
  return chatCompletion(settings, messages);
}

/* 交付前自检：LLM 对照框架审查画像，返回 {summary, gaps:[{question,reason}]} */
async function reviewProfile(settings, requirement, knowledgeContext) {
  const profile = requirement.profile || {};
  const isD = profile.type === 'decision';
  const sys = `你是资深需求顾问，负责对一份需求画像做**交付前自检**。该需求是${isD ? '「单点决策」（数据→分析→判断→行动）' : '「SOP流程」（多步骤串行流程）'}。

找出会影响方案范围、架构、风险或验收质量的**关键缺口**——必须是画像中缺失或含糊的信息（例如：合规与权限、异常与边界、数据口径定义、关键干系人、上线窗口、衡量口径等）。不要问画像里已有明确答案的问题。

只输出 JSON，不要 Markdown：
{"summary": "用一段自然语言概括这个需求", "gaps": [{"question": "向业务提出的单一简短问题", "reason": "为什么必须确认"}]}
  gaps 最多 5 个；若没有关键缺口，gaps 为 []。` + knowledgeInstructions(knowledgeContext);
  const user = `需求标题：${requirement.title || '未命名'}\n需求画像(JSON)：\n${JSON.stringify(profile, null, 2)}`;
  const raw = await chatCompletion(settings, [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.3, timeoutMs: 90000 });
  return parseJsonLoose(raw);
}

/* 宽松 JSON 解析（容错 LLM 输出） */
function parseJsonLoose(text) {
  try {
    let content = String(text || '').trim();
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) content = content.slice(start, end + 1);
    const obj = JSON.parse(content);
    if (obj && typeof obj === 'object') {
      return {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        gaps: Array.isArray(obj.gaps) ? obj.gaps.filter(g => g && typeof g.question === 'string').map(g => ({
          question: g.question,
          reason: typeof g.reason === 'string' ? g.reason : ''
        })) : []
      };
    }
  } catch (e) { /* fall through */ }
  return { summary: String(text || '').slice(0, 200), gaps: [] };
}

/* ---------- 文档写作规则（借鉴开源 Agent Skills 组合，精简为中文规则） ---------- */
const SKILLS = {
  scribe: '先建立文档目的、读者、范围与证据，再按层级组织；每项内容必须清晰、可验证，并与需求画像来源一致；不得虚构画像中不存在的信息。',
  atlas: '从系统上下文、边界、组件、交互与部署视角描述架构；明确关键约束、质量属性、权衡与演进路径；不堆砌与画像无关的架构。',
  gateway: '接口设计应包含职责、输入输出、认证授权、错误语义、幂等性、版本与兼容策略；不虚构需求未要求的接口。',
  schema: '数据设计应覆盖实体、关系、约束、生命周期、一致性、索引、迁移与审计；未知字段明确标注"待确认"。',
  canon: '检查安全、隐私、可访问性、接口规范与组织标准；只有画像或知识库提供依据时才声明具体合规标准。',
  bolt: '以容量假设、延迟目标、吞吐、热点、缓存、并发与压测验证构建性能方案；缺失的数值列为"待确认"。',
  beacon: '定义日志、指标、链路、告警、SLO、故障响应与审计要求；让每个关键业务流程具备可观测性。',
  pmProduct: '产品方案需覆盖用户故事、优先级、范围、验收、指标、依赖、风险、发布与迭代；指标需给出定义与测量方式。'
};

const DOC_SKILLS = {
  'basic:product': ['scribe', 'pmProduct'],
  'basic:tech': ['atlas', 'schema'],
  'basic:overview': ['scribe'],
  'intermediate:product': ['scribe', 'pmProduct'],
  'intermediate:tech': ['atlas', 'gateway', 'schema'],
  'advanced:product': ['scribe', 'pmProduct'],
  'advanced:tech': ['atlas', 'gateway', 'schema', 'canon', 'bolt', 'beacon']
};

function skillInstructions(docType, tier) {
  const names = DOC_SKILLS[tier + ':' + docType] || [];
  return names.map(n => `[${n}] ${SKILLS[n]}`).join('\n');
}

/* 方案文档生成：返回 Markdown
   docType: product / tech；overview 仅兼容旧数据 */
async function generateDoc(settings, requirement, tier, docType, knowledgeContext) {
  const TIER_DESC = {
    basic: {
      product: '初级方案 · 产品版：一页判断需求是否值得做，需含需求定位/业务目标/首期范围/关键用户结果/验收口径/建议决策；内容聚焦业务，不展开完整技术设计。篇幅 50~100 行。',
      tech: '初级方案 · 技术版：一页判断可不可做，需含自动化潜力/数据来源与接入方式/首期技术路径/工作量粗估/技术边界/主要风险与下一步；内容聚焦可行性，不展开完整架构设计。篇幅 50~100 行。',
      overview: '初级方案 · 合并速览：一页判断"值不值得做"，产品视角+技术快照合并在一份文档里，不拆分两版。需含：需求定位（部门/形态/一句话）/价值判断（频率/价值/影响/耗时/初步结论）/关键要点（判断型给输入数据表与判断逻辑，流程型给步骤一览与自动化潜力）/技术快照（可自动化程度、涉及系统、工作量粗估、主要风险）/建议下一步。篇幅 50~100 行。'
    },
    intermediate: {
      product: '中级方案 · 产品版（可评审方案）：背景与目标/需求范围/改造后流程设计/功能清单/角色分工/验收标准/建议排期。篇幅 120~220 行。',
      tech: '中级方案 · 技术版：取数方案(逐条)/自动化实现思路/系统集成点/工作量与排期/技术风险与依赖。篇幅 120~220 行。'
    },
    advanced: {
      product: '高级方案 · 产品版（完整 PRD）：背景与目标/用户与角色/流程与功能详设(含表格)/数据字典/异常与边界/验收标准与KPI/里程碑。篇幅 200~350 行。',
      tech: '高级方案 · 技术版：总体架构/数据流/详细设计要点/非功能需求/实施计划/风险清单与对策/回退方案。篇幅 200~350 行。'
    }
  };
  const desc = (TIER_DESC[tier] && TIER_DESC[tier][docType]) || '方案文档';
  const docLabel = docType === 'product' ? '产品版' : docType === 'tech' ? '技术版' : '合并速览';
  const sys = `你是资深企业数字化咨询顾问。根据需求画像输出「${desc}」的【${docLabel}】文档，使用 Markdown 格式，中文，条理清晰，善用表格。

写作规则（必须遵守）：
1. 数据必须来自画像，画像缺失处写"待确认"，不得虚构。
2. 若画像为「判断型」，方案应围绕 数据→分析→判断→行动 展开（输入数据表、分析规则、判断标准表、对应行动表）；若为「流程型」，应围绕步骤拆解展开（每步动作/类型/耗时/来源/靠人原因），并明确哪些步骤可自动化。
3. 以下专业写作规则请组合使用：
${skillInstructions(docType, tier)}

输出纯 Markdown（不要用代码块包裹全文）。` + knowledgeInstructions(knowledgeContext);
  const user = `需求标题：${requirement.title || '未命名'}\n需求画像(JSON)：\n${JSON.stringify(requirement.profile || {}, null, 2)}`;
  return chatCompletion(settings, [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.5, timeoutMs: 180000 });
}

async function testConnection(settings) {
  return chatCompletion(settings, [
    { role: 'system', content: '你是连接测试助手，只回复"连接成功"四个字。' },
    { role: 'user', content: '测试' }
  ], { timeoutMs: 30000, temperature: 0 });
}

module.exports = { clarify, generateDoc, testConnection, reviewProfile };
