import re
from pathlib import Path
from typing import Any, Optional

import httpx

from .config import Settings
from .document_parser import DocumentParseError, parse_document
from .qibang_context import business_chain_label


SUPPORTED_EXTENSIONS = {
    ".md",
    ".markdown",
    ".txt",
    ".log",
    ".json",
    ".csv",
    ".yaml",
    ".yml",
    ".xlsx",
    ".xls",
}
UPLOADED_KNOWLEDGE_EXTENSIONS = {
    ".docx",
    ".pdf",
    ".txt",
    ".md",
    ".xlsx",
    ".xls",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
}
STOP_WORDS = {
    "需求",
    "希望",
    "系统",
    "平台",
    "自动",
    "人工",
    "相关",
    "当前",
    "以及",
    "需要",
    "这个",
    "一条",
    "业务",
    "广州七邦科技有限公司",
}


def collect_plan_references(
    *,
    settings: Settings,
    project: dict[str, Any],
    profile: dict[str, Any],
    source_files: list[dict[str, Any]],
    knowledge_files: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    terms = _query_terms(project, profile)
    references = _project_material_references(source_files, terms)
    ragflow_references = []
    if settings.ragflow_enabled and settings.ragflow_api_key:
        ragflow_references = _ragflow_references(settings, _query_text(project, profile))
    references.extend(ragflow_references)
    # Local retrieval is always retained: it is both complementary context and the
    # deterministic fallback when RAGFlow is disabled, unreachable or returns no chunks.
    references.extend(_local_knowledge_references(settings, terms))
    references.extend(_uploaded_knowledge_references(knowledge_files or [], terms))
    return _dedupe_references(references)[:12]


def list_uploaded_knowledge_files(settings: Settings) -> list[dict[str, Any]]:
    root = settings.knowledge_upload_root
    if not root.exists():
        return []

    files = []
    for path in sorted(root.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_file() or path.suffix.lower() not in UPLOADED_KNOWLEDGE_EXTENSIONS:
            continue
        item = _read_uploaded_knowledge_file(path)
        if item is not None:
            files.append(item)
    return files


def _read_uploaded_knowledge_file(path: Path) -> Optional[dict[str, Any]]:
    original_filename = _original_filename(path)
    try:
        parsed = parse_document(path, original_filename)
        text = parsed["text"]
        parse_status = (
            "stored"
            if parsed.get("metadata", {}).get("textExtraction") == "pending_vision_ocr"
            else "parsed"
        )
        parser_metadata = parsed["metadata"]
        page_count = parsed["page_count"]
        parser_type = parsed["parser_type"]
    except DocumentParseError as exc:
        text = ""
        parse_status = "failed"
        parser_metadata = {"error": str(exc)}
        page_count = None
        parser_type = path.suffix.lower().lstrip(".")

    stat = path.stat()
    return {
        "id": path.name,
        "original_filename": original_filename,
        "storage_name": path.name,
        "file_size": stat.st_size,
        "file_sha256": None,
        "parser_type": parser_type,
        "parse_status": parse_status,
        "page_count": page_count,
        "extracted_text": text,
        "parser_metadata": parser_metadata,
        "created_at": _file_time(path),
        "updated_at": _file_time(path),
    }


def _original_filename(path: Path) -> str:
    name = path.name
    if "__" in name:
        return name.split("__", 1)[1]
    return name


def _file_time(path: Path) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()


def _project_material_references(
    source_files: list[dict[str, Any]],
    terms: list[str],
) -> list[dict[str, Any]]:
    references = []
    for source_file in source_files:
        text = str(source_file.get("extracted_text") or "").strip()
        if not text:
            continue
        score = _match_score(text, terms)
        excerpt = _excerpt(text, terms, 520)
        references.append(
            {
                "sourceType": "project_material",
                "provider": "uploaded_material",
                "sourceId": source_file.get("id"),
                "source": source_file.get("original_filename") or "项目材料",
                "excerpt": excerpt,
                "matchedTerms": _matched_terms(text, terms),
                "confidence": "fact",
                "_score": score + 1,
            }
        )
    references.sort(key=lambda item: item["_score"], reverse=True)
    return references[:6]


def _local_knowledge_references(
    settings: Settings,
    terms: list[str],
) -> list[dict[str, Any]]:
    references = []
    for root in _knowledge_roots(settings):
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                continue
            if not text:
                continue
            score = _match_score(text, terms)
            if score == 0:
                continue
            references.append(
                {
                    "sourceType": "knowledge_base",
                    "provider": "local",
                    "source": str(path.relative_to(root)),
                    "excerpt": _excerpt(text, terms, 520),
                    "matchedTerms": _matched_terms(text, terms),
                    "confidence": "reference",
                    "_score": score,
                }
            )
    references.sort(key=lambda item: item["_score"], reverse=True)
    return references[:6]


def _uploaded_knowledge_references(
    knowledge_files: list[dict[str, Any]],
    terms: list[str],
) -> list[dict[str, Any]]:
    references = []
    for knowledge_file in knowledge_files:
        text = str(knowledge_file.get("extracted_text") or "").strip()
        if not text:
            continue
        score = _match_score(text, terms)
        if score == 0:
            continue
        references.append(
            {
                "sourceType": "knowledge_base",
                "provider": "reviewer_upload",
                "sourceId": knowledge_file.get("id"),
                "source": knowledge_file.get("original_filename") or "评审人上传知识资料",
                "excerpt": _excerpt(text, terms, 520),
                "matchedTerms": _matched_terms(text, terms),
                "confidence": "reference",
                "_score": score + 1,
            }
        )
    references.sort(key=lambda item: item["_score"], reverse=True)
    return references[:6]


def _ragflow_references(settings: Settings, query: str) -> list[dict[str, Any]]:
    payload: dict[str, Any] = {
        "question": query,
        "top_k": settings.knowledge_page_size,
        "page": 1,
    }
    if settings.ragflow_dataset_id:
        payload["dataset_ids"] = [settings.ragflow_dataset_id]
    try:
        response = httpx.post(
            f"{settings.ragflow_base_url.rstrip('/')}/api/v1/retrieval",
            headers={
                "Authorization": f"Bearer {settings.ragflow_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=settings.ragflow_timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    chunks = body.get("data") if isinstance(body, dict) else None
    if isinstance(chunks, dict):
        chunks = chunks.get("chunks") or chunks.get("results") or chunks.get("records") or chunks.get("items")
    if not isinstance(chunks, list):
        chunks = body.get("chunks") if isinstance(body, dict) else None
    if not isinstance(chunks, list):
        return []

    references = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        excerpt = str(
            chunk.get("content")
            or chunk.get("text")
            or chunk.get("highlight")
            or ""
        ).strip()
        if not excerpt:
            continue
        references.append(
            {
                "sourceType": "knowledge_base",
                "provider": "ragflow",
                "source": str(
                    chunk.get("document_name")
                    or chunk.get("docnm_kwd")
                    or chunk.get("document")
                    or chunk.get("title")
                    or "RAGFlow 片段"
                ),
                "excerpt": excerpt[:520],
                "matchedTerms": [],
                "confidence": "reference",
                "_score": float(chunk.get("similarity") or chunk.get("similarity_score") or chunk.get("score") or 0),
            }
        )
    return references[:6]


def _knowledge_roots(settings: Settings) -> list[Path]:
    configured = Path(settings.knowledge_local_path)
    if configured.is_absolute():
        return [configured]
    candidates = [
        Path.cwd() / configured,
        Path(__file__).resolve().parents[1] / configured,
        Path(__file__).resolve().parents[2] / configured,
        Path(__file__).resolve().parents[3] / configured,
    ]
    roots = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in roots:
            roots.append(resolved)
    return roots


def _query_text(project: dict[str, Any], profile: dict[str, Any]) -> str:
    context = profile.get("businessContext") or {}
    target = profile.get(profile.get("type") or "") or {}
    values = [
        project.get("title"),
        project.get("summary"),
        business_chain_label(context.get("businessChain") or "other"),
        *[context.get(key) for key in (
            "businessObject",
            "scope",
            "currentProcess",
            "dataDefinition",
            "systemLandscape",
            "approvalBoundary",
            "successMetric",
        )],
        *[target.get(key) for key in ("name", "purpose", "rules")],
    ]
    return " ".join(str(value) for value in values if value)


def _query_terms(project: dict[str, Any], profile: dict[str, Any]) -> list[str]:
    text = _query_text(project, profile)
    terms = re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_.-]{1,}", text)
    result = []
    for term in terms:
        normalized = term.lower()
        if normalized in STOP_WORDS or normalized in {item.lower() for item in result}:
            continue
        result.append(term)
    return result[:60]


def _match_score(text: str, terms: list[str]) -> int:
    return sum(min(text.lower().count(term.lower()), 3) for term in terms)


def _matched_terms(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if term.lower() in text.lower()][:8]


def _excerpt(text: str, terms: list[str], limit: int) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    for term in terms:
        match = re.search(re.escape(term), normalized, flags=re.IGNORECASE)
        if match:
            start = max(0, match.start() - 180)
            return normalized[start:start + limit]
    return normalized[:limit]


def _dedupe_references(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    seen = set()
    for reference in references:
        key = (
            reference.get("sourceType"),
            reference.get("provider"),
            reference.get("source"),
            reference.get("excerpt"),
        )
        if key in seen:
            continue
        seen.add(key)
        cleaned = dict(reference)
        cleaned.pop("_score", None)
        result.append(cleaned)
    return result
