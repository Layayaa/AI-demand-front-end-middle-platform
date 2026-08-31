import re
from copy import deepcopy
from typing import Any, Optional

from .qibang_context import (
    business_chain_from_answer,
    business_chain_label,
    business_chain_options,
    candidate_signals,
    empty_business_context,
    questions_for_business_chain,
)


DIMENSIONS = ("收入", "成本", "客户满意度", "库存风险", "合规风险", "其他")
SOURCES = (
    "金蝶云",
    "电商后台",
    "生意参谋",
    "客服系统",
    "WMS仓储",
    "飞书",
    "钉钉",
    "企微",
    "影刀",
    "Excel",
    "本地文件",
    "口头或经验",
)
METHODS = ("API实时取", "定时导出", "RPA抓取", "人工提供", "拿不到·待确认")

DECISION_QUESTIONS = (
    {
        "key": "name",
        "label": "决策名称",
        "prompt": "这个决策叫什么名字？一句话说清在什么场景下做什么判断。",
        "hint": "例如：滞销 SKU 该降价、清仓还是做货损？",
        "required": True,
    },
    {
        "key": "department",
        "label": "归属部门",
        "prompt": "这个需求归属哪个部门或岗位？",
        "hint": "例如：商品运营。",
        "required": False,
    },
    {
        "key": "decisionMaker",
        "label": "决策人",
        "prompt": "谁是最终拍板人？",
        "hint": "例如：运营主管。",
        "required": True,
    },
    {
        "key": "frequency",
        "label": "决策频率",
        "prompt": "这个判断多久做一次？请带上数字和单位。",
        "hint": "例如：3 次/天、1 次/周、2 次/月。",
        "chips": ("1次/天", "1次/周", "1次/月"),
        "required": True,
    },
    {
        "key": "value",
        "label": "业务影响",
        "prompt": "这项需求如果不做或做错，具体会影响什么？请描述真实影响，不用先判断高、中、低。",
        "hint": "可以说断货、积压、销售或毛利、客户体验、合规，或者只是节省人工；暂时不确定也可以。",
        "chips": (
            "可能影响库存或供应链",
            "可能影响销售或毛利",
            "主要是节省人工",
            "主要改善客户体验",
            "暂时不确定",
        ),
        "required": False,
        "ai_only": True,
    },
    {
        "key": "dimensions",
        "label": "影响维度",
        "prompt": "它主要影响哪些维度？可以多选。",
        "hint": "收入、成本、客户满意度、库存风险、合规风险或其他。",
        "chips": DIMENSIONS[:-1],
        "required": False,
    },
    {
        "key": "purpose",
        "label": "决策目的",
        "prompt": "做这个判断最想解决什么业务问题？",
        "hint": "例如：减少库存资金沉淀和仓储费用。",
        "required": True,
    },
    {
        "key": "timeCostMin",
        "label": "单次耗时",
        "prompt": "现在每次完成这个判断大约需要多少分钟？",
        "hint": "例如：30 分钟。",
        "required": False,
    },
    {
        "key": "people",
        "label": "参与人数",
        "prompt": "通常有几个人参与这个判断？",
        "hint": "例如：2 人。",
        "required": False,
    },
    {
        "key": "inputs",
        "label": "输入数据",
        "prompt": "做判断需要哪些输入数据？请先说一条，并说明来自哪里、如何获取。",
        "hint": "例如：近 30 天销量，来自生意参谋，定时导出。",
        "repeat": True,
        "required": True,
    },
    {
        "key": "rules",
        "label": "分析规则",
        "prompt": "拿到数据后，当前是怎么分析或计算的？",
        "hint": "可以写公式、判断顺序或已有经验规则。",
        "required": True,
    },
    {
        "key": "standards",
        "label": "判断标准",
        "prompt": "根据分析结果，什么情况会得出什么结论？请先说一条。",
        "hint": "例如：周转天数大于 120 天且毛利低于 10%，建议清仓。",
        "repeat": True,
        "required": True,
    },
    {
        "key": "actions",
        "label": "对应行动",
        "prompt": "这个判断结果落地后，谁要做什么动作？请先说一条。",
        "hint": "例如：建议清仓后，由商品运营在商品后台创建清仓活动。",
        "repeat": True,
        "required": True,
    },
)

SOP_QUESTIONS = (
    {
        "key": "name",
        "label": "流程名称",
        "prompt": "这条流程叫什么名字？",
        "hint": "例如：商品优化建议流程。",
        "required": True,
    },
    {
        "key": "department",
        "label": "归属部门",
        "prompt": "这条流程归属哪个部门？",
        "hint": "例如：商品运营。",
        "required": False,
    },
    {
        "key": "owner",
        "label": "流程负责人",
        "prompt": "谁负责这条流程的结果和异常处理？",
        "hint": "例如：运营主管。",
        "required": True,
    },
    {
        "key": "frequency",
        "label": "流程频率",
        "prompt": "这条流程多久跑一次？请带上数字和单位。",
        "hint": "例如：1 次/天、1 次/周。",
        "chips": ("1次/天", "1次/周", "1次/月"),
        "required": True,
    },
    {
        "key": "value",
        "label": "业务影响",
        "prompt": "这条流程如果不做或做错，具体会影响什么？请描述真实影响，不用先判断高、中、低。",
        "hint": "可以说断货、积压、销售或毛利、客户体验、合规，或者只是节省人工；暂时不确定也可以。",
        "chips": (
            "可能影响库存或供应链",
            "可能影响销售或毛利",
            "主要是节省人工",
            "主要改善客户体验",
            "暂时不确定",
        ),
        "required": False,
        "ai_only": True,
    },
    {
        "key": "dimensions",
        "label": "影响维度",
        "prompt": "它主要影响哪些维度？可以多选。",
        "hint": "收入、成本、客户满意度、库存风险、合规风险或其他。",
        "chips": DIMENSIONS[:-1],
        "required": False,
    },
    {
        "key": "durationMin",
        "label": "单次耗时",
        "prompt": "现在跑完整条流程大约需要多少分钟？",
        "hint": "例如：45 分钟。",
        "required": False,
    },
    {
        "key": "people",
        "label": "涉及人数",
        "prompt": "整条流程通常涉及几个人？",
        "hint": "例如：5 人。",
        "required": False,
    },
    {
        "key": "purpose",
        "label": "流程目的",
        "prompt": "这条流程最想解决什么业务问题？",
        "hint": "例如：缩短商品优化的人工处理周期。",
        "required": True,
    },
    {
        "key": "steps",
        "label": "流程步骤",
        "prompt": "请按顺序描述流程中的每一步。先说第一步即可。",
        "hint": "例如：运营从客服系统导出聊天记录并汇总成问题清单，15 分钟。",
        "repeat": True,
        "required": True,
    },
)

TYPE_PROMPT = (
    "先判断这个需求的形态：它更像是“基于信息做一个判断”，还是“按步骤跑一条流程”？"
)
TYPE_HINT = "回复“1. 做判断”或“2. 跑流程”，也可以继续描述业务场景，我来判断。"
BUSINESS_CHAIN_QUESTION = {
    "key": "businessChain",
    "label": "业务链路",
    "prompt": "为了按广州七邦科技的实际业务来澄清，先确认这项需求属于哪条业务链路？",
    "hint": "我只会把你确认的信息写入需求画像；标题和既有材料中的线索都不会自动当成事实。",
    "chips": tuple(business_chain_options()),
    "required": True,
}

FREEFORM_QUESTION = {
    "key": "other",
    "label": "自由澄清",
    "prompt": "请继续用自己的话补充这项需求中最关键的事实、影响或例外情况，不需要按固定问题逐项回答。",
    "hint": "可以直接描述当前怎么做、哪里出问题、希望改变什么，或上传相关材料。",
    "chips": (),
    "required": False,
}

# Questions that materially change feasibility, risk, authorization or acceptance
# are asked before descriptive and efficiency fields in deterministic fallback mode.
HIGH_IMPACT_PRIORITY = {
    "type": 0,
    "businessObject": 1,
    "scope": 2,
    "approvalBoundary": 3,
    "dataDefinition": 4,
    "systemLandscape": 5,
    "currentProcess": 6,
    "successMetric": 7,
    "inputs": 8,
    "rules": 9,
    "steps": 9,
    "purpose": 10,
    "owner": 11,
    "decisionMaker": 11,
}


def new_profile(
    *,
    title: str,
    department: Optional[str],
    summary: Optional[str],
    requirement_type: Optional[str],
) -> dict[str, Any]:
    detected_type = requirement_type if requirement_type in {"decision", "sop"} else detect_type(
        " ".join(part for part in (title, summary or "") if part)
    )
    profile = {
        "type": detected_type,
        "stage": "clarifying",
        "activeQuestion": None,
        "aiJudged": False,
        "aiGaps": [],
        "businessContext": empty_business_context(title, summary),
        "decision": {
            "name": "",
            "department": "",
            "decisionMaker": "",
            "frequency": None,
            "value": None,
            "dimensions": [],
            "purpose": "",
            "timeCostMin": None,
            "people": None,
            "inputs": [],
            "rules": "",
            "standards": [],
            "actions": [],
        },
        "sop": {
            "name": "",
            "department": "",
            "owner": "",
            "frequency": None,
            "value": None,
            "dimensions": [],
            "purpose": "",
            "durationMin": None,
            "people": None,
            "steps": [],
        },
        "skipped": [],
        "closedLists": [],
        "notes": [summary.strip()] if summary and summary.strip() else [],
        "completeness": 0,
    }
    for kind in ("decision", "sop"):
        target = profile[kind]
        target["name"] = title.strip()
        target["department"] = (department or "").strip()
    profile["completeness"] = completeness_of(profile)
    return profile


def normalize_profile(value: dict[str, Any]) -> dict[str, Any]:
    existing_context = value.get("businessContext")
    base = new_profile(title="", department="", summary="", requirement_type=None)
    profile = deepcopy(base)
    for key in ("type", "stage", "activeQuestion", "aiJudged", "aiGaps", "skipped", "closedLists", "notes", "sourceEvidence", "materialCandidates"):
        if key in value:
            profile[key] = value[key]
    for kind in ("decision", "sop"):
        if isinstance(value.get(kind), dict):
            profile[kind].update(value[kind])
    if isinstance(existing_context, dict):
        profile["businessContext"].update(existing_context)
    else:
        profile["businessContext"] = empty_business_context(
            profile["decision"].get("name") or profile["sop"].get("name") or "",
            " ".join(profile.get("notes") or []),
        )
    context = profile["businessContext"]
    selected_chain = context.get("businessChain") or context.get("candidateBusinessChain") or "other"
    context["candidateSignals"] = list(context.get("candidateSignals") or candidate_signals(selected_chain))
    profile["skipped"] = list(dict.fromkeys(profile.get("skipped") or []))
    profile["closedLists"] = list(dict.fromkeys(profile.get("closedLists") or []))
    profile["notes"] = list(profile.get("notes") or [])
    profile["sourceEvidence"] = list(profile.get("sourceEvidence") or [])
    profile["materialCandidates"] = list(profile.get("materialCandidates") or [])
    profile["completeness"] = completeness_of(profile)
    return profile


def next_message(profile: dict[str, Any]) -> dict[str, Any]:
    profile = normalize_profile(profile)
    if profile["stage"] == "done":
        return {
            "content": "需求画像已经确认，已进入等待评审状态。",
            "chips": [],
            "stage": "done",
        }

    if profile["stage"] == "confirm":
        return {
            "content": build_summary(profile),
            "chips": ["确认需求画像", "继续补充"],
            "stage": "confirm",
        }

    active_question = active_question_for(profile)
    if active_question is not None:
        content = active_question.get("content") or active_question["prompt"]
        chips = list(active_question.get("chips") or [])
        return {
            "content": content,
            "chips": chips,
            "stage": "clarifying",
            "questionKey": active_question["key"],
        }

    content = f"{FREEFORM_QUESTION['prompt']}\n\n{FREEFORM_QUESTION['hint']}"
    return {
        "content": content,
        "chips": [],
        "stage": "clarifying",
        "questionKey": FREEFORM_QUESTION["key"],
    }


def apply_answer(profile: dict[str, Any], answer: str) -> dict[str, Any]:
    profile = normalize_profile(profile)
    text = normalize_text(answer)
    if not text:
        return {"profile": profile, "changed": False, "reason": "empty"}

    if profile["stage"] == "done":
        return {"profile": profile, "changed": False, "reason": "done"}

    if profile["stage"] == "confirm":
        if is_confirm(text):
            if not profile.get("aiJudged"):
                profile["stage"] = "clarifying"
                profile["activeQuestion"] = {
                    "key": FREEFORM_QUESTION["key"],
                    "content": "请先让 AI 结合当前对话判断信息是否足够，再确认需求画像。",
                    "chips": [],
                }
                profile["aiJudged"] = False
                profile["completeness"] = completeness_of(profile)
                return {
                    "profile": profile,
                    "changed": False,
                    "reason": "confirmation_blocked",
                    "gaps": [],
                }
            profile["stage"] = "done"
            profile["completeness"] = completeness_of(profile)
            return {"profile": profile, "changed": True, "done": True}
        continue_requested = wants_more_clarification(text)
        if text not in {"继续补充", "补充"} and not continue_requested:
            profile["notes"].append(text)
        profile["stage"] = "clarifying"
        if continue_requested:
            gap = next(
                (
                    item
                    for item in confirmation_gaps_for(profile)
                    if item.get("key") != "materialReview"
                ),
                None,
            )
            key = str(gap.get("key")) if gap else ""
            question = question_by_key(profile, key) if key else None
            if question is None:
                question = _next_unanswered_question(profile, excluded=set())
            if question is not None:
                profile["activeQuestion"] = {
                    "key": question["key"],
                    "content": question["prompt"],
                    "chips": list(question.get("chips") or []),
                }
            return {"profile": profile, "changed": True, "reason": "continue_requested"}
        return {"profile": profile, "changed": True, "reason": "continue_clarification"}

    active_question = active_question_for(profile)
    context_question = (
        active_question
        if active_question is not None and is_business_context_key(active_question["key"])
        else None
    )
    if context_question is not None:
        key = context_question["key"]
        if is_skip(text):
            profile["skipped"] = list(dict.fromkeys([*profile["skipped"], key]))
            profile["completeness"] = completeness_of(profile)
            return {"profile": profile, "changed": True, "skipped": True}
        if key == "businessChain":
            business_chain = business_chain_from_answer(text)
            if business_chain is not None:
                profile["businessContext"]["businessChain"] = business_chain
                profile["businessContext"]["candidateSignals"] = candidate_signals(business_chain)
            else:
                detected_type = detect_type(text)
                recorded_object = detected_type is None
                if detected_type is not None:
                    profile["type"] = detected_type
                else:
                    # The requester may answer with a business fact instead of
                    # choosing a chain. Preserve it, then ask the chain once more.
                    profile["businessContext"]["businessObject"] = text
                    profile["notes"].append(text)
                profile["activeQuestion"] = {
                    "key": "businessChain",
                    "content": BUSINESS_CHAIN_QUESTION["prompt"],
                    "chips": list(BUSINESS_CHAIN_QUESTION.get("chips") or []),
                }
                profile["completeness"] = completeness_of(profile)
                return {
                    "profile": profile,
                    "changed": True,
                    "reason": "business_chain_unclear",
                    "recordedBusinessObject": recorded_object,
                }
        else:
            profile["businessContext"][key] = text
        profile["completeness"] = completeness_of(profile)
        return {"profile": profile, "changed": True}

    if profile["type"] not in {"decision", "sop"}:
        requirement_type = detect_type(text)
        if requirement_type:
            profile["type"] = requirement_type
            profile["stage"] = "clarifying"
            target = profile[requirement_type]
            profile["completeness"] = completeness_of(profile)
            return {"profile": profile, "changed": True}
        profile["notes"].append(text)
        return {"profile": profile, "changed": True, "reason": "freeform"}

    question = active_question or dict(FREEFORM_QUESTION)

    key = question["key"]
    target = profile[profile["type"]]
    if key == FREEFORM_QUESTION["key"]:
        if text not in {"继续补充", "补充"}:
            profile["notes"].append(text)
        profile["completeness"] = completeness_of(profile)
        return {"profile": profile, "changed": True, "reason": "freeform"}
    if is_skip(text):
        if question.get("repeat"):
            _close_list(profile, key)
        else:
            profile["skipped"] = list(dict.fromkeys([*profile["skipped"], key]))
        profile["completeness"] = completeness_of(profile)
        return {"profile": profile, "changed": True, "skipped": True}

    if question.get("repeat") and is_stop(text):
        _close_list(profile, key)
        profile["completeness"] = completeness_of(profile)
        return {"profile": profile, "changed": True, "closed": True}

    recognized = _apply_value(target, profile["type"], key, text)
    if not recognized:
        profile["notes"].append(text)
    profile["completeness"] = completeness_of(profile)
    return {
        "profile": profile,
        "changed": True,
        "reason": "" if recognized else "freeform",
    }


def current_question(profile: dict[str, Any]) -> Optional[dict[str, Any]]:
    if profile.get("type") not in {"decision", "sop"}:
        return {
            "key": "type",
            "label": "需求形态",
            "required": True,
        }
    for question in questions_for(profile["type"]):
        if question["key"] in profile.get("skipped", []):
            continue
        if question.get("repeat"):
            if question["key"] not in profile.get("closedLists", []):
                return question
        elif not _field_is_filled(profile[profile["type"]].get(question["key"])):
            return question
    return None


def active_question_for(profile: dict[str, Any]) -> Optional[dict[str, Any]]:
    active = profile.get("activeQuestion")
    if not isinstance(active, dict):
        return None
    key = active.get("key")
    if not isinstance(key, str) or not key:
        return None
    if key == FREEFORM_QUESTION["key"]:
        result = dict(FREEFORM_QUESTION)
        content = active.get("content")
        if isinstance(content, str) and content.strip():
            result["content"] = content.strip()
        chips = active.get("chips")
        if isinstance(chips, list):
            result["chips"] = [item for item in chips if isinstance(item, str) and item.strip()][:5]
        return result
    question = question_by_key(profile, key)
    if question is None:
        return None
    result = dict(question)
    content = active.get("content")
    if isinstance(content, str) and content.strip():
        result["content"] = content.strip()
    chips = active.get("chips")
    if isinstance(chips, list):
        result["chips"] = [item for item in chips if isinstance(item, str) and item.strip()][:5]
    return result


def question_by_key(profile: dict[str, Any], key: str) -> Optional[dict[str, Any]]:
    if key == FREEFORM_QUESTION["key"]:
        return dict(FREEFORM_QUESTION)
    if key == "type":
        return {
            "key": "type",
            "label": "需求形态",
            "prompt": f"{TYPE_PROMPT}\n\n{TYPE_HINT}",
            "chips": ["1. 做判断", "2. 跑流程"],
            "required": True,
        }

    if key == "businessChain":
        return dict(BUSINESS_CHAIN_QUESTION)

    context = profile.get("businessContext") or {}
    business_chain = context.get("businessChain") or "other"
    for question in questions_for_business_chain(business_chain):
        if question["key"] == key:
            return dict(question)

    if profile.get("type") in {"decision", "sop"}:
        for question in questions_for(profile["type"]):
            if question["key"] == key:
                return dict(question)
    return None


def question_catalog(profile: dict[str, Any]) -> list[dict[str, Any]]:
    profile = normalize_profile(profile)
    questions = [
        question_by_key(profile, "type"),
        question_by_key(profile, "businessChain"),
        question_by_key(profile, FREEFORM_QUESTION["key"]),
    ]
    context = profile.get("businessContext") or {}
    business_chain = context.get("businessChain") or "other"
    questions.extend(question_by_key(profile, item["key"]) for item in questions_for_business_chain(business_chain))
    if profile.get("type") in {"decision", "sop"}:
        questions.extend(question_by_key(profile, item["key"]) for item in questions_for(profile["type"]))
    return [
        {
            "key": question["key"],
            "label": question["label"],
            "prompt": question["prompt"],
            "chips": list(question.get("chips") or []),
        }
        for question in questions
        if question is not None
    ]


def apply_ai_direction(
    profile: dict[str, Any],
    direction: dict[str, Any],
    *,
    answered_key: Optional[str] = None,
    recent_question_texts: Optional[list[str]] = None,
) -> dict[str, Any]:
    profile = normalize_profile(profile)
    profile["aiJudged"] = True
    requirement_type = direction.get("requirementType")
    if profile["type"] not in {"decision", "sop"} and requirement_type in {"decision", "sop"}:
        profile["type"] = requirement_type

    facts = direction.get("facts")
    if isinstance(facts, dict):
        for key, value in facts.items():
            if not isinstance(value, str) or not value.strip():
                continue
            _apply_ai_fact(profile, str(key), value.strip())

    raw_gaps = direction.get("criticalGaps")
    profile["aiGaps"] = [
        {
            "key": str(gap.get("key") or "other"),
            "label": str(gap.get("label") or "待确认项"),
            "severity": "high",
            "reason": str(gap.get("reason") or "该信息会影响方案判断。"),
        }
        for gap in raw_gaps
        if isinstance(gap, dict)
    ][:5] if isinstance(raw_gaps, list) else []

    if direction.get("status") == "ready_to_confirm":
        if profile.get("type") not in {"decision", "sop"}:
            profile["stage"] = "clarifying"
            profile["aiJudged"] = True
            profile["aiGaps"] = [
                {
                    "key": "type",
                    "label": "需求形态",
                    "severity": "high",
                    "reason": "AI 还不能判断这是一次业务判断，还是一条执行流程。",
                }
            ]
            profile["activeQuestion"] = {
                "key": FREEFORM_QUESTION["key"],
                "content": "在进入方案前，请用一句话说明：这项需求更像是做一个业务判断，还是按步骤执行一条流程？",
                "chips": ["做判断", "按步骤执行流程"],
            }
            profile["completeness"] = completeness_of(profile)
            return profile
        profile["stage"] = "confirm"
        profile["activeQuestion"] = None
        profile["completeness"] = completeness_of(profile)
        return profile

    key = direction.get("questionKey")
    question = dict(FREEFORM_QUESTION) if not isinstance(key, str) else question_by_key(profile, key)
    if question is None:
        question = dict(FREEFORM_QUESTION)
    prompt = direction.get("question")
    duplicate_prompt = _same_question_as_recent(prompt, recent_question_texts or [])
    if (
        question is not None
        and not question.get("repeat")
        and _key_has_answer(profile, question["key"])
    ) or duplicate_prompt:
        fallback = _next_unanswered_question(profile, excluded={question["key"]})
        if fallback is not None:
            question = fallback
            key = fallback["key"]
            prompt = None
        else:
            question = dict(FREEFORM_QUESTION)
            key = FREEFORM_QUESTION["key"]
            prompt = (
                "刚才的信息已经记录。请补充一项尚未说明的事实、例外或处理边界，"
                "不需要重复刚才的回答。"
            )

    chips = direction.get("chips")
    profile["stage"] = "clarifying"
    profile["activeQuestion"] = {
        "key": question["key"],
        "content": prompt.strip() if isinstance(prompt, str) and prompt.strip() else question["prompt"],
        "chips": [item for item in chips if isinstance(item, str) and item.strip()][:5]
        if isinstance(chips, list)
        else list(question.get("chips") or []),
    }
    profile["completeness"] = completeness_of(profile)
    return profile


def _same_question_as_recent(
    prompt: Any,
    recent_question_texts: list[str],
) -> bool:
    if not isinstance(prompt, str) or not prompt.strip():
        return False
    normalized = normalize_text(prompt)
    return any(normalized == normalize_text(item) for item in recent_question_texts if item)


def _next_unanswered_question(
    profile: dict[str, Any],
    *,
    excluded: set[str],
) -> Optional[dict[str, Any]]:
    context = profile.get("businessContext") or {}
    candidates: list[dict[str, Any]] = []
    candidates.extend(questions_for_business_chain(context.get("businessChain") or "other"))
    if profile.get("type") in {"decision", "sop"}:
        candidates.extend(questions_for(profile["type"]))

    candidates = sorted(
        enumerate(candidates),
        key=lambda item: (HIGH_IMPACT_PRIORITY.get(item[1]["key"], 100), item[0]),
    )
    for _, question in candidates:
        key = question["key"]
        if key in excluded or key in profile.get("skipped", []):
            continue
        if question.get("repeat"):
            if key in profile.get("closedLists", []):
                continue
            if profile.get(profile.get("type") or "", {}).get(key):
                return dict(question)
            continue
        if not _key_has_answer(profile, key):
            return dict(question)
    return None


def _apply_ai_fact(profile: dict[str, Any], key: str, value: str) -> None:
    if key in {"other", "notes", "impactEvidence", "businessImpact", "assumptions"}:
        profile["notes"].append(value)
        return
    if key in {
        "businessChain",
        "businessObject",
        "scope",
        "currentProcess",
        "dataDefinition",
        "systemLandscape",
        "approvalBoundary",
        "successMetric",
    }:
        if key == "businessChain":
            chain = business_chain_from_answer(value)
            if chain:
                profile["businessContext"]["businessChain"] = chain
                profile["businessContext"]["candidateSignals"] = candidate_signals(chain)
        else:
            profile["businessContext"][key] = value
        return

    target = profile.get(profile.get("type") or "")
    if not isinstance(target, dict):
        return
    if key in {"name", "department", "decisionMaker", "owner", "purpose", "rules", "description"}:
        target[key] = value
    elif key in {"timeCostMin", "durationMin", "people"}:
        matched = re.search(r"\d+(?:\.\d+)?", value)
        if matched:
            target[key] = int(float(matched.group(0)))
    elif key == "frequency":
        matched = re.search(r"(\d+)\s*次?\s*[／/]\s*(天|周|月|年)", value)
        if matched:
            target[key] = {"n": matched.group(1), "unit": matched.group(2)}
    elif key == "value":
        target[key] = extract_value(value)
    elif key == "dimensions":
        target[key] = list(dict.fromkeys(item for item in DIMENSIONS if item in value))


def is_business_context_key(key: str) -> bool:
    if key == "businessChain":
        return True
    return key in {
        item["key"]
        for item in questions_for_business_chain("other")
    }


def current_business_question(profile: dict[str, Any]) -> Optional[dict[str, Any]]:
    context = profile.get("businessContext") or {}
    if (
        "businessChain" not in profile.get("skipped", [])
        and not _field_is_filled(context.get("businessChain"))
    ):
        question = dict(BUSINESS_CHAIN_QUESTION)
        candidate = context.get("candidateBusinessChain")
        if candidate:
            question["hint"] = (
                f"我从当前标题初步猜测它可能与“{business_chain_label(candidate)}”有关，"
                "但这只是 AI 猜测，请按实际情况选择。"
            )
        return question

    business_chain = context.get("businessChain") or "other"
    for question in questions_for_business_chain(business_chain):
        key = question["key"]
        if key in profile.get("skipped", []):
            continue
        if not _field_is_filled(context.get(key)):
            item = dict(question)
            item["required"] = True
            return item
    return None


def gaps_for(profile: dict[str, Any]) -> list[dict[str, str]]:
    profile = normalize_profile(profile)
    gaps = []
    context = profile.get("businessContext") or {}
    business_chain = context.get("businessChain")
    context_questions = [BUSINESS_CHAIN_QUESTION]
    if business_chain:
        context_questions.extend(questions_for_business_chain(business_chain))
    elif "businessChain" in profile.get("skipped", []):
        context_questions.extend(questions_for_business_chain("other"))

    for context_question in context_questions:
        key = context_question["key"]
        if _field_is_filled(context.get(key)):
            continue
        skipped = key in profile.get("skipped", [])
        gaps.append(
            {
                "key": key,
                "label": context_question["label"],
                "severity": "high",
                "reason": (
                    "业务方暂未提供，不能把 AI 猜测或既有材料当作事实。"
                    if skipped
                    else "尚未按实际业务链路确认，不能把 AI 猜测或既有材料当作事实。"
                ),
            }
        )

    if profile["type"] not in {"decision", "sop"}:
        return [
            *gaps,
            {
                "key": "type",
                "label": "需求形态",
                "severity": "high",
                "reason": "尚未判断是单点决策还是 SOP 流程。",
            }
        ]

    target = profile[profile["type"]]
    for question in questions_for(profile["type"]):
        if question.get("ai_only"):
            continue
        key = question["key"]
        has_value = (
            key in profile["closedLists"] and bool(target.get(key))
            if question.get("repeat")
            else _field_is_filled(target.get(key))
        )
        if has_value:
            continue
        skipped = key in profile["skipped"] or key in profile["closedLists"]
        if not question["required"] and skipped:
            continue
        gaps.append(
            {
                "key": key,
                "label": question["label"],
                "severity": "high" if question["required"] else "medium",
                "reason": "业务方暂未提供，需在评审或后续澄清中确认。",
            }
        )
    return gaps


def confirmation_gaps_for(profile: dict[str, Any]) -> list[dict[str, str]]:
    """Minimum evidence required before the AI may ask the user to confirm."""
    profile = normalize_profile(profile)
    gaps: list[dict[str, str]] = []
    context = profile.get("businessContext") or {}

    pending_material = [
        item
        for item in profile.get("materialCandidates") or []
        if isinstance(item, dict) and item.get("status") in {"pending", "conflict"}
    ]
    if pending_material:
        conflict_count = sum(item.get("status") == "conflict" for item in pending_material)
        gaps.append(
            {
                "key": "materialReview",
                "label": "材料提取确认",
                "severity": "high",
                "reason": (
                    f"还有 {len(pending_material)} 条材料候选未处理，其中 {conflict_count} 条存在来源冲突。"
                    if conflict_count
                    else f"还有 {len(pending_material)} 条材料候选需要接受、修改或驳回。"
                ),
            }
        )

    if profile.get("type") not in {"decision", "sop"}:
        gaps.append(
            {
                "key": "type",
                "label": "需求形态",
                "severity": "high",
                "reason": "还不能判断这是一次判断，还是一条需要执行的流程。",
            }
        )

    if not _field_is_filled(context.get("businessObject")):
        gaps.append(
            {
                "key": "businessObject",
                "label": "业务对象",
                "severity": "high",
                "reason": "还不清楚要处理什么对象、产出什么结果。",
            }
        )
    if not _field_is_filled(context.get("scope")) and "scope" not in profile.get("skipped", []):
        gaps.append(
            {
                "key": "scope",
                "label": "适用范围",
                "severity": "high",
                "reason": "没有范围就无法判断首期边界和方案规模。",
            }
        )
    if not _field_is_filled(context.get("currentProcess")) and not _field_is_filled(context.get("systemLandscape")):
        gaps.append(
            {
                "key": "currentProcess",
                "label": "当前处理方式",
                "severity": "high",
                "reason": "还不知道现在由谁、在什么环节、用什么方式完成这项工作。",
            }
        )
    if not _field_is_filled(context.get("approvalBoundary")) and not _field_is_filled(context.get("successMetric")):
        gaps.append(
            {
                "key": "approvalBoundary",
                "label": "自动化与审批边界",
                "severity": "high",
                "reason": "还无法判断哪些能自动做，以及异常时如何交给人工。",
            }
        )

    if profile.get("type") == "decision":
        target = profile["decision"]
        if not _field_is_filled(target.get("purpose")):
            gaps.append(
                {
                    "key": "purpose",
                    "label": "决策目的",
                    "severity": "high",
                    "reason": "还不清楚这个判断要解决什么业务问题。",
                }
            )
        if not any(_field_is_filled(target.get(key)) for key in ("inputs", "rules", "standards", "actions")):
            gaps.append(
                {
                    "key": "inputs",
                    "label": "判断依据",
                    "severity": "high",
                    "reason": "还没有任何数据、规则或动作依据，无法判断解决方案形态。",
                }
            )
    elif profile.get("type") == "sop":
        target = profile["sop"]
        if not _field_is_filled(target.get("owner")):
            gaps.append(
                {
                    "key": "owner",
                    "label": "流程负责人",
                    "severity": "high",
                    "reason": "还没有明确谁对流程结果和异常负责。",
                }
            )
        if not _field_is_filled(target.get("purpose")):
            gaps.append(
                {
                    "key": "purpose",
                    "label": "流程目的",
                    "severity": "high",
                    "reason": "还不清楚这条流程要解决什么业务问题。",
                }
            )
        if not _field_is_filled(target.get("steps")):
            gaps.append(
                {
                    "key": "steps",
                    "label": "流程步骤",
                    "severity": "high",
                    "reason": "还没有任何可评审的流程动作，无法设计半自动或全自动方案。",
                }
            )
    return gaps


def visible_gaps_for(profile: dict[str, Any]) -> list[dict[str, str]]:
    profile = normalize_profile(profile)
    ai_gaps = profile.get("aiGaps")
    if profile.get("aiJudged") and isinstance(ai_gaps, list):
        return [
            {
                "key": str(gap.get("key") or "other"),
                "label": str(gap.get("label") or "待确认项"),
                "severity": "high",
                "reason": str(gap.get("reason") or "该信息会影响方案判断。"),
            }
            for gap in ai_gaps
            if isinstance(gap, dict)
        ]
    return gaps_for(profile)


def completeness_of(profile: dict[str, Any]) -> int:
    requirement_type = profile.get("type")
    total = 0
    filled = 0
    context = profile.get("businessContext") or {}
    context_questions = [BUSINESS_CHAIN_QUESTION]
    business_chain = context.get("businessChain")
    if business_chain:
        context_questions.extend(questions_for_business_chain(business_chain))
    for question in context_questions:
        weight = 2
        total += weight
        has_value = _field_is_filled(context.get(question["key"]))
        if has_value:
            filled += weight

    if requirement_type not in {"decision", "sop"}:
        return round(filled / total * 100) if total else 0

    target = profile.get(requirement_type, {})
    for question in questions_for(requirement_type):
        if question.get("ai_only"):
            continue
        weight = 2 if question["required"] else 1
        total += weight
        key = question["key"]
        if question.get("repeat"):
            has_value = key in profile.get("closedLists", []) and bool(target.get(key))
        else:
            has_value = _field_is_filled(target.get(key))
        if has_value:
            filled += weight
    return round(filled / total * 100) if total else 0


def build_summary(profile: dict[str, Any]) -> str:
    profile = normalize_profile(profile)
    context = profile["businessContext"]
    context_lines = [
        f"业务链路：{business_chain_label(context.get('businessChain') or 'other')}",
        f"业务对象 / 范围：{display(context.get('businessObject'))} / {display(context.get('scope'))}",
        f"当前处理方式：{display(context.get('currentProcess'))}",
        f"数据口径：{display(context.get('dataDefinition'))}",
        f"实际系统：{display(context.get('systemLandscape'))}",
        f"自动化与审批边界：{display(context.get('approvalBoundary'))}",
        f"成功标准：{display(context.get('successMetric'))}",
    ]
    if profile["type"] == "decision":
        target = profile["decision"]
        lines = [
            "我已整理出这份需求画像，请确认是否准确：",
            "",
            "类型：单点决策",
            f"名称：{display(target['name'])}",
            f"部门 / 决策人：{display(target['department'])} / {display(target['decisionMaker'])}",
            f"频率 / 价值：{format_frequency(target['frequency'])} / {format_value(target['value'])}",
            f"目的：{display(target['purpose'])}",
            f"输入数据：{len(target['inputs'])} 条",
            f"判断标准：{len(target['standards'])} 条",
            f"对应行动：{len(target['actions'])} 条",
        ]
    elif profile["type"] == "sop":
        target = profile["sop"]
        lines = [
            "我已整理出这份需求画像，请确认是否准确：",
            "",
            "类型：SOP 流程",
            f"名称：{display(target['name'])}",
            f"部门 / 负责人：{display(target['department'])} / {display(target['owner'])}",
            f"频率 / 价值：{format_frequency(target['frequency'])} / {format_value(target['value'])}",
            f"目的：{display(target['purpose'])}",
            f"流程步骤：{len(target['steps'])} 步",
        ]
    else:
        lines = [
            "我还不能确认这项需求的形态：",
            "",
            "请先判断它是一次性的业务判断，还是按步骤执行的一条流程。",
        ]
    lines.extend(("", "七邦业务上下文：", *context_lines))
    gaps = visible_gaps_for(profile)
    if gaps:
        lines.extend(("", f"仍有 {len(gaps)} 个待确认项，会在评审时明确标注。"))
    lines.extend(("", "确认后会进入等待评审；也可以继续补充说明。"))
    return "\n".join(lines)


def detect_type(text: str) -> Optional[str]:
    value = normalize_text(text)
    if re.fullmatch(r"1(?:\..*)?", value) or "做判断" in value or "单点决策" in value:
        return "decision"
    if re.fullmatch(r"2(?:\..*)?", value) or "跑流程" in value or "SOP" in value.upper():
        return "sop"
    decision_score = sum(
        word in value for word in ("判断", "决策", "该不该", "要不要", "是否", "审批", "拍板")
    )
    sop_score = sum(
        word in value for word in ("流程", "步骤", "每天", "每周", "导出", "汇总", "推送", "自动化")
    )
    if decision_score > sop_score and decision_score:
        return "decision"
    if sop_score > decision_score and sop_score:
        return "sop"
    return None


def questions_for(requirement_type: str) -> tuple[dict[str, Any], ...]:
    return DECISION_QUESTIONS if requirement_type == "decision" else SOP_QUESTIONS


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def is_skip(value: str) -> bool:
    return normalize_text(value).lower() in {
        "跳过",
        "不知道",
        "不清楚",
        "先不填",
        "略过",
        "无",
    }


def is_stop(value: str) -> bool:
    return normalize_text(value).lower() in {
        "没有了",
        "没了",
        "就这些",
        "结束",
        "没有",
    }


def is_confirm(value: str) -> bool:
    return normalize_text(value).lower() in {
        "确认需求画像",
        "确认",
        "没问题",
        "可以",
        "好的",
        "确认无误",
    }


def wants_more_clarification(value: str) -> bool:
    normalized = normalize_text(value).lower()
    return any(
        signal in normalized
        for signal in (
            "继续指出",
            "继续问",
            "继续澄清",
            "还需要明确",
            "影响方案",
            "有问题继续",
        )
    )


def display(value: Any) -> str:
    return str(value) if _field_is_filled(value) else "待确认"


def format_frequency(value: Any) -> str:
    if not isinstance(value, dict):
        return "待确认"
    return f"{value.get('n', '1')} 次/{value.get('unit', '待确认')}"


def format_value(value: Any) -> str:
    if not isinstance(value, dict):
        return "待确认"
    level = str(value.get("level") or "").strip()
    return "待 AI 判断" if level in {"待模型判断", "待确认"} else level


def _field_is_filled(value: Any) -> bool:
    return value not in (None, "", [], {})


def _key_has_answer(profile: dict[str, Any], key: str) -> bool:
    if key == "type":
        return profile.get("type") in {"decision", "sop"}
    if key == "businessChain":
        context = profile.get("businessContext") or {}
        return _field_is_filled(context.get(key)) or key in profile.get("skipped", [])
    context = profile.get("businessContext") or {}
    if key in context and key not in {"company", "candidateBusinessChain", "candidateSignals"}:
        return _field_is_filled(context.get(key)) or key in profile.get("skipped", [])
    requirement_type = profile.get("type")
    target = profile.get(requirement_type or "")
    if not isinstance(target, dict):
        return False
    question = question_by_key(profile, key)
    if question and question.get("repeat"):
        return False
    return _field_is_filled(target.get(key)) or key in profile.get("skipped", [])


def _activate_guardrail_question(profile: dict[str, Any], key: str) -> None:
    question = question_by_key(profile, key)
    if question is None:
        profile["activeQuestion"] = None
        return
    content = question["prompt"]
    hint = question.get("hint")
    if hint:
        content = f"{content}\n\n{hint}"
    profile["activeQuestion"] = {
        "key": key,
        "content": content,
        "chips": list(question.get("chips") or []),
    }


def _close_list(profile: dict[str, Any], key: str) -> None:
    profile["closedLists"] = list(dict.fromkeys([*profile["closedLists"], key]))


def _apply_value(target: dict[str, Any], requirement_type: str, key: str, text: str) -> bool:
    if key in {"name", "department", "decisionMaker", "owner", "purpose", "rules"}:
        target[key] = text
        return True
    if key in {"timeCostMin", "durationMin"}:
        minutes = extract_minutes(text)
        if minutes is None:
            return False
        target[key] = minutes
        return True
    if key == "people":
        people = extract_people(text)
        if people is None:
            return False
        target[key] = people
        return True
    if key == "frequency":
        frequency = extract_frequency(text)
        if frequency is None:
            return False
        target[key] = frequency
        return True
    if key == "value":
        value = extract_value(text)
        if value is None:
            return False
        target[key] = value
        return True
    if key == "dimensions":
        dimensions = [item for item in DIMENSIONS if item in text]
        if not dimensions:
            return False
        target[key] = list(dict.fromkeys([*target[key], *dimensions]))
        return True
    if key == "inputs":
        target[key].append(
            {
                "name": text,
                "source": extract_source(text),
                "method": extract_method(text),
                "note": "",
            }
        )
        return True
    if key == "standards":
        condition, result = split_condition(text)
        target[key].append(
            {
                "condition": condition,
                "result": result,
                "clarity": "明确阈值" if re.search(r"\d", text) else "待确认",
            }
        )
        return True
    if key == "actions":
        target[key].append(
            {
                "result": "待确认",
                "who": extract_role(text),
                "what": text,
                "where": extract_location(text),
                "note": "",
            }
        )
        return True
    if key == "steps":
        for action in split_steps(text):
            target[key].append(
                {
                    "seq": len(target[key]) + 1,
                    "action": action,
                    "input": "",
                    "output": "",
                    "trigger": "",
                    "type": extract_step_type(action),
                    "minutes": extract_minutes(action),
                    "source": extract_source(action),
                    "method": extract_method(action),
                    "note": "",
                    "reason": "",
                }
            )
        return True
    return False


def extract_frequency(text: str) -> Optional[dict[str, str]]:
    matched = re.search(r"(\d+)\s*次?\s*[／/]\s*(天|周|月|年)", text)
    if matched:
        return {"n": matched.group(1), "unit": matched.group(2)}
    matched = re.search(r"(?:每|一)(天|周|月|年)(?:\s*(\d+)\s*次?)?", text)
    if matched:
        return {"n": matched.group(2) or "1", "unit": matched.group(1)}
    return None


def extract_value(text: str) -> Optional[dict[str, str]]:
    normalized = normalize_text(text)
    if not normalized:
        return None

    level: Optional[str] = None
    if re.fullmatch(r"[高、中、低]", normalized):
        level = normalized
    else:
        explicit_level = re.search(
            r"(?:业务价值|业务影响|优先级|重要性)\s*(?:是|为|属于|偏向)?\s*(高|中|低)",
            normalized,
        )
        if explicit_level:
            level = explicit_level.group(1)

    return {
        "level": level or "待模型判断",
        "reason": normalized,
        "source": "requester_self_assessment" if level else "requester_evidence",
    }


def extract_minutes(text: str) -> Optional[int]:
    normalized = (
        text.strip()
        .replace("个小时", "小时")
        .replace("鐘", "钟")
        .replace("小時", "小时")
        .replace("分鐘", "分钟")
    )
    matched = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:-|－|—|~|～|至|到)\s*(\d+(?:\.\d+)?)\s*小时",
        normalized,
    )
    if matched:
        low = float(matched.group(1))
        high = float(matched.group(2))
        return round(((low + high) / 2) * 60)
    matched = re.search(r"(\d+(?:\.\d+)?)\s*小时", normalized)
    if matched:
        return round(float(matched.group(1)) * 60)
    matched = re.search(r"(\d+(?:\.\d+)?)\s*分钟?", normalized)
    if matched:
        return round(float(matched.group(1)))
    matched = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hours?)\b", normalized, flags=re.IGNORECASE)
    if matched:
        return round(float(matched.group(1)) * 60)
    if re.search(r"半天", normalized):
        return 240
    if re.search(r"半小时", normalized):
        return 30
    return None


def extract_people(text: str) -> Optional[int]:
    matched = re.search(r"(\d+)\s*(?:个)?人", text)
    if matched:
        return int(matched.group(1))
    bare = re.fullmatch(r"\s*(\d{1,3})\s*", text)
    return int(bare.group(1)) if bare else None


def split_steps(text: str) -> list[str]:
    numbered = [
        match.group(1).strip(" 。；;")
        for match in re.finditer(
            r"(?:^|\n|(?<=[。；;]))\s*(?:第?[一二三四五六七八九十]+步|\d+[.、)])\s*[：:]?\s*([^\n。；;]+)",
            text,
        )
        if match.group(1).strip(" 。；;")
    ]
    if len(numbered) >= 2:
        return numbered
    sentences = [item.strip() for item in re.split(r"[。；;\n]+", text) if item.strip()]
    if len(sentences) >= 2 and all(len(item) >= 4 for item in sentences):
        return sentences[:20]
    return [text]


def extract_source(text: str) -> str:
    for source in SOURCES:
        if source in text:
            return "Excel或本地文件" if source in {"Excel", "本地文件"} else source
    return ""


def extract_method(text: str) -> str:
    for method in METHODS:
        if method in text:
            return method
    if "API" in text or "接口" in text:
        return "API实时取"
    if "导出" in text:
        return "定时导出"
    if "抓取" in text or "爬" in text:
        return "RPA抓取"
    if "人工" in text or "手动" in text:
        return "人工提供"
    return ""


def extract_step_type(text: str) -> str:
    if re.search(r"判断|审批|拍板|评估", text):
        return "分析决策"
    if re.search(r"导出|下载|抓取|同步|推送|提交|创建", text):
        return "RPA/API自动化"
    if re.search(r"汇总|整理|计算|清洗|转换|提取", text):
        return "数据信息处理"
    return "人工介入"


def split_condition(text: str) -> tuple[str, str]:
    parts = re.split(r"(?:→|->|则|就)", text, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return text, "待确认"


def extract_role(text: str) -> str:
    matched = re.search(
        r"(运营|客服|仓储|财务|采购|商品|主管|总监|经理|专员|负责人|管理员|销售|供应链)",
        text,
    )
    return matched.group(1) if matched else ""


def extract_location(text: str) -> str:
    matched = re.search(r"([^\s，。]{2,16}(?:系统|后台|平台|ERP|WMS|飞书|钉钉|企微))", text)
    return matched.group(1) if matched else ""
