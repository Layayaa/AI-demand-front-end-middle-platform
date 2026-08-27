from typing import Any


# The requester's own label is only a weak signal. The model assessment is
# authoritative when available; fallback scoring must not turn "高" alone
# into a high-priority requirement.
VALUE_SCORES = {"高": 12, "中": 8, "低": 4, "待模型判断": 4}
FREQUENCY_SCORES = {"天": 15, "周": 12, "月": 8, "年": 4}
DIMENSION_SCORES = {
    "收入": 3,
    "成本": 3,
    "客户满意度": 2,
    "库存风险": 2,
    "合规风险": 3,
    "其他": 1,
}


def assess(profile: dict[str, Any], gaps: list[dict[str, str]]) -> dict[str, Any]:
    requirement_type = profile.get("type")
    if requirement_type not in {"decision", "sop"}:
        return _empty_assessment()

    target = profile[requirement_type]
    value = target.get("value") or {}
    value_score = _value_signal_score(value)
    frequency = target.get("frequency") or {}
    frequency_score = FREQUENCY_SCORES.get(frequency.get("unit"), 5)
    minutes = target.get("timeCostMin") if requirement_type == "decision" else target.get("durationMin")
    time_score = min(15, round(minutes / 8)) if isinstance(minutes, int) else 4
    dimensions = target.get("dimensions") or []
    dimension_score = min(12, round(sum(DIMENSION_SCORES.get(item, 1) for item in dimensions))) if dimensions else 2
    auto_rate, integrations, effort_days, manual_ratio = _delivery_shape(profile)
    auto_score = round(auto_rate * 0.15)
    people = target.get("people")
    people_score = min(8, round(people * 1.6)) if isinstance(people, int) else 2
    score = min(100, round(value_score + frequency_score + time_score + dimension_score + auto_score + people_score))
    priority = "P0" if score >= 80 else "P1" if score >= 60 else "P2"
    effort_min_pm = max(0.5, round(effort_days / 22 * 0.8, 1))
    effort_max_pm = max(0.5, round(effort_days / 22 * 1.3, 1))
    project_size = "小型" if effort_max_pm <= 1 else "中型" if effort_max_pm <= 3 else "大型"

    risk_score = 0
    judged_completeness = profile.get("aiJudged") and not gaps
    if profile.get("completeness", 0) < 75 and not judged_completeness:
        risk_score += 2
    if integrations >= 3:
        risk_score += 1
    if integrations >= 5:
        risk_score += 1
    if manual_ratio >= 0.5:
        risk_score += 1
    if any(item["severity"] == "high" for item in gaps):
        risk_score += 1
    risk_level = "高" if risk_score >= 4 else "中" if risk_score >= 2 else "低"
    confidence = (
        "高"
        if profile.get("completeness", 0) >= 85 or judged_completeness
        else "中"
        if profile.get("completeness", 0) >= 60
        else "低"
    )

    return {
        "value_score": score,
        "priority": priority,
        "project_size": project_size,
        "risk_level": risk_level,
        "effort_min_pm": effort_min_pm,
        "effort_max_pm": effort_max_pm,
        "confidence": confidence,
        "assessment_source": "rules_fallback",
        "assessment_model": None,
        "business_criticality": "待确认",
        "assessment_rationale": ["当前未使用模型评估，暂由基础规则生成。"],
        "assessment_evidence_gaps": [item["label"] for item in gaps],
        "summary": (
            f"{priority}，价值评分 {score} 分，预计 {effort_min_pm}~{effort_max_pm} 人月，"
            f"当前风险 {risk_level}。"
        ),
        "dimensions": [
            _dimension(
                "业务影响证据",
                round(value_score / 30 * 100),
                value.get("reason") or "尚未提供具体影响证据",
            ),
            _dimension(
                "信息完整度",
                100 if judged_completeness else profile.get("completeness", 0),
                "AI 判断已足以形成方案" if judged_completeness else f"待确认项 {len(gaps)} 个",
            ),
            _dimension("自动化潜力", auto_rate, f"涉及约 {integrations} 个外部系统"),
            _dimension("实施复杂度", min(100, effort_days * 4), f"粗估 {effort_days} 人天"),
            _dimension("人工依赖", round(manual_ratio * 100), "需在方案中保留人工兜底"),
        ],
        "gaps": [item["label"] for item in gaps],
    }


def merge_model_assessment(
    fallback: dict[str, Any],
    model_assessment: dict[str, Any],
) -> dict[str, Any]:
    result = dict(fallback)
    score = model_assessment.get("value_score")
    if isinstance(score, (int, float)):
        result["value_score"] = max(0, min(100, round(score)))

    priority = model_assessment.get("priority")
    if priority in {"P0", "P1", "P2"}:
        result["priority"] = priority
    risk_level = model_assessment.get("risk_level")
    if risk_level in {"高", "中", "低"}:
        result["risk_level"] = risk_level
    confidence = model_assessment.get("confidence")
    if confidence in {"高", "中", "低"}:
        result["confidence"] = confidence
    if result["priority"] == "P0" and result["confidence"] == "低":
        result["priority"] = "P1"

    dimensions = model_assessment.get("dimensions")
    if isinstance(dimensions, list) and dimensions:
        result["dimensions"] = [
            {
                "name": str(item.get("name") or "业务影响"),
                "score": max(0, min(100, round(item.get("score", 0)))),
                "level": (
                    "高"
                    if round(item.get("score", 0)) >= 70
                    else "中"
                    if round(item.get("score", 0)) >= 40
                    else "低"
                ),
                "evidence": str(item.get("evidence") or "模型未提供具体依据。"),
            }
            for item in dimensions
            if isinstance(item, dict)
        ][:8]

    result["assessment_source"] = "llm"
    result["assessment_model"] = model_assessment.get("model")
    result["business_criticality"] = str(
        model_assessment.get("business_criticality") or "待确认"
    )
    result["assessment_rationale"] = [
        str(item).strip()
        for item in model_assessment.get("rationale", [])
        if isinstance(item, str) and item.strip()
    ][:5]
    result["assessment_evidence_gaps"] = [
        str(item).strip()
        for item in model_assessment.get("evidence_gaps", [])
        if isinstance(item, str) and item.strip()
    ][:5]
    model_summary = model_assessment.get("summary") or (
        f"{result['priority']}，模型价值评分 {result['value_score']} 分。"
    )
    result["summary"] = (
        f"{model_summary} 预计 {result['effort_min_pm']}~{result['effort_max_pm']} 人月，"
        f"当前风险 {result['risk_level']}。"
    )
    return result


def _delivery_shape(profile: dict[str, Any]) -> tuple[int, int, int, float]:
    if profile["type"] == "decision":
        inputs = profile["decision"].get("inputs") or []
        automatable = sum(
            item.get("method") in {"API实时取", "定时导出", "RPA抓取"} for item in inputs
        )
        auto_rate = round(automatable / len(inputs) * 100) if inputs else 40
        systems = {item.get("source") for item in inputs if item.get("source")}
        effort = max(
            2,
            round(
                2
                + len(inputs) * 0.5
                + len(profile["decision"].get("standards") or []) * 0.5
                + len(profile["decision"].get("actions") or []) * 0.3
                + len(systems) * 0.5
            ),
        )
        return auto_rate, len(systems), effort, 0.25

    steps = profile["sop"].get("steps") or []
    automated = sum(
        item.get("type") in {"RPA/API自动化", "数据信息处理"} for item in steps
    )
    auto_rate = round(automated / len(steps) * 100) if steps else 40
    systems = {item.get("source") for item in steps if item.get("source")}
    manual_ratio = (len(steps) - automated) / len(steps) if steps else 0.5
    effort = max(2, round(2 + len(steps) * 0.8 + automated * 0.6 + len(systems) * 0.4))
    return auto_rate, len(systems), effort, manual_ratio


def _dimension(name: str, score: int, evidence: str) -> dict[str, Any]:
    return {
        "name": name,
        "score": score,
        "level": "高" if score >= 70 else "中" if score >= 40 else "低",
        "evidence": evidence,
    }


def _value_signal_score(value: dict[str, Any]) -> int:
    level = str(value.get("level") or "待模型判断")
    score = VALUE_SCORES.get(level, VALUE_SCORES["待模型判断"])
    evidence = str(value.get("reason") or "")
    if not evidence:
        return score

    critical_signals = (
        "断货",
        "积压",
        "资金占用",
        "销售损失",
        "毛利下降",
        "订单履约",
        "供应链",
    )
    business_signals = (
        "库存",
        "补货",
        "采购",
        "销量",
        "客户",
        "平台处罚",
        "合规",
        "收入",
        "成本",
    )
    efficiency_signals = ("节省人工", "减少人工", "提高效率", "缩短时间", "减少错误")

    if any(signal in evidence for signal in critical_signals):
        score += 18
    elif any(signal in evidence for signal in business_signals):
        score += 8
    elif any(signal in evidence for signal in efficiency_signals):
        score += 3
    return min(30, score)


def _empty_assessment() -> dict[str, Any]:
    return {
        "value_score": 0,
        "priority": "P2",
        "project_size": "待确认",
        "risk_level": "高",
        "effort_min_pm": 0.5,
        "effort_max_pm": 0.5,
        "confidence": "低",
        "assessment_source": "rules_fallback",
        "assessment_model": None,
        "business_criticality": "待确认",
        "assessment_rationale": ["需求类型尚未确认，无法进行模型价值判断。"],
        "assessment_evidence_gaps": ["需求形态"],
        "summary": "需求类型尚未确认，暂不能形成可靠评估。",
        "dimensions": [],
        "gaps": ["需求形态"],
    }
