from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .clarification import completeness_of, detect_type, normalize_profile


FIELD_PATTERNS = {
    "businessObject": ("业务对象", "处理对象", "适用对象", "对象"),
    "scope": ("适用范围", "首期范围", "范围"),
    "currentProcess": ("当前流程", "现状流程", "当前处理方式", "操作步骤"),
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
    chunks = _chunks(text, parser_type)

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
            steps = []
            for chunk in chunks:
                for match in re.finditer(r"(?:^|\n)\s*(?:步骤\s*)?(\d+)[.、)]\s*([^\n]{3,180})", chunk["text"]):
                    steps.append({"order": len(steps) + 1, "description": match.group(2).strip()})
                    evidence.append(_evidence(filename, "steps", match.group(2).strip(), chunk["locator"]))
            if steps:
                target["steps"] = steps[:20]

    result["sourceEvidence"] = _dedupe(evidence)
    result["completeness"] = completeness_of(result)
    return result


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
    return match.group(1).strip() if match else ""


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
