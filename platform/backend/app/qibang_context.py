import re
from typing import Any, Optional


COMPANY_NAME = "广州七邦科技有限公司"

BUSINESS_CHAINS = {
    "inventory_operations": {
        "label": "商品、库存与商品后台运营",
        "aliases": (
            "库存",
            "sku",
            "spu",
            "上下架",
            "上架",
            "下架",
            "商品后台",
            "商品图",
            "货损",
            "清仓",
            "补货",
            "库龄",
            "调价",
            "活动",
        ),
        "signals": ("库存与商品资料", "ERP / 库存接口资料"),
        "questions": (
            {
                "key": "businessObject",
                "label": "业务对象",
                "prompt": "这次要处理的核心对象是什么？请说清是 SKU、SPU、库存、商品状态、价格还是活动，以及要做什么。",
                "hint": "例如：为指定 SKU 自动设置可售库存；或判断商品是否应上架。",
            },
            {
                "key": "scope",
                "label": "适用范围",
                "prompt": "这项需求先覆盖哪些店铺、平台、仓库、品类或商品范围？",
                "hint": "例如：先覆盖抖音主店的常规商品，不含预售和跨境商品。",
            },
            {
                "key": "currentProcess",
                "label": "当前处理方式",
                "prompt": "现在是谁在什么时点、在哪个系统里完成这件事？从触发到完成简要说一下。",
                "hint": "例如：运营每天导出库存表，在商品后台逐个修改可售库存。",
            },
            {
                "key": "dataDefinition",
                "label": "数据口径",
                "prompt": "这次涉及的库存或商品数据按什么口径算？请说明哪些状态要算、哪些要排除。",
                "hint": "例如：可售库存 = 实物库存 - 锁定库存；在途和残次品不参与自动设置。",
            },
            {
                "key": "systemLandscape",
                "label": "实际系统",
                "prompt": "当前实际在哪些系统或表里取数、执行和留痕？只填写已确认在用的系统。",
                "hint": "可以写商品后台、WMS、ERP、Excel 等；资料中存在库存和 ERP 类线索，但是否适用请以你的回答为准。",
            },
            {
                "key": "approvalBoundary",
                "label": "自动化与审批边界",
                "prompt": "哪些情况可以直接自动处理，哪些必须人工确认或升级审批？异常怎么兜底？",
                "hint": "例如：库存变更不超过 20% 可自动执行；超过阈值、临期或数据缺失时转运营主管确认。",
            },
            {
                "key": "successMetric",
                "label": "成功标准",
                "prompt": "上线后用什么结果判断它有效？请给一个可观察的业务指标或时效目标。",
                "hint": "例如：库存设置由每天 2 小时降到 15 分钟，且错误率低于 1%。",
            },
        ),
    },
    "product_voc": {
        "label": "商品优化与客户 VOC",
        "aliases": (
            "voc",
            "客户反馈",
            "聊天记录",
            "咨询",
            "评价",
            "商品优化",
            "差评",
            "客服",
            "需求洞察",
        ),
        "signals": ("客服反馈与销售分析场景", "商品优化流程线索"),
        "questions": (
            {
                "key": "businessObject",
                "label": "商品与问题对象",
                "prompt": "要分析哪类商品或客户问题，并希望给出什么优化结论？",
                "hint": "例如：分析女鞋 SKU 的售前咨询和差评，形成商品页、供应链和客服话术优化建议。",
            },
            {
                "key": "scope",
                "label": "分析范围",
                "prompt": "先覆盖哪些平台、店铺、品类或时间范围？",
                "hint": "例如：先覆盖抖音主店近 7 天的咨询和评价。",
            },
            {
                "key": "currentProcess",
                "label": "当前处理方式",
                "prompt": "现在怎样收集反馈、分析问题并把优化建议派给相关岗位？",
                "hint": "例如：客服每周整理聊天记录，运营结合销量手工写建议，再在飞书派任务。",
            },
            {
                "key": "dataDefinition",
                "label": "有效反馈口径",
                "prompt": "什么算有效 VOC，哪些记录需要排除或脱敏？",
                "hint": "例如：仅保留与商品有关、对话不少于 3 轮的咨询；手机号和姓名不进入分析结果。",
            },
            {
                "key": "systemLandscape",
                "label": "实际系统",
                "prompt": "反馈、销售数据、任务派发分别来自或落在哪些实际系统？",
                "hint": "例如：客服系统、商品后台、销售报表、飞书；请只填写已确认在用的系统。",
            },
            {
                "key": "approvalBoundary",
                "label": "建议落地边界",
                "prompt": "哪些建议可以直接派发，哪些涉及价格、商品页、供应链或客服话术时必须人工确认？",
                "hint": "例如：标签类建议可自动派发；调价和商品详情页改动由商品运营确认后执行。",
            },
            {
                "key": "successMetric",
                "label": "成功标准",
                "prompt": "希望通过什么指标验证商品优化确实有效？",
                "hint": "例如：高频问题闭环率、商品转化率、差评率或建议处理时效。",
            },
        ),
    },
    "order_finance": {
        "label": "订单、财务与单据协同",
        "aliases": (
            "订单",
            "退款",
            "退货",
            "出库",
            "入库",
            "单据",
            "对账",
            "财务",
            "k3",
            "金蝶",
            "结算",
        ),
        "signals": ("ERP / 单据接口资料",),
        "questions": (
            {
                "key": "businessObject",
                "label": "业务单据",
                "prompt": "要处理的核心单据或业务对象是什么？希望完成什么判断、协同或自动动作？",
                "hint": "例如：销售出库单自动校验；或退款申请是否满足审核条件。",
            },
            {
                "key": "scope",
                "label": "适用范围",
                "prompt": "这项需求先覆盖哪些组织、店铺、仓库、单据类型或业务状态？",
                "hint": "例如：仅覆盖国内直营网店的销售出库单，不含补发和换货。",
            },
            {
                "key": "currentProcess",
                "label": "当前处理方式",
                "prompt": "现在从触发、核对、审批到入账或回写，分别由谁在哪些环节完成？",
                "hint": "例如：财务每天导出订单和出库单，由专员核对后手工提交审核。",
            },
            {
                "key": "dataDefinition",
                "label": "状态与金额口径",
                "prompt": "本需求依赖哪些状态、金额或数量口径？冲销、部分发货、重复单等怎么认定？",
                "hint": "例如：以已审核出库数量为准；已取消和已红冲单据不参与处理。",
            },
            {
                "key": "systemLandscape",
                "label": "实际系统",
                "prompt": "订单、库存、财务单据和审批实际分别在哪些系统中产生、核对和留痕？",
                "hint": "可以写 ERP、订单后台、WMS、Excel 等；资料中有 ERP 接口线索，但请以实际在用系统为准。",
            },
            {
                "key": "approvalBoundary",
                "label": "自动化与审批边界",
                "prompt": "哪些单据可自动提交或回写，哪些金额、状态异常或跨部门场景必须人工审批？",
                "hint": "例如：金额差异小于 1 元可自动通过；部分发货和金额异常转财务复核。",
            },
            {
                "key": "successMetric",
                "label": "成功标准",
                "prompt": "上线后准备用什么时效、差异率或人工工作量指标衡量效果？",
                "hint": "例如：对账处理时长减少 70%，单据差异发现时效从次日缩短到 30 分钟。",
            },
        ),
    },
    "training": {
        "label": "培训与组织学习",
        "aliases": (
            "培训",
            "课程",
            "学习",
            "问卷",
            "考试",
            "讲师",
            "微课",
            "试题",
            "学习路径",
        ),
        "signals": ("培训 AI 需求材料",),
        "questions": (
            {
                "key": "businessObject",
                "label": "培训对象与产出",
                "prompt": "面向哪些岗位或人群，要生成或改进什么培训产出？",
                "hint": "例如：面向新客服生成 30 分钟商品知识微课和随堂测验。",
            },
            {
                "key": "scope",
                "label": "适用范围",
                "prompt": "先覆盖哪些部门、岗位、主题、课程或周期？",
                "hint": "例如：先覆盖客服新人入职第一周的商品知识培训。",
            },
            {
                "key": "currentProcess",
                "label": "当前处理方式",
                "prompt": "现在课程、资料、测验或培训效果是怎样准备、审核、发布和复盘的？",
                "hint": "例如：培训专员收集制度文档后手工做 PPT，讲师审核后在学习平台发布。",
            },
            {
                "key": "dataDefinition",
                "label": "知识与评估口径",
                "prompt": "可使用哪些已授权资料？完成、合格、效果等指标分别按什么口径统计？",
                "hint": "例如：只使用已发布制度和已审核案例；完成率以学习平台通过状态为准。",
            },
            {
                "key": "systemLandscape",
                "label": "实际系统",
                "prompt": "资料、课程、视频、问卷、考试和培训数据分别在哪些实际系统里？",
                "hint": "例如：知识库、学习平台、视频库、问卷工具；请只填写已确认在用的系统。",
            },
            {
                "key": "approvalBoundary",
                "label": "生成与发布边界",
                "prompt": "哪些内容可以由 AI 生成初稿，哪些必须由业务或培训负责人审核后才能发布？",
                "hint": "例如：课程大纲和试题可生成初稿；制度解读、标准答案和正式发布必须人工审核。",
            },
            {
                "key": "successMetric",
                "label": "成功标准",
                "prompt": "上线后用什么培训效果或制作效率指标判断它有效？",
                "hint": "例如：课程初稿制作时间减少 60%，参训完成率和考核通过率达到预期。",
            },
        ),
    },
    "other": {
        "label": "其他业务链路",
        "aliases": (),
        "signals": (),
        "questions": (
            {
                "key": "businessObject",
                "label": "业务对象",
                "prompt": "这项需求要处理的核心业务对象是什么，要完成什么结果？",
                "hint": "例如：客户退款申请，判断是否满足自动审核条件。",
            },
            {
                "key": "scope",
                "label": "适用范围",
                "prompt": "先覆盖哪些部门、业务范围、渠道或时间范围？",
                "hint": "例如：先覆盖华南区直营网店的常规订单。",
            },
            {
                "key": "currentProcess",
                "label": "当前处理方式",
                "prompt": "现在由谁在什么时点、使用什么方式完成这项工作？",
                "hint": "请从触发到完成简要描述。",
            },
            {
                "key": "dataDefinition",
                "label": "关键口径",
                "prompt": "这项工作中最容易产生分歧的数据、状态或规则口径是什么？",
                "hint": "例如：以已审核订单为准，已取消订单不参与统计。",
            },
            {
                "key": "systemLandscape",
                "label": "实际系统",
                "prompt": "当前在哪些实际系统、表格或资料中取数、执行和留痕？",
                "hint": "请只填写已确认在用的系统。",
            },
            {
                "key": "approvalBoundary",
                "label": "自动化与审批边界",
                "prompt": "哪些情况可以自动处理，哪些必须人工确认或升级？异常怎么兜底？",
                "hint": "例如：规则命中时自动处理；数据缺失或高风险场景转负责人确认。",
            },
            {
                "key": "successMetric",
                "label": "成功标准",
                "prompt": "上线后以什么时效、质量或业务结果判断它有效？",
                "hint": "例如：人工处理时长减少 60%，关键错误率低于 1%。",
            },
        ),
    },
}


def empty_business_context(title: str, summary: Optional[str]) -> dict[str, Any]:
    candidate = detect_business_chain(" ".join((title or "", summary or "")))
    return {
        "company": COMPANY_NAME,
        "businessChain": "",
        "candidateBusinessChain": candidate or "",
        "candidateSignals": candidate_signals(candidate or "other"),
        "businessObject": "",
        "scope": "",
        "currentProcess": "",
        "dataDefinition": "",
        "systemLandscape": "",
        "approvalBoundary": "",
        "successMetric": "",
    }


def detect_business_chain(value: str) -> Optional[str]:
    text = (value or "").lower()
    best_chain = None
    best_score = 0
    for key, item in BUSINESS_CHAINS.items():
        score = sum(1 for alias in item["aliases"] if alias.lower() in text)
        if score > best_score:
            best_chain = key
            best_score = score
    return best_chain if best_score else None


def business_chain_options() -> list[str]:
    return [item["label"] for item in BUSINESS_CHAINS.values()]


def business_chain_from_answer(value: str) -> Optional[str]:
    text = re.sub(r"\s+", " ", value or "").strip().lower()
    for key, item in BUSINESS_CHAINS.items():
        if text == item["label"].lower() or item["label"].lower() in text:
            return key
    return detect_business_chain(text)


def business_chain_label(key: str) -> str:
    return str(BUSINESS_CHAINS.get(key, BUSINESS_CHAINS["other"])["label"])


def questions_for_business_chain(key: str) -> tuple[dict[str, str], ...]:
    selected = key if key in BUSINESS_CHAINS else "other"
    return tuple(BUSINESS_CHAINS[selected]["questions"])


def candidate_signals(key: str) -> list[str]:
    selected = key if key in BUSINESS_CHAINS else "other"
    return list(BUSINESS_CHAINS[selected]["signals"])
