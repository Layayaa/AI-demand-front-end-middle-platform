from __future__ import annotations

import re
from typing import Any, Optional


PLAN_LABELS = {
    "semi_auto": "半自动方案",
    "full_auto": "全自动方案",
}
DOCUMENT_TYPE_LABELS = {
    "product": "产品版",
    "tech": "技术版",
}
PLAN_PROMPT_VERSION = "plans-v8"


def generate_requirement_explanation(
    project: dict[str, Any],
    profile: dict[str, Any],
    gaps: list[dict[str, str]],
    references: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    facts = _build_facts(project, profile, references or [])
    lines = [
        f"# 需求解释方案：{project['title']}",
        "",
        "> 只用于确认需求理解，不是最终需求方案；完整方案由评审人继续完成。",
        "",
        "## 这项需求要做什么",
        "",
        f"- {facts['goal']}",
        f"- 处理对象：{facts['object']}；范围：{facts['scope']}。",
        "",
        "## 业务链路",
        "",
        f"- 输入：{_join_text(facts['input_names'], '待确认输入数据')}",
        f"- 处理：{_join_text(facts['process_points'], '按现有业务规则整理和判断')}",
        f"- 输出：{_join_text(facts['outputs'], '待确认输出')}",
        f"- 人工动作：{_join_text(facts['human_actions'], '待确认')}",
        "",
        "## 待评审确认",
        "",
    ]
    if gaps:
        lines.append("- " + "、".join(item["label"] for item in gaps) + "。")
    else:
        lines.append("- 评审人重点确认数据口径、自动化范围和异常转人工条件。")

    return {
        "tier": "requirement_explanation",
        "document_type": "explanation",
        "title": f"需求解释方案：{project['title']}",
        "markdown_content": "\n".join(lines),
        "knowledge_refs": references or [],
        "prompt_version": PLAN_PROMPT_VERSION,
    }


def generate_documents(
    project: dict[str, Any],
    profile: dict[str, Any],
    gaps: list[dict[str, str]],
    references: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    references = references or []
    return [
        _plan_document("semi_auto", "product", project, profile, gaps, references),
        _plan_document("semi_auto", "tech", project, profile, gaps, references),
        _plan_document("full_auto", "product", project, profile, gaps, references),
        _plan_document("full_auto", "tech", project, profile, gaps, references),
    ]


def _plan_document(
    plan_type: str,
    document_type: str,
    project: dict[str, Any],
    profile: dict[str, Any],
    gaps: list[dict[str, str]],
    references: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "tier": plan_type,
        "document_type": document_type,
        "title": f"{PLAN_LABELS[plan_type]} · {DOCUMENT_TYPE_LABELS[document_type]}：{project['title']}",
        "markdown_content": _build_plan(
            plan_type,
            document_type,
            project,
            profile,
            gaps,
            references,
        ),
        "knowledge_refs": references,
        "prompt_version": PLAN_PROMPT_VERSION,
    }


def _build_plan(
    plan_type: str,
    document_type: str,
    project: dict[str, Any],
    profile: dict[str, Any],
    gaps: list[dict[str, str]],
    references: list[dict[str, Any]],
) -> str:
    facts = _build_facts(project, profile, references)
    is_full_auto = plan_type == "full_auto"
    is_product = document_type == "product"
    facts["automation_scope"] = _automation_scope(
        facts,
        "full_auto" if is_full_auto else "semi_auto",
    )
    lines = [
        f"# {PLAN_LABELS[plan_type]} · {DOCUMENT_TYPE_LABELS[document_type]}：{project['title']}",
        "",
        f"> 只提供{DOCUMENT_TYPE_LABELS[document_type]}选型；完整方案由评审人继续完成。",
        "",
        "## 选型结论",
        "",
        f"- **先做什么**：{_conclusion(facts, is_full_auto)}",
        f"- **系统输出**：{_join_text(facts['outputs'], '结果清单或报告')}",
        f"- **人工保留**：{_human_boundary(facts, is_full_auto)}",
    ]
    lines.extend(
        _product_sections(facts, is_full_auto)
        if is_product
        else _tech_sections(facts, is_full_auto)
    )
    if gaps:
        lines.extend(
            [
                "",
                "## 仍需确认",
                "",
                "- " + "、".join(item["label"] for item in gaps) + "。",
            ]
        )
    return "\n".join(lines)


def _product_sections(facts: dict[str, Any], is_full_auto: bool) -> list[str]:
    action = (
        "系统按已确认规则自动执行明确动作，异常和超出授权范围的结果转人工。"
        if is_full_auto
        else "系统自动整理数据并给出建议，业务确认后在原系统执行。"
    )
    process = [
        f"1. {facts['trigger']}，读取{_join_text(facts['input_names'], '业务输入数据')}。",
        f"2. {facts['process_sentence']}。",
        f"3. 输出{_join_text(facts['outputs'], '结果清单')}，每条结果保留对应数据和判断原因。",
        f"4. {action}",
    ]
    return [
        "",
        "## 产品方案",
        "",
        *[f"- {item}" for item in process],
        "",
        "## 业务动作",
        "",
        *[
            f"- {_display(item.get('result'))}：{_display(item.get('what'))}"
            for item in facts["actions"][:6]
        ],
        *(
            ["- 暂未在材料中拆出具体人工动作，评审时补齐执行人和操作入口。"]
            if not facts["actions"]
            else []
        ),
        "",
        "## 自动化边界",
        "",
        f"- {'自动执行' if is_full_auto else '自动生成建议'}：{facts['automation_scope']}",
        f"- 人工接管：{_human_boundary(facts, is_full_auto)}",
    ]


def _tech_sections(facts: dict[str, Any], is_full_auto: bool) -> list[str]:
    access = _access_summary(facts)
    execution = (
        "定时任务触发脚本；规则明确的提交动作通过 API 优先、RPA 兜底执行，异常转人工。"
        if is_full_auto
        else "定时任务触发脚本；只读取数、清洗和计算，输出报告后由人工确认执行。"
    )
    lines = [
        "",
        "## 技术选型",
        "",
        f"- **取数**：{access}。",
        "- **处理**：Python 脚本一次读取数据，完成字段统一、关联、计算和规则判断。",
        f"- **执行**：{execution}",
        "- **通知**：报告生成后推送企业微信/钉钉；失败、缺数和异常单独告警。",
        "",
        "## 数据流",
        "",
        f"- {_data_flow(facts, is_full_auto)}",
        "",
        "## 集成点",
        "",
        *[f"- {item}" for item in _integration_points(facts)],
        "",
        "## 依赖与前置",
        "",
        *[f"- {item}" for item in _dependencies(facts, is_full_auto)],
        "",
        "## 环境变量",
        "",
        *[f"- {item}" for item in _environment_variables(facts, is_full_auto)],
        "",
        "## 测试计划",
        "",
        *[f"- {item}" for item in _test_plan(facts, is_full_auto)],
        "",
        "## 完成定义 DoD",
        "",
        *[f"- {item}" for item in _definition_of_done(facts, is_full_auto)],
    ]
    return lines


def _build_facts(
    project: dict[str, Any],
    profile: dict[str, Any],
    references: list[dict[str, Any]],
) -> dict[str, Any]:
    context = profile.get("businessContext") or {}
    target = profile.get(profile.get("type") or "") or {}
    material_text = " ".join(
        str(item.get("excerpt") or "")
        for item in references
        if item.get("sourceType") == "project_material"
    )
    all_text = " ".join(
        [
            str(project.get("title") or ""),
            str(project.get("summary") or ""),
            str(context.get("systemLandscape") or ""),
            str(context.get("currentProcess") or ""),
            material_text,
        ]
    )
    domain = _domain_key(all_text)
    facts = {
        "domain": domain,
        "goal": _best_goal(project, context, target, domain),
        "object": _best_object(project, context, target, domain),
        "scope": _best_scope(context, target, domain),
        "trigger": _best_trigger(profile, target, domain),
        "input_names": [],
        "inputs": [],
        "process_points": [],
        "process_sentence": "",
        "rules": [],
        "outputs": [],
        "actions": [],
        "human_actions": [],
        "systems": [],
        "automation_scope": "",
        "has_api": _contains_any(all_text, ("api", "接口调用", "接口对接")),
        "has_file": _contains_any(all_text, ("excel", "csv", "文件", "导出", "表格", "微信群")),
        "has_rpa": _contains_any(all_text, ("rpa", "影刀", "自动化")),
        "material_text": material_text,
    }

    if domain == "inventory":
        _apply_inventory_facts(facts, all_text, title=str(project.get("title") or ""))
    elif domain == "carrier_reconciliation":
        _apply_carrier_facts(facts)
    elif domain == "refund":
        _apply_refund_facts(facts, all_text)
    else:
        _apply_profile_facts(facts, profile)

    _merge_profile_facts(facts, profile)
    facts["systems"] = _unique_text(facts["systems"] + _extract_systems(all_text))
    facts["has_api"] = facts["has_api"] or any(
        _contains_any(str(item.get("method") or ""), ("api", "接口"))
        for item in facts["inputs"]
    )
    facts["has_file"] = facts["has_file"] or any(
        _contains_any(str(item.get("method") or "") + str(item.get("source") or ""), ("excel", "csv", "文件", "导出", "人工"))
        for item in facts["inputs"]
    )
    facts["has_rpa"] = facts["has_rpa"] or any(
        _contains_any(str(item.get("method") or "") + str(item.get("type") or ""), ("rpa", "影刀", "自动化"))
        for item in facts["inputs"]
    )
    facts["input_names"] = _unique_text(facts["input_names"] + [
        item.get("name") for item in facts["inputs"] if item.get("name")
    ])
    facts["process_points"] = _unique_text(facts["process_points"] + facts["rules"])
    facts["human_actions"] = _unique_text(
        facts["human_actions"]
        + [
            f"{_display(item.get('who'))}：{_display(item.get('what'))}"
            for item in facts["actions"]
            if item.get("what")
        ]
    )
    if not facts["process_sentence"]:
        facts["process_sentence"] = _process_sentence(facts)
    if not facts["automation_scope"]:
        facts["automation_scope"] = _automation_scope(facts, "semi_auto")
    return facts


def _apply_inventory_facts(facts: dict[str, Any], text: str, *, title: str) -> None:
    is_cat_super = "猫超" in title or "猫超" in text
    facts.update(
        {
            "goal": "每周汇总销售、库存和在途数据，计算备货/采购需求，降低缺货和库存积压风险。",
            "object": "SKU、店铺/品牌、仓库的库存周转和补货需求",
            "scope": (
                "猫超 D002 仓及相关平台库存、E3 库存流水、WMS 数据和补货单"
                if is_cat_super
                else "平台库存、E3 库存/移仓未入库、平台在途、采购在途、销售计划和历史销量"
            ),
            "trigger": "每周计划部开始周预测或补货处理",
            "process_sentence": (
                "先合并平台/E3/WMS 导出数据，再按 SKU 计算“库存 + 在途 + 预计回货计划 - 安全库存 - 销售计划”，结合销量和周转生成备货或调拨建议"
                if not is_cat_super
                else "先按固定页面路径导出库存、锁定、出库、WMS 和补货数据，再清洗 SKU、仓库和数量字段后生成补货清单"
            ),
            "outputs": (
                ["备货数量建议", "周预测表", "采购申请/调拨需求", "周报或月报"]
                if not is_cat_super
                else ["库存汇总表", "补货单/调拨建议", "异常 SKU 清单"]
            ),
            "systems": (
                ["百胜E3", "WMS", "各电商后台", "数仓", "Excel/线下文档", "金蝶系统/OA"]
                if not is_cat_super
                else ["百胜E3", "WMS", "天机", "Excel/CSV", "采购系统"]
            ),
            "input_names": (
                [
                    "平台库存/平台在途",
                    "E3库存/移仓未入库",
                    "近7天/近30天销量",
                    "销售计划",
                    "采购在途/预计回货计划",
                    "SKU/店铺/品牌代码对照表",
                ]
                if not is_cat_super
                else [
                    "实时库存",
                    "品仓明细表",
                    "系统单/补货单列表",
                    "E3库存与库存锁定流水账",
                    "E3出库流水账",
                    "WMS库存与库位明细",
                    "调拨单",
                ]
            ),
            "rules": (
                [
                    "按销售计划计算：库存 + 在途 + 预计回货计划 - 安全库存 - 销售计划",
                    "按近期销量计算：库存 + 在途 + 预计回货计划 - 安全库存 - 月销售量",
                    "库存周转（月） =（库存 + 在途）/ 月销",
                    "结合销售计划完成率、近7天/近30天销量、同比环比和活动需求确定下单量",
                ]
                if not is_cat_super
                else [
                    "固定筛选猫超 D002 仓，导出近半年锁定数据和近90天出库数据",
                    "清空空字符，统一把货品代码、数量等文本数字转为数值",
                    "删除已全部出库/入库的调拨单，按货品代码、仓库和库存状态合并",
                ]
            ),
            "actions": (
                [
                    {"result": "周下单需求", "who": "计划部", "what": "下采购申请单", "where": "金蝶系统/OA"},
                    {"result": "备货计划", "who": "计划部", "what": "确认备货数量并更新周预测表", "where": "周预测表/共享文件"},
                    {"result": "跨仓调拨", "who": "计划部", "what": "确认调拨数量", "where": "周预测表/共享文件"},
                ]
                if not is_cat_super
                else [
                    {"result": "正常补货", "who": "计划/采购", "what": "确认补货数量并提交补货单", "where": "采购系统"},
                    {"result": "数据异常", "who": "计划部", "what": "核对原始导出文件后再处理", "where": "E3/WMS/Excel"},
                ]
            ),
        }
    )
    if is_cat_super:
        facts["has_rpa"] = True
    facts["has_api"] = facts["has_api"] or "api" in text.lower()
    facts["has_file"] = True


def _apply_carrier_facts(facts: dict[str, Any]) -> None:
    facts.update(
        {
            "goal": "每月把承运商账单与 WMS 发货明细、快递报价表逐单核对，先拦截差异，再提交付款。",
            "object": "快递发货单、计费重量和应付金额",
            "scope": "WMS 当月发货明细、微信群/微信承运商账单、快递报价表和 OA 付款流程",
            "trigger": "每月收到承运商账单后",
            "process_sentence": "提取发货和计费字段，按报价表计算合同应计金额，再比较重量、体积重、金额和省份差异",
            "input_names": ["WMS发货明细", "承运商账单", "快递报价表"],
            "systems": ["WMS", "微信/微信群", "Excel/报价表", "OA"],
            "rules": [
                "体积重 = 体积 × 1000000 / 抛重值",
                "重量差异或体积重差异 ≥ 0.3kg，标记异常",
                "金额差异 > 0元，标记异常；收货人省份与计费省份不一致，标记异常",
            ],
            "outputs": ["快递发货明细", "对账明细表", "异常差异清单", "付款明细"],
            "actions": [
                {"result": "无异常", "who": "物流", "what": "汇总付款明细并递交付款", "where": "OA"},
                {"result": "异常", "who": "陈娟惠/物流", "what": "复查重量、报价或区域加收，并与承运商确认", "where": "微信"},
            ],
            "has_api": True,
            "has_file": True,
        }
    )


def _apply_refund_facts(facts: dict[str, Any], text: str) -> None:
    facts.update(
        {
            "goal": "根据订单、物流和退款原因自动判断可直接通过的退款，复杂或高风险退款转人工复核。",
            "object": "退款申请、订单履约状态和退款证据",
            "scope": "订单/退款后台、物流信息、退款原因及人工复核结果",
            "trigger": "退款申请进入审核队列后",
            "process_sentence": "读取订单和退款证据，先做金额、物流、原因和重复申请校验，再按规则分为自动通过、驳回或人工复核",
            "input_names": ["订单信息", "退款申请与原因", "物流/签收状态", "退款金额", "凭证或客服备注"],
            "systems": ["订单系统", "退款后台", "物流系统", "客服系统", "企业微信/钉钉"],
            "rules": [
                "金额、证据和订单状态满足已确认规则时进入自动处理",
                "高金额、证据不足、物流状态冲突或疑似重复退款转人工",
                "规则无法匹配时不自动通过，保留原始信息和判断原因",
            ],
            "outputs": ["审核结果", "人工复核清单", "异常原因和处理记录"],
            "actions": [
                {"result": "规则命中", "who": "系统", "what": "通过或驳回退款并记录原因", "where": "退款后台"},
                {"result": "边界/异常", "who": "客服", "what": "复核订单和凭证后决定退款", "where": "客服/退款后台"},
            ],
        }
    )
    facts["has_api"] = facts["has_api"] or _contains_any(text, ("接口", "api"))


def _apply_profile_facts(facts: dict[str, Any], profile: dict[str, Any]) -> None:
    target = profile.get(profile.get("type") or "") or {}
    inputs = target.get("inputs") if profile.get("type") == "decision" else target.get("steps")
    for item in inputs or []:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("action") or item.get("input")
        if name:
            facts["input_names"].append(str(name))
        facts["inputs"].append(item)
        if item.get("action"):
            facts["process_points"].append(str(item["action"]))
    facts["rules"] = _split_points(target.get("rules"))
    facts["outputs"] = _unique_text(
        [item.get("output") for item in inputs or [] if isinstance(item, dict) and item.get("output")]
    )
    facts["actions"] = [
        item for item in target.get("actions") or [] if isinstance(item, dict)
    ]
    facts["systems"] = _unique_text(
        [
            (profile.get("businessContext") or {}).get("systemLandscape"),
            *[item.get("source") for item in inputs or [] if isinstance(item, dict)],
        ]
    )


def _merge_profile_facts(facts: dict[str, Any], profile: dict[str, Any]) -> None:
    target = profile.get(profile.get("type") or "") or {}
    inputs = target.get("inputs") if profile.get("type") == "decision" else target.get("steps")
    if not facts["inputs"]:
        facts["inputs"] = [item for item in inputs or [] if isinstance(item, dict)]
    if not facts["actions"]:
        facts["actions"] = [
            item for item in target.get("actions") or [] if isinstance(item, dict)
        ]
    facts["rules"] = _unique_text(facts["rules"] + _split_points(target.get("rules")))
    facts["outputs"] = _unique_text(
        facts["outputs"]
        + [
            item.get("output")
            for item in inputs or []
            if isinstance(item, dict) and item.get("output")
        ]
    )


def _best_goal(
    project: dict[str, Any],
    context: dict[str, Any],
    target: dict[str, Any],
    domain: str,
) -> str:
    if domain == "inventory":
        return "根据销售、库存、在途和采购周期计算补货/采购需求，降低缺货与库存风险。"
    if domain == "carrier_reconciliation":
        return "核对承运商账单与合同报价，识别差异后再付款。"
    if domain == "refund":
        return "把规则明确的退款自动处理，边界和异常退款交给人工复核。"
    return _first_real(
        [project.get("summary"), target.get("purpose"), context.get("businessObject")],
        "把当前人工处理流程整理成可执行的前置方案",
    )


def _best_object(
    project: dict[str, Any],
    context: dict[str, Any],
    target: dict[str, Any],
    domain: str,
) -> str:
    if domain == "inventory":
        return "SKU、库存、在途和采购需求"
    if domain == "carrier_reconciliation":
        return "快递账单与发货明细"
    if domain == "refund":
        return "退款申请及其订单证据"
    return _first_real(
        [context.get("businessObject"), target.get("name"), project.get("title")],
        "当前需求对象",
    )


def _best_scope(
    context: dict[str, Any],
    target: dict[str, Any],
    domain: str,
) -> str:
    if domain == "inventory":
        return "现有库存、销售计划、销售趋势和各类在途数据"
    if domain == "carrier_reconciliation":
        return "当月 WMS 发货、承运商账单、报价表和付款申请"
    if domain == "refund":
        return "订单、物流、退款原因、金额和凭证"
    return _first_real(
        [context.get("scope"), context.get("currentProcess"), target.get("name")],
        "首期范围待评审确认",
    )


def _best_trigger(profile: dict[str, Any], target: dict[str, Any], domain: str) -> str:
    if domain == "inventory":
        return "每周开始库存预测/补货处理时"
    if domain == "carrier_reconciliation":
        return "承运商账单到达后"
    if domain == "refund":
        return "退款申请进入审核队列后"
    frequency = target.get("frequency")
    if isinstance(frequency, dict) and frequency.get("unit"):
        return f"按{frequency.get('unit')}执行时"
    return "达到业务触发条件时"


def _domain_key(text: str) -> str:
    normalized = _normalize(text)
    if _contains_any(normalized, ("快递账单", "承运商账单", "对账明细", "计费重量")):
        return "carrier_reconciliation"
    if _contains_any(normalized, ("退款", "售后", "退货", "退款审核")):
        return "refund"
    if _contains_any(
        normalized,
        ("库存周转", "周预测", "补货", "备货", "调拨", "采购回货", "平台库存", "猫超"),
    ):
        return "inventory"
    return "general"


def _conclusion(facts: dict[str, Any], is_full_auto: bool) -> str:
    if is_full_auto:
        return f"把{facts['trigger']}、数据处理和规则明确的执行动作串起来；需要业务判断的结果仍转人工。"
    return f"先自动完成取数、整理和计算，生成{_join_text(facts['outputs'], '建议清单')}，由业务确认后执行。"


def _human_boundary(facts: dict[str, Any], is_full_auto: bool) -> str:
    if is_full_auto:
        boundaries = {
            "inventory": "数据冲突、规则未覆盖或采购/调拨超出授权范围时由计划部确认",
            "carrier_reconciliation": "重量、体积重、金额或省份异常由物流复核，付款审批保留人工",
            "refund": "高金额、证据不足、物流状态冲突或规则未命中时由客服复核",
        }
        return boundaries.get(
            facts["domain"],
            "异常、越权、规则未覆盖和最终审批",
        )
    if facts["human_actions"]:
        return _join_text(facts["human_actions"], "异常复核和最终确认")
    return "确认建议、处理异常和在原系统提交结果"


def _process_sentence(facts: dict[str, Any]) -> str:
    if facts["rules"]:
        return "；".join(facts["rules"][:3])
    return "按输入数据整理、计算并生成结果"


def _automation_scope(facts: dict[str, Any], plan_type: Optional[str]) -> str:
    actions = _join_text(facts["outputs"], "结果清单")
    if plan_type == "full_auto":
        return f"用脚本和{('RPA/API' if facts['has_rpa'] or facts['has_api'] else '定时任务')}完成取数、计算和{actions}；规则明确的提交动作自动执行，边界结果转人工"
    if facts["has_rpa"]:
        return f"用 RPA/API/文件完成取数和{actions}，页面提交及边界判断保留人工接管"
    return f"用脚本完成取数、计算和{actions}，业务系统写入由人工确认"


def _access_summary(facts: dict[str, Any]) -> str:
    methods = []
    if facts["has_api"]:
        methods.append("稳定接口只读/API")
    if facts["has_file"]:
        methods.append("Excel/CSV 文件导入")
    if facts["has_rpa"]:
        methods.append("RPA 页面操作")
    return "、".join(methods) if methods else "先以文件导入验证，接口和 RPA 入口待确认"


def _data_flow(facts: dict[str, Any], is_full_auto: bool) -> str:
    chain = (
        "各系统数据 -> 脚本拉取/读取 -> 清洗合并 -> 计算指标 -> 生成建议 -> 输出报告 -> 推送通知"
    )
    if facts["systems"]:
        chain += f"（来源：{_join_text(facts['systems'], '各系统')}）"
    if is_full_auto:
        return chain + " -> 规则明确动作自动提交/回写 -> 日志留痕 -> 异常转人工"
    return chain + " -> 人工审核执行"


def _integration_points(facts: dict[str, Any]) -> list[str]:
    points = []
    for system in facts["systems"]:
        if system in {"企业微信/钉钉", "企业微信/钉钉机器人"}:
            continue
        if system in {"WMS"}:
            points.append("WMS API 或定时导出（库存/发货明细）")
        elif "E3" in system:
            points.append("百胜E3：API/CSV 优先；无稳定接口时用受控 RPA 导出")
        elif "电商后台" in system or "平台后台" in system:
            points.append(f"{system}：API、定时导出或 RPA 取数")
        elif "Excel" in system or "文档" in system or "文件" in system:
            points.append("Excel/CSV 文件导入（销售计划、在途、代码对照等）")
        elif "微信" in system:
            points.append("微信/微信群：人工上传承运商账单或确认异常")
        elif "OA" in system or "金蝶" in system:
            points.append(f"{system}：采购/付款申请输出或回写")
        else:
            points.append(f"{system}：取数或结果输出")
    points.append("企业微信/钉钉机器人：完成、失败和异常通知")
    return _unique_text(points)


def _dependencies(facts: dict[str, Any], is_full_auto: bool) -> list[str]:
    items = ["Python 运行环境、定时任务和统一文件落盘目录"]
    if facts["has_api"]:
        items.append("API 地址、鉴权方式、只读/写入权限和调用频率")
    if facts["has_file"]:
        items.append("Excel/CSV 模板、字段口径、文件命名和交接人")
    if facts["has_rpa"]:
        items.append("RPA 运行器、业务账号、页面定位规则和失败接管人")
    if facts["rules"]:
        items.append("公式、阈值、例外条件和结果对应动作")
    if is_full_auto:
        items.append("自动提交/回写权限、幂等校验、停用开关和操作日志")
    else:
        items.append("业务人员确认建议后在原系统执行")
    return _unique_text(items)


def _environment_variables(facts: dict[str, Any], is_full_auto: bool) -> list[str]:
    values = []
    systems = " ".join(facts["systems"])
    if facts["has_api"] and "WMS" in systems:
        values.append("WMS_API_KEY=WMS接口密钥")
    if facts["has_api"] and _contains_any(systems, ("电商", "平台后台", "订单", "退款")):
        values.append("ECOM_API_KEY=电商/订单系统接口密钥")
    if facts["has_api"] and "E3" in systems:
        values.append("E3_API_KEY=百胜E3接口密钥（如采用接口）")
    if facts["has_file"]:
        values.append("SOURCE_FILE_PATH=Excel/CSV 文件路径")
    values.append("WEBHOOK_URL=企业微信/钉钉机器人地址")
    if facts["has_rpa"]:
        values.append("RPA_PROFILE=机器人账号与流程配置")
    if is_full_auto:
        values.append("TASK_SCHEDULE=定时任务执行时间")
    return _unique_text(values)


def _test_plan(facts: dict[str, Any], is_full_auto: bool) -> list[str]:
    items = [
        f"用样例数据跑通：{_join_text(facts['input_names'], '输入数据')} -> {_join_text(facts['outputs'], '输出结果')}",
        "验证字段缺失、重复数据、文本数字和空文件不会生成错误结果",
    ]
    if facts["rules"]:
        items.append("验证公式、阈值边界和规则未命中时的人工转办")
    if facts["has_api"] or facts["has_rpa"]:
        items.append("模拟 API 超时、RPA 页面变化或下载失败，检查重试、截图/日志和告警")
    if is_full_auto:
        items.append("验证重复触发、无权限、回写失败和停用开关，不产生重复提交")
    else:
        items.append("验证报告推送后人工确认、修改和重新执行的留痕")
    return items


def _definition_of_done(facts: dict[str, Any], is_full_auto: bool) -> list[str]:
    items = [
        f"能按预定频率读取{_join_text(facts['input_names'], '输入数据')}并生成{_join_text(facts['outputs'], '结果')}",
        "结果包含原始数据定位、计算字段、判断结果和异常原因",
        "阈值、数据源、文件路径、调度时间和通知地址可配置",
        "取数/解析失败有日志和告警，异常结果有人工接管路径",
    ]
    if is_full_auto:
        items.append("规则明确且权限已确认的动作才能自动提交；重复、越权和失败不自动执行")
    else:
        items.append("系统只生成建议/报告，不绕过人工确认写入业务系统")
    return items


def _split_points(value: Any) -> list[str]:
    if not value:
        return []
    text = str(value).strip()
    parts = re.split(r"(?:\n+|；|;\s*|\d+[、.)])", text)
    return _unique_text(item.strip(" 。") for item in parts if item.strip())


def _extract_systems(text: str) -> list[str]:
    normalized = _normalize(text)
    candidates = [
        ("百胜E3", ("百胜e3", "e3库存", "e3后台", "e3客户端")),
        ("WMS", ("wms",)),
        ("各电商后台", ("各电商后台", "平台后台", "电商后台")),
        ("数仓", ("数仓",)),
        ("Excel/线下文档", ("excel", "线下文档", "线下表格")),
        ("微信/微信群", ("微信/微信群", "微信群", "微信")),
        ("OA", ("oa", "付款流程", "审批流")),
        ("金蝶系统", ("金蝶",)),
        ("订单系统", ("订单系统",)),
        ("退款后台", ("退款后台",)),
        ("物流系统", ("物流系统", "物流信息")),
        ("客服系统", ("客服系统", "客服")),
        ("天机", ("天机",)),
        ("采购系统", ("采购系统", "补货系统")),
    ]
    return [name for name, markers in candidates if any(marker in normalized for marker in markers)]


def _contains_any(value: Any, markers: tuple[str, ...]) -> bool:
    text = _normalize(value)
    return any(marker.lower() in text for marker in markers)


def _normalize(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "")


def _first_real(values: list[Any], fallback: str) -> str:
    for value in values:
        text = str(value or "").strip()
        if not text or text in {"待确认", "暂不设定具体数字"}:
            continue
        if len(text) > 180:
            text = text[:180].rstrip("，。；")
        return text
    return fallback


def _display(value: Any) -> str:
    text = str(value or "").strip()
    return text if text and text != "待确认" else "待确认"


def _join_text(values: Any, fallback: str) -> str:
    result = _unique_text(values if isinstance(values, list) else [values])
    return "、".join(result[:8]) if result else fallback


def _unique_text(values: Any) -> list[str]:
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in {"待确认", "无"} or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result
