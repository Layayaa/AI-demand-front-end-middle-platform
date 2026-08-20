'use strict';
/* 示例数据：用《表1》《表2》里的案例生成两条完整示例需求，
   让平台第一次打开就有可看的画像、三档方案和优先级分析。 */
const db = require('./db');
const { generateAll } = require('./engine/plans');
const { analyze } = require('./engine/value');

function ts(offsetMin) {
  return new Date(Date.now() - offsetMin * 60000).toISOString();
}

function decisionExample() {
  const profile = {
    type: 'decision',
    decision: {
      name: '滞销SKU处置方式判断（维持/降价/清仓/货损）',
      department: '商品运营',
      decisionMaker: '运营主管',
      frequency: { n: '1', unit: '周', raw: '1次/周' },
      value: { level: '高', reason: '影响库存资金沉淀与仓储费，直接关系现金流' },
      dimensions: ['库存风险', '成本', '其他'],
      purpose: '在库存占用成本与继续销售收益间找最优解，避免资金沉淀、仓储费持续增加和临期/过季损失扩大',
      timeCostMin: 30,
      people: 2,
      description: '每周滞销品复盘中，运营主管筛选周转率低于阈值或库龄超标的SKU，汇总近30天销售、当前库存、成本结构及仓储占用费，分别测算"维持/阶梯降价/活动清仓/直接货损"四种路径的回收金额与净损益，结合商品生命周期和大促窗口，选定最优处置方案并下达执行。',
      inputs: [
        { name: '近30天销量/日均销量', source: '生意参谋', method: '定时导出', note: '剔除大促异常日' },
        { name: '当前库存数量', source: 'WMS仓储', method: 'API实时取', note: '含在途则单独标注' },
        { name: '库存库龄(入库天数)', source: 'WMS仓储', method: 'API实时取', note: '按批次取最早入库' },
        { name: '商品单位成本(采购+到仓)', source: '金蝶云', method: '定时导出', note: '含头程则注明' },
        { name: '当前售价及近30天实际成交价', source: '电商后台', method: 'API实时取', note: '区分标价与实付' },
        { name: '平台扣点+物流+包装变动成本', source: 'Excel或本地文件', method: '人工提供', note: '按品类有固定模板' },
        { name: '仓储占用费(按库龄累进)', source: 'WMS仓储', method: '定时导出', note: '超90天费率上浮' },
        { name: '商品生命周期/季节属性', source: '口头或经验', method: '人工提供', note: '如应季品/尾货/常青款' },
        { name: '同款/替代品销售趋势', source: '电商后台', method: '定时导出', note: '判断降价是否蚕食同类销量' }
      ],
      rules: '1. 库存周转天数 = 当前库存 ÷ 近30天日均销量（日均0标"零动销"） 2. 当前单品毛利 = 售价 − 成本 − 扣点 − 物流 − 包装 3. 模拟各方案（维持/降价X%/清仓/货损）损益 4. 比选最优',
      standards: [
        { condition: '周转天数≤60天 + 毛利率>25% + 非临期过季', result: '维持现价，加入日常推广观察2周', clarity: '明确阈值' },
        { condition: '周转天数60-120天 + 降价后净损益优于维持 + 毛利率仍>10%', result: '阶梯降价：先降5%-10%，设7天观察期', clarity: '大概范围' },
        { condition: '周转天数>120天 或 库龄>90天 + 有大促窗口', result: '活动清仓：5-7折进专场，目标7天清完', clarity: '明确阈值' },
        { condition: '零动销30天+ 或 临期/过季 或 清仓预计亏损≥货损', result: '直接做货损（报废/捐赠/线下甩卖）', clarity: '明确阈值' },
        { condition: '单SKU库存货值>5万 或 降价幅度>20%', result: '升级商品总监审批后再执行', clarity: '明确阈值' }
      ],
      actions: [
        { result: '维持现价', who: '运营', what: '加入日常推广池 + 2周后复查周转', where: '商品后台/推广计划表', note: '记录观察起止日' },
        { result: '阶梯降价5%-10%', who: '运营', what: '调价 + 设7天观察期 + 更新促销标签', where: '商品后台/价格管理', note: '到期自动提醒复盘' },
        { result: '活动清仓5-7折', who: '运营+活动', what: '提报清仓专场 + 设库存锁定 + 每日跟进销量', where: '活动报名系统/商品后台', note: '目标7天清完' },
        { result: '直接做货损', who: '运营+仓储+财务', what: '发起货损审批 + 下架 + 库存核销', where: 'ERP货损单/WMS', note: '留存损益测算附件' },
        { result: '升级总监审批', who: '商品总监', what: '审核测算表 + 确认处置方案', where: '企微/审批流', note: '24h内批复' }
      ]
    },
    sop: {
      name: '', department: '', owner: '', frequency: null, value: null, dimensions: [],
      durationMin: null, people: null, purpose: '', description: '', steps: []
    },
    skipped: [],
    stage: 'done',
    completeness: 100
  };
  return profile;
}

function sopExample() {
  const profile = {
    type: 'sop',
    decision: {
      name: '', department: '', decisionMaker: '', frequency: null, value: null, dimensions: [],
      purpose: '', timeCostMin: null, people: null, description: '',
      inputs: [], rules: '', standards: [], actions: []
    },
    sop: {
      name: '商品优化建议',
      department: '商品运营',
      owner: '小黄',
      frequency: { n: '1', unit: '天', raw: '1次/天' },
      value: { level: '高', reason: '每日驱动商品迭代，直接提升销售与客户满意度' },
      dimensions: ['收入', '客户满意度'],
      durationMin: 10,
      people: 5,
      purpose: '提升商品销售，不断递进优化商品，在同类竞品中提升竞争力',
      description: '每周一获取该商品近一周有效聊天记录(剔除短对话)，分析客户新需求与商品问题点；再结合近一周SKU销售数据，倒推该商品需优化的事项，分供应链/运营/视觉/客服四方面给出优化建议，每条建议须数据可溯源；推送给运营确认后派发执行，超时升级主管。',
      steps: [
        { seq: 1, action: '获取商品一周内所有聊天记录', input: '客服聊天记录', trigger: '每周一自动触发', type: 'RPA/API自动化', output: '对应商品的聊天记录', minutes: 5, source: '客服系统', method: 'API实时取', note: '', linkedDecision: '', reason: '' },
        { seq: 2, action: '剔除无效对话', input: '该商品聊天记录', trigger: '', type: '数据信息处理', output: '有效聊天记录(剔除低于3轮次)', minutes: 10, source: '', method: '', note: '', linkedDecision: '', reason: '' },
        { seq: 3, action: '分析有效对话的商品需求和问题', input: '有效聊天记录', trigger: '', type: '分析决策', output: '商品VOC报告', minutes: 30, source: '', method: '', note: '', linkedDecision: '商品需求判断', reason: '' },
        { seq: 4, action: '获取商品近一周所有sku销售数据', input: '近一周销售报表', trigger: '', type: 'RPA/API自动化', output: '筛选该商品sku关键销售字段', minutes: 3, source: '电商后台', method: '定时导出', note: '', linkedDecision: '', reason: '' },
        { seq: 5, action: '将第3步和第4步结果汇总分析', input: '第3、4步输出', trigger: '', type: '分析决策', output: '商品优化报告', minutes: 6, source: '', method: '', note: '', linkedDecision: '优化方向判断', reason: '' },
        { seq: 6, action: '形成各岗位优化建议', input: '优化报告', trigger: '', type: '数据信息处理', output: '分岗位建议', minutes: 11, source: '', method: '', note: '', linkedDecision: '', reason: '' },
        { seq: 7, action: '飞书推送给对应运营', input: '分岗位建议', trigger: '', type: 'RPA/API自动化', output: '优化建议已推送', minutes: 1, source: '飞书', method: 'API实时取', note: '', linkedDecision: '', reason: '' },
        { seq: 8, action: '运营查看、编辑并确认', input: '优化建议', trigger: '运营收到通知', type: '人工介入', output: '查看意见', minutes: 5, source: '', method: '', note: '', linkedDecision: '', reason: '看数据·凭经验拍板' },
        { seq: 9, action: '推送飞书任务给指定运助', input: '', trigger: '运营确认', type: 'RPA/API自动化', output: '任务已派发', minutes: 1, source: '飞书', method: 'API实时取', note: '', linkedDecision: '', reason: '' },
        { seq: 10, action: '推送优化建议给运营主管', input: '', trigger: '运营超时确认或取消', type: 'RPA/API自动化', output: '建议已升级', minutes: 1, source: '飞书', method: 'API实时取', note: '', linkedDecision: '', reason: '' }
      ]
    },
    skipped: [],
    stage: 'done',
    completeness: 100
  };
  return profile;
}

function buildRequirement(id, title, summary, department, profile, ageMin, status, history) {
  const req = {
    id,
    title,
    summary,
    department,
    type: profile.type,
    status,
    statusHistory: history,
    createdAt: ts(ageMin),
    updatedAt: ts(ageMin - 5),
    profile,
    chat: [
      { role: 'assistant', content: `你好，我是 AI 需求顾问。请简单说一下你的需求，我会帮你一步步聊清楚，最后输出三档方案（初级/中级/高级 × 产品版/技术版）。\n\n先介绍下：这个需求是「单点决策」还是「SOP流程」？或者直接描述你的场景也可以。`, at: ts(ageMin) },
      { role: 'user', content: profile.type === 'decision' ? `我们每周要做「${profile.decision.name}」，这是个判断类需求。` : `我们每天要跑「${profile.sop.name}」这条流程。`, at: ts(ageMin - 1) },
      { role: 'assistant', content: profile.type === 'decision' ? '明白了，这是个**单点决策**（数据→分析→判断→行动）。我来逐步帮你把画像聊清楚。' : '明白了，这是条 **SOP流程**。我来逐步帮你把步骤聊清楚。', at: ts(ageMin - 2) }
    ],
    plans: null,
    value: null,
    demo: true
  };
  req.plans = generateAll(req);
  req.value = analyze(req);
  return req;
}

function seedIfEmpty() {
  const d = db.load();
  if (d.requirements.length > 0) return false;
  const r1 = buildRequirement(
    'R-20240801-001',
    '滞销SKU处置方式判断',
    '每周对滞销SKU判断维持/降价/清仓/货损，避免资金沉淀与仓储费持续增加',
    '商品运营',
    decisionExample(),
    60 * 24 * 2, // 2天前
    'review',
    [
      { status: 'submitted', at: ts(60 * 24 * 2), note: '业务提交需求' },
      { status: 'clarifying', at: ts(60 * 24 * 2 - 10), note: 'AI 前置澄清完成（约 15 轮对话）' },
      { status: 'profiled', at: ts(60 * 24 * 2 - 20), note: '需求画像完成，完整度 100%' },
      { status: 'planning', at: ts(60 * 24 * 2 - 25), note: '三档方案已生成（产品版+技术版）' },
      { status: 'review', at: ts(60 * 24 * 1), note: '待业务评审' }
    ]
  );
  const r2 = buildRequirement(
    'R-20240802-002',
    '商品优化建议（每日SOP）',
    '每日获取聊天记录与SKU销售数据，输出分岗位优化建议并派发执行',
    '商品运营',
    sopExample(),
    60 * 24 * 1, // 1天前
    'review',
    [
      { status: 'submitted', at: ts(60 * 24 * 1), note: '业务提交需求' },
      { status: 'clarifying', at: ts(60 * 24 * 1 - 10), note: 'AI 前置澄清完成（约 20 轮对话）' },
      { status: 'profiled', at: ts(60 * 24 * 1 - 20), note: '需求画像完成，完整度 100%（10 步）' },
      { status: 'planning', at: ts(60 * 24 * 1 - 25), note: '三档方案已生成（产品版+技术版）' },
      { status: 'review', at: ts(60 * 24 * 0.5), note: '待业务评审' }
    ]
  );
  d.requirements.push(r1, r2);
  db.save();
  return true;
}

module.exports = { seedIfEmpty };
