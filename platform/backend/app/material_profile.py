from __future__ import annotations

import re
from copy import deepcopy
from hashlib import sha256
from typing import Any

from .clarification import completeness_of, detect_type, new_profile, normalize_profile


FIELD_PATTERNS = {
    "businessObject": ("业务对象", "处理对象", "适用对象", "SOP名称", "决策名称", "对象"),
    "scope": ("适用范围", "首期范围", "范围"),
    "currentProcess": (
        "当前流程",
        "现状流程",
        "当前处理方式",
        "SOP完整文字描述",
        "决策链路完整描述",
        "操作步骤",
    ),
    "dataDefinition": ("数据口径", "字段口径", "统计口径"),
    "systemLandscape": ("涉及系统", "系统现状", "数据来源", "接口系统"),
    "approvalBoundary": ("审批边界", "人工边界", "异常处理", "人工复核"),
    "successMetric": ("成功指标", "验收标准", "目标指标"),
}


def merge_material_into_profile(
    profile: dict[str, Any],
    *,
    filename: str,
    text: str,
    parser_type: str,
) -> dict[str, Any]:
    result = normalize_profile(deepcopy(profile))
    evidence = list(result.get("sourceEvidence") or [])
    chunks = _material_chunks(_chunks(text, parser_type), parser_type)

    if result.get("type") not in {"decision", "sop"}:
        detected = detect_type(text[:6000])
        if detected in {"decision", "sop"}:
            result["type"] = detected

    context = result["businessContext"]
    for chunk in chunks:
        for field, labels in FIELD_PATTERNS.items():
            value = _labeled_value(chunk["text"], labels)
            if value and not context.get(field):
                context[field] = value
                evidence.append(_evidence(filename, field, value, chunk["locator"]))

    _infer_unstructured_context(context, chunks, filename, evidence)

    target = result.get(result.get("type") or "")
    if isinstance(target, dict):
        purpose = _first_labeled(chunks, ("需求目标", "业务目标", "流程目的", "决策目的", "目的"))
        if purpose and not target.get("purpose"):
            target["purpose"] = purpose[0]
            evidence.append(_evidence(filename, "purpose", purpose[0], purpose[1]))

        if result["type"] == "sop" and not target.get("steps"):
            steps = _tabular_sop_steps(chunks, filename, evidence)
            if not steps:
                for chunk in chunks:
                    for match in re.finditer(r"(?:^|\n)\s*(?:步骤\s*)?(\d+)[.、)]\s*([^\n]{3,180})", chunk["text"]):
                        steps.append({"order": len(steps) + 1, "description": match.group(2).strip()})
                        evidence.append(_evidence(filename, "steps", match.group(2).strip(), chunk["locator"]))
            if steps:
                target["steps"] = steps[:20]

    result["sourceEvidence"] = _dedupe(evidence)
    result["completeness"] = completeness_of(result)
    return result


def add_material_candidates(
    profile: dict[str, Any],
    *,
    source_id: str,
    filename: str,
    text: str,
    parser_type: str,
) -> dict[str, Any]:
    """Extract material claims without treating them as user-confirmed facts."""
    result = normalize_profile(deepcopy(profile))
    empty = new_profile_like(result)
    extracted = merge_material_into_profile(
        empty,
        filename=filename,
        text=text,
        parser_type=parser_type,
    )
    candidates = list(result.get("materialCandidates") or [])
    existing_ids = {str(item.get("id")) for item in candidates if isinstance(item, dict)}

    evidence_by_field: dict[str, list[dict[str, str]]] = {}
    for evidence in extracted.get("sourceEvidence") or []:
        if isinstance(evidence, dict):
            evidence_by_field.setdefault(str(evidence.get("field") or ""), []).append(evidence)

    for field, value in _candidate_values(extracted).items():
        if not _has_value(value):
            continue
        evidence = evidence_by_field.get(field) or []
        locator = str(evidence[0].get("locator") or "正文") if evidence else "正文"
        excerpt = str(evidence[0].get("excerpt") or _display_value(value))[:300] if evidence else _display_value(value)[:300]
        candidate_id = sha256(
            f"{source_id}\0{field}\0{_display_value(value)}\0{locator}".encode("utf-8")
        ).hexdigest()[:24]
        if candidate_id in existing_ids:
            continue
        candidates.append(
            {
                "id": candidate_id,
                "field": field,
                "value": value,
                "sourceId": source_id,
                "source": filename,
                "locator": locator,
                "excerpt": excerpt,
                "status": "pending",
            }
        )
        existing_ids.add(candidate_id)

    result["materialCandidates"] = _mark_conflicts(candidates)
    return result


def resolve_material_candidate(
    profile: dict[str, Any],
    *,
    candidate_id: str,
    action: str,
    edited_value: Any = None,
) -> dict[str, Any]:
    result = normalize_profile(deepcopy(profile))
    candidates = list(result.get("materialCandidates") or [])
    selected = next(
        (item for item in candidates if isinstance(item, dict) and item.get("id") == candidate_id),
        None,
    )
    if selected is None:
        raise ValueError("材料候选项不存在")
    if selected.get("status") not in {"pending", "conflict"}:
        raise ValueError("该材料候选项已经处理")
    if action == "reject":
        selected["status"] = "rejected"
        result["materialCandidates"] = _mark_conflicts(candidates)
        return result
    if action not in {"accept", "edit"}:
        raise ValueError("不支持的材料确认操作")

    field = str(selected.get("field") or "")
    value = edited_value if action == "edit" else selected.get("value")
    value = _normalize_candidate_value(field, value)
    if not _has_value(value):
        raise ValueError("接受的字段值不能为空")
    _set_profile_field(result, field, value)
    selected["status"] = "accepted"
    selected["acceptedValue"] = value
    for item in candidates:
        if item is selected or not isinstance(item, dict):
            continue
        if item.get("field") == selected.get("field") and item.get("status") in {"pending", "conflict"}:
            item["status"] = "superseded"
    evidence = list(result.get("sourceEvidence") or [])
    evidence.append(
        {
            "field": selected["field"],
            "source": selected["source"],
            "locator": selected["locator"],
            "excerpt": _display_value(value)[:300],
            "status": "accepted",
            "candidateId": candidate_id,
        }
    )
    result["sourceEvidence"] = _dedupe(evidence)
    result["materialCandidates"] = _mark_conflicts(candidates)
    result["completeness"] = completeness_of(result)
    return result


def new_profile_like(profile: dict[str, Any]) -> dict[str, Any]:
    target = profile.get(profile.get("type") or "") or {}
    return new_profile(
        title=str(target.get("name") or ""),
        department=str(target.get("department") or ""),
        summary="",
        requirement_type=profile.get("type"),
    )


def _candidate_values(profile: dict[str, Any]) -> dict[str, Any]:
    context = profile.get("businessContext") or {}
    target = profile.get(profile.get("type") or "") or {}
    values = {key: context.get(key) for key in FIELD_PATTERNS}
    values["purpose"] = target.get("purpose")
    values["steps"] = target.get("steps")
    return values


def _set_profile_field(profile: dict[str, Any], field: str, value: Any) -> None:
    if field in FIELD_PATTERNS:
        profile["businessContext"][field] = value
        return
    target = profile.get(profile.get("type") or "")
    if isinstance(target, dict) and field in {"purpose", "steps"}:
        target[field] = value
        return
    raise ValueError("材料候选字段不受支持")


def _normalize_candidate_value(field: str, value: Any) -> Any:
    if field == "steps" and isinstance(value, str):
        parts = [item.strip() for item in re.split(r"[\n；;]+", value) if item.strip()]
        return [
            {"order": index, "description": re.sub(r"^\d+[.、)]\s*", "", item)}
            for index, item in enumerate(parts, start=1)
        ]
    if field != "steps" and not isinstance(value, str):
        return _display_value(value)
    return value


def _mark_conflicts(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    active_by_field: dict[str, set[str]] = {}
    for item in candidates:
        if isinstance(item, dict) and item.get("status") in {"pending", "conflict"}:
            active_by_field.setdefault(str(item.get("field") or ""), set()).add(
                _display_value(item.get("value"))
            )
    for item in candidates:
        if not isinstance(item, dict) or item.get("status") not in {"pending", "conflict"}:
            continue
        item["status"] = "conflict" if len(active_by_field.get(str(item.get("field") or ""), set())) > 1 else "pending"
    return candidates


def _display_value(value: Any) -> str:
    if isinstance(value, list):
        return "；".join(
            str(item.get("description") or item) if isinstance(item, dict) else str(item)
            for item in value
        )
    return str(value or "")


def _has_value(value: Any) -> bool:
    return bool(value) if not isinstance(value, str) else bool(value.strip())


def _chunks(text: str, parser_type: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    chunks: list[dict[str, str]] = []
    locator = "正文"
    buffer: list[str] = []
    start_line = 1

    def flush(end_line: int) -> None:
        nonlocal buffer, start_line
        value = "\n".join(buffer).strip()
        if value:
            resolved = locator if locator != "正文" else f"第 {start_line}-{end_line} 行"
            chunks.append({"locator": resolved, "text": value})
        buffer = []

    marker = re.compile(r"^\[(第\s*\d+\s*页|工作表：[^\]]+|表格\s*\d+|段落\s*\d+)\]$")
    for index, line in enumerate(lines, start=1):
        match = marker.match(line.strip())
        if match:
            flush(index - 1)
            locator = match.group(1)
            start_line = index + 1
        else:
            if not buffer:
                start_line = index
            buffer.append(line)
    flush(len(lines))
    return chunks or [{"locator": "正文", "text": text}]


def _labeled_value(text: str, labels: tuple[str, ...]) -> str:
    labels_pattern = "|".join(re.escape(item) for item in labels)
    match = re.search(rf"(?:^|\n)\s*(?:{labels_pattern})\s*[：:]\s*([^\n]{{2,500}})", text)
    if match:
        return match.group(1).strip()
    for line in text.splitlines():
        cells = [cell.strip() for cell in line.split("|")]
        for index, cell in enumerate(cells):
            if cell not in labels:
                continue
            value = next((candidate for candidate in cells[index + 1 :] if candidate), "")
            if value:
                return value[:500]
    return ""


def _material_chunks(chunks: list[dict[str, str]], parser_type: str) -> list[dict[str, str]]:
    if parser_type not in {"xlsx", "xls"}:
        return chunks
    primary_names = {"工作表：SOP流程拆解", "工作表：单点决策拆解表"}
    primary = [chunk for chunk in chunks if chunk.get("locator") in primary_names]
    return primary or chunks


def _tabular_sop_steps(
    chunks: list[dict[str, str]],
    filename: str,
    evidence: list[dict[str, str]],
) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for chunk in chunks:
        in_steps = False
        for line in chunk["text"].splitlines():
            cells = [cell.strip() for cell in line.split("|")]
            if "序号" in cells and ("具体动作" in cells or "动作" in cells):
                in_steps = True
                continue
            if not in_steps or not cells or not re.fullmatch(r"\d+", cells[0]):
                continue
            description = next((cell for cell in cells[1:] if cell), "")
            if len(description) < 2:
                continue
            steps.append({"order": len(steps) + 1, "description": description})
            evidence.append(_evidence(filename, "steps", description, chunk["locator"]))
    return steps[:50]


def _first_labeled(chunks: list[dict[str, str]], labels: tuple[str, ...]) -> tuple[str, str] | None:
    for chunk in chunks:
        value = _labeled_value(chunk["text"], labels)
        if value:
            return value, chunk["locator"]
    return None


def _infer_unstructured_context(
    context: dict[str, Any],
    chunks: list[dict[str, str]],
    filename: str,
    evidence: list[dict[str, str]],
) -> None:
    full_text = "\n".join(chunk["text"] for chunk in chunks)
    first_locator = chunks[0]["locator"] if chunks else "正文"
    systems = [
        name
        for name in ("金蝶云", "K3Cloud", "K/3Cloud", "百胜E3", "E3", "WMS", "ERP", "电商后台", "商品后台")
        if name.lower() in full_text.lower()
    ]
    if systems and not context.get("systemLandscape"):
        value = "、".join(dict.fromkeys(systems))
        context["systemLandscape"] = value
        evidence.append(_evidence(filename, "systemLandscape", value, first_locator))

    inventory_signals = ("库存", "SKU", "条码", "仓库", "上下架")
    if any(signal.lower() in full_text.lower() for signal in inventory_signals):
        if not context.get("businessObject"):
            value = "商品 SKU 库存及上下架状态"
            context["businessObject"] = value
            evidence.append(_evidence(filename, "businessObject", value, first_locator))
        if not context.get("currentProcess"):
            steps = [
                match.group(1).strip()
                for match in re.finditer(
                    r"(?:^|\n)\s*\d+[.、，)]\s*([^\n]{3,180})", full_text
                )
            ][:8]
            if steps:
                value = "；".join(steps)
                context["currentProcess"] = value
                evidence.append(_evidence(filename, "currentProcess", value, first_locator))


def _evidence(filename: str, field: str, excerpt: str, locator: str) -> dict[str, str]:
    return {"field": field, "source": filename, "locator": locator, "excerpt": excerpt[:300]}


def _dedupe(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen = set()
    result = []
    for item in items:
        key = (item["field"], item["source"], item["locator"], item["excerpt"])
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result
