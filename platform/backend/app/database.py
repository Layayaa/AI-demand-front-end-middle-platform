from contextlib import contextmanager
import json
from pathlib import Path
from typing import Any, Iterator, Mapping, Optional
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from .config import decrypt_runtime_secret, encrypt_runtime_secret, settings


_engine: Optional[Engine] = None
_runtime_settings_table_ready = False
_llm_profiles_table_ready = False


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            future=True,
        )
    return _engine


def get_server_engine() -> Engine:
    return create_engine(settings.database_server_url, pool_pre_ping=True, future=True)


@contextmanager
def connection() -> Iterator:
    with get_engine().begin() as conn:
        yield conn


def ensure_runtime_settings_table() -> None:
    global _runtime_settings_table_ready
    if _runtime_settings_table_ready:
        return
    with connection() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS runtime_settings (
                    setting_key VARCHAR(64) NOT NULL,
                    llm_provider VARCHAR(120) NOT NULL,
                    llm_base_url VARCHAR(500) NOT NULL,
                    llm_model VARCHAR(180) NOT NULL,
                    llm_quality_model VARCHAR(180) NOT NULL,
                    llm_api_key TEXT NULL,
                    llm_timeout_seconds DOUBLE NOT NULL,
                    llm_document_timeout_seconds DOUBLE NOT NULL,
                    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3),
                    PRIMARY KEY (setting_key)
                ) ENGINE=InnoDB
                """
            )
        )
    _runtime_settings_table_ready = True


def fetch_runtime_llm_config() -> Optional[dict]:
    ensure_runtime_settings_table()
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT setting_key, llm_provider, llm_base_url, llm_model,
                       llm_quality_model, llm_api_key, llm_timeout_seconds,
                       llm_document_timeout_seconds, created_at, updated_at
                FROM runtime_settings
                WHERE setting_key = 'llm'
                """
            )
        ).mappings().first()
    if not row:
        return None
    item = dict(row)
    encrypted_api_key = item.get("llm_api_key")
    if encrypted_api_key:
        try:
            item["llm_api_key"] = decrypt_runtime_secret(
                encrypted_api_key,
                settings.auth_secret_key,
            )
        except ValueError:
            item.pop("llm_api_key", None)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    return item


def save_runtime_llm_config(
    *,
    provider: str,
    base_url: str,
    model: str,
    quality_model: str,
    api_key: Optional[str],
    timeout_seconds: float,
    document_timeout_seconds: float,
) -> dict:
    ensure_runtime_settings_table()
    encrypted_api_key = (
        encrypt_runtime_secret(api_key, settings.auth_secret_key)
        if api_key
        else None
    )
    with connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO runtime_settings (
                    setting_key, llm_provider, llm_base_url, llm_model,
                    llm_quality_model, llm_api_key, llm_timeout_seconds,
                    llm_document_timeout_seconds
                )
                VALUES (
                    'llm', :provider, :base_url, :model, :quality_model,
                    :api_key, :timeout_seconds, :document_timeout_seconds
                )
                ON DUPLICATE KEY UPDATE
                    llm_provider = VALUES(llm_provider),
                    llm_base_url = VALUES(llm_base_url),
                    llm_model = VALUES(llm_model),
                    llm_quality_model = VALUES(llm_quality_model),
                    llm_api_key = VALUES(llm_api_key),
                    llm_timeout_seconds = VALUES(llm_timeout_seconds),
                    llm_document_timeout_seconds = VALUES(llm_document_timeout_seconds)
                """
            ),
            {
                "provider": provider,
                "base_url": base_url,
                "model": model,
                "quality_model": quality_model,
                "api_key": encrypted_api_key,
                "timeout_seconds": timeout_seconds,
                "document_timeout_seconds": document_timeout_seconds,
            },
        )
    config = fetch_runtime_llm_config()
    if config is None:
        raise RuntimeError("LLM 配置保存后未能读取")
    return config


def ensure_llm_profiles_table() -> None:
    global _llm_profiles_table_ready
    if _llm_profiles_table_ready:
        return
    with connection() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS llm_profiles (
                    profile_id VARCHAR(64) NOT NULL,
                    profile_name VARCHAR(120) NOT NULL,
                    llm_provider VARCHAR(120) NOT NULL,
                    llm_base_url VARCHAR(500) NOT NULL,
                    llm_model VARCHAR(180) NOT NULL,
                    llm_quality_model VARCHAR(180) NOT NULL,
                    llm_api_key TEXT NULL,
                    llm_timeout_seconds DOUBLE NOT NULL,
                    llm_document_timeout_seconds DOUBLE NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3),
                    PRIMARY KEY (profile_id),
                    INDEX idx_llm_profiles_active (is_active),
                    UNIQUE KEY uq_llm_profiles_name (profile_name)
                ) ENGINE=InnoDB
                """
            )
        )
    _llm_profiles_table_ready = True


def _profile_row_payload(row: Mapping, *, include_secret: bool = False) -> dict:
    item = dict(row)
    encrypted_api_key = item.get("llm_api_key")
    item["api_key_configured"] = bool(encrypted_api_key)
    if include_secret and encrypted_api_key:
        try:
            item["llm_api_key"] = decrypt_runtime_secret(
                encrypted_api_key,
                settings.auth_secret_key,
            )
        except ValueError:
            item["llm_api_key"] = ""
    else:
        item.pop("llm_api_key", None)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    return item


def fetch_llm_profile(profile_id: str, *, include_secret: bool = False) -> Optional[dict]:
    ensure_llm_profiles_table()
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT profile_id, profile_name, llm_provider, llm_base_url,
                       llm_model, llm_quality_model, llm_api_key,
                       llm_timeout_seconds, llm_document_timeout_seconds,
                       is_active, created_at, updated_at
                FROM llm_profiles
                WHERE profile_id = :profile_id
                """
            ),
            {"profile_id": profile_id},
        ).mappings().first()
    return _profile_row_payload(row, include_secret=include_secret) if row else None


def save_llm_profile(
    *,
    profile_id: Optional[str],
    profile_name: str,
    provider: str,
    base_url: str,
    model: str,
    quality_model: str,
    api_key: Optional[str],
    timeout_seconds: float,
    document_timeout_seconds: float,
    activate: bool = True,
) -> dict:
    ensure_llm_profiles_table()
    resolved_profile_id = profile_id or uuid4().hex
    with connection() as conn:
        existing = conn.execute(
            text("SELECT llm_api_key FROM llm_profiles WHERE profile_id = :profile_id"),
            {"profile_id": resolved_profile_id},
        ).mappings().first()
        if api_key == "":
            encrypted_api_key = None
        elif api_key is None:
            encrypted_api_key = existing.get("llm_api_key") if existing else None
        else:
            encrypted_api_key = encrypt_runtime_secret(api_key, settings.auth_secret_key)
        if activate:
            conn.execute(text("UPDATE llm_profiles SET is_active = FALSE"))
        conn.execute(
            text(
                """
                INSERT INTO llm_profiles (
                    profile_id, profile_name, llm_provider, llm_base_url,
                    llm_model, llm_quality_model, llm_api_key,
                    llm_timeout_seconds, llm_document_timeout_seconds, is_active
                )
                VALUES (
                    :profile_id, :profile_name, :provider, :base_url,
                    :model, :quality_model, :api_key,
                    :timeout_seconds, :document_timeout_seconds, :is_active
                )
                ON DUPLICATE KEY UPDATE
                    profile_name = VALUES(profile_name),
                    llm_provider = VALUES(llm_provider),
                    llm_base_url = VALUES(llm_base_url),
                    llm_model = VALUES(llm_model),
                    llm_quality_model = VALUES(llm_quality_model),
                    llm_api_key = VALUES(llm_api_key),
                    llm_timeout_seconds = VALUES(llm_timeout_seconds),
                    llm_document_timeout_seconds = VALUES(llm_document_timeout_seconds),
                    is_active = VALUES(is_active)
                """
            ),
            {
                "profile_id": resolved_profile_id,
                "profile_name": profile_name,
                "provider": provider,
                "base_url": base_url,
                "model": model,
                "quality_model": quality_model,
                "api_key": encrypted_api_key,
                "timeout_seconds": timeout_seconds,
                "document_timeout_seconds": document_timeout_seconds,
                "is_active": activate,
            },
        )
    saved = fetch_llm_profile(resolved_profile_id, include_secret=True)
    if saved is None:
        raise RuntimeError("模型配置保存后未能读取")
    return saved


def activate_llm_profile(profile_id: str) -> Optional[dict]:
    profile = fetch_llm_profile(profile_id, include_secret=True)
    if profile is None:
        return None
    with connection() as conn:
        conn.execute(text("UPDATE llm_profiles SET is_active = FALSE"))
        conn.execute(
            text(
                "UPDATE llm_profiles SET is_active = TRUE WHERE profile_id = :profile_id"
            ),
            {"profile_id": profile_id},
        )
    profile["is_active"] = True
    return profile


def fetch_llm_profiles() -> list[dict]:
    ensure_llm_profiles_table()
    with connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT profile_id, profile_name, llm_provider, llm_base_url,
                       llm_model, llm_quality_model, llm_api_key,
                       llm_timeout_seconds, llm_document_timeout_seconds,
                       is_active, created_at, updated_at
                FROM llm_profiles
                ORDER BY is_active DESC, updated_at DESC, created_at DESC
                """
            )
        ).mappings().all()
    if not rows:
        runtime = fetch_runtime_llm_config()
        if runtime:
            save_llm_profile(
                profile_id="current",
                profile_name=f"{runtime['llm_provider']} / {runtime['llm_model']}",
                provider=runtime["llm_provider"],
                base_url=runtime["llm_base_url"],
                model=runtime["llm_model"],
                quality_model=runtime["llm_quality_model"],
                api_key=runtime.get("llm_api_key") or None,
                timeout_seconds=float(runtime["llm_timeout_seconds"]),
                document_timeout_seconds=float(runtime["llm_document_timeout_seconds"]),
                activate=True,
            )
            return fetch_llm_profiles()
    return [_profile_row_payload(row) for row in rows]


def database_status() -> dict:
    try:
        with get_engine().connect() as conn:
            value = conn.execute(text("SELECT 1")).scalar_one()
        return {"ready": value == 1, "error": ""}
    except SQLAlchemyError as exc:
        return {"ready": False, "error": str(exc)}


def run_sql_file(path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    statements = [part.strip() for part in sql.split(";") if part.strip()]
    with get_server_engine().begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def _serialize_project(row: Mapping) -> dict:
    item = dict(row)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    for key in ("effort_min_pm", "effort_max_pm"):
        value = item.get(key)
        if value is not None:
            item[key] = float(value)
    return item


def _serialize_source_file(row: Mapping) -> dict:
    item = dict(row)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    metadata = item.get("parser_metadata")
    if isinstance(metadata, str):
        try:
            item["parser_metadata"] = json.loads(metadata)
        except json.JSONDecodeError:
            item["parser_metadata"] = None
    return item


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def _serialize_user(row: Mapping) -> dict:
    item = dict(row)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    return item


def _serialize_profile(row: Mapping) -> dict:
    item = dict(row)
    for key in ("created_at",):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    item["profile_json"] = _json_value(item.get("profile_json")) or {}
    item["source_refs"] = _json_value(item.get("source_refs"))
    return item


def _serialize_assessment(row: Mapping) -> dict:
    item = dict(row)
    for key in ("created_at",):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    for key in ("effort_min_pm", "effort_max_pm"):
        if item.get(key) is not None:
            item[key] = float(item[key])
    dimensions_payload = _json_value(item.pop("dimensions_json", None)) or []
    if isinstance(dimensions_payload, dict):
        item["dimensions"] = dimensions_payload.get("dimensions") or []
        item["assessment_source"] = dimensions_payload.get("source") or "rules_fallback"
        item["assessment_model"] = dimensions_payload.get("model")
        item["business_criticality"] = dimensions_payload.get("businessCriticality") or "待确认"
        item["assessment_rationale"] = dimensions_payload.get("rationale") or []
        item["assessment_evidence_gaps"] = dimensions_payload.get("evidenceGaps") or []
    else:
        item["dimensions"] = dimensions_payload
        item["assessment_source"] = "rules_fallback"
        item["assessment_model"] = None
        item["business_criticality"] = "待确认"
        item["assessment_rationale"] = []
        item["assessment_evidence_gaps"] = []
    item["gaps"] = _json_value(item.pop("gaps_json", None)) or []
    return item


def _serialize_generated_document(row: Mapping) -> dict:
    item = dict(row)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if hasattr(value, "isoformat"):
            item[key] = value.isoformat()
    item["knowledge_refs"] = _json_value(item.get("knowledge_refs")) or []
    return item


def _serialize_turn(row: Mapping) -> dict:
    item = dict(row)
    value = item.get("created_at")
    if hasattr(value, "isoformat"):
        item["created_at"] = value.isoformat()
    item["source_refs"] = _json_value(item.get("source_refs"))
    return item


def fetch_project_summaries(limit: int = 50, owner_user_id: Optional[str] = None) -> list[dict]:
    ownership_join = ""
    parameters: dict[str, Any] = {"limit": limit}
    if owner_user_id:
        ownership_join = """
            INNER JOIN project_owners AS owners
              ON owners.project_id = projects.id
             AND owners.user_id = :owner_user_id
        """
        parameters["owner_user_id"] = owner_user_id
    with connection() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT id, title, status, current_stage, priority, value_score,
                       project_size, risk_level, effort_min_pm, effort_max_pm,
                       updated_at
                FROM projects
                {ownership_join}
                ORDER BY updated_at DESC
                LIMIT :limit
                """
            ),
            parameters,
        ).mappings()
        return [_serialize_project(row) for row in rows]


def fetch_project(project_id: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, title, summary, department, requirement_type, status,
                       current_stage, priority, value_score, project_size, risk_level,
                       effort_min_pm, effort_max_pm, confidence, created_at, updated_at
                FROM projects
                WHERE id = :id
                """
            ),
            {"id": project_id},
        ).mappings().first()
    return _serialize_project(row) if row else None


def create_project(
    *,
    title: str,
    summary: str = "",
    department: str = "",
    requirement_type: Optional[str] = None,
    owner_user_id: Optional[str] = None,
) -> dict:
    project_id = str(uuid4())
    with connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO projects (id, title, summary, department, requirement_type)
                VALUES (:id, :title, :summary, :department, :requirement_type)
                """
            ),
            {
                "id": project_id,
                "title": title,
                "summary": summary or None,
                "department": department or None,
                "requirement_type": requirement_type or None,
            },
        )
        if owner_user_id:
            conn.execute(
                text(
                    """
                    INSERT INTO project_owners (project_id, user_id)
                    VALUES (:project_id, :user_id)
                    """
                ),
                {"project_id": project_id, "user_id": owner_user_id},
            )
    project = fetch_project(project_id)
    if project is None:
        raise RuntimeError("项目创建后未能读取")
    return project


def insert_source_file(
    *,
    project_id: str,
    original_filename: str,
    storage_path: str,
    mime_type: str,
    file_size: int,
    file_sha256: str,
    parser_type: str,
    parse_status: str,
    page_count: Optional[int],
    extracted_text: str,
    parser_metadata: dict,
) -> dict:
    file_id = str(uuid4())
    with connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO source_files (
                    id, project_id, original_filename, storage_path, mime_type,
                    file_size, file_sha256, parser_type, parse_status, page_count,
                    extracted_text, parser_metadata
                )
                VALUES (
                    :id, :project_id, :original_filename, :storage_path, :mime_type,
                    :file_size, :file_sha256, :parser_type, :parse_status, :page_count,
                    :extracted_text, :parser_metadata
                )
                """
            ),
            {
                "id": file_id,
                "project_id": project_id,
                "original_filename": original_filename,
                "storage_path": storage_path,
                "mime_type": mime_type,
                "file_size": file_size,
                "file_sha256": file_sha256,
                "parser_type": parser_type,
                "parse_status": parse_status,
                "page_count": page_count,
                "extracted_text": extracted_text,
                "parser_metadata": json.dumps(parser_metadata, ensure_ascii=False),
            },
        )
    source_file = fetch_source_file(file_id)
    if source_file is None:
        raise RuntimeError("文件记录创建后未能读取")
    return source_file


def fetch_source_file(file_id: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, project_id, original_filename, storage_path, mime_type,
                       file_size, file_sha256, parser_type, parse_status, page_count,
                       extracted_text, parser_metadata, created_at, updated_at
                FROM source_files
                WHERE id = :id
                """
            ),
            {"id": file_id},
        ).mappings().first()
    return _serialize_source_file(row) if row else None


def fetch_project_source_files(project_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, project_id, original_filename, storage_path, mime_type,
                       file_size, file_sha256, parser_type, parse_status, page_count,
                       extracted_text, parser_metadata, created_at, updated_at
                FROM source_files
                WHERE project_id = :project_id
                ORDER BY created_at DESC
                """
            ),
            {"project_id": project_id},
        ).mappings()
    return [_serialize_source_file(row) for row in rows]


def create_user(
    *,
    display_name: str,
    username: str,
    password_hash: str,
    role: str,
) -> dict:
    user_id = str(uuid4())
    with connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO users (id, display_name, username, password_hash, role)
                VALUES (:id, :display_name, :username, :password_hash, :role)
                """
            ),
            {
                "id": user_id,
                "display_name": display_name,
                "username": username,
                "password_hash": password_hash,
                "role": role,
            },
        )
    user = fetch_user_by_id(user_id)
    if user is None:
        raise RuntimeError("账号创建后未能读取")
    return user


def fetch_user_by_username(username: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, display_name, username, password_hash, role, status,
                       created_at, updated_at
                FROM users
                WHERE username = :username
                """
            ),
            {"username": username},
        ).mappings().first()
    return _serialize_user(row) if row else None


def fetch_user_by_id(user_id: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, display_name, username, password_hash, role, status,
                       created_at, updated_at
                FROM users
                WHERE id = :id
                """
            ),
            {"id": user_id},
        ).mappings().first()
    return _serialize_user(row) if row else None


def project_owned_by(project_id: str, user_id: str) -> bool:
    with connection() as conn:
        value = conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM project_owners
                WHERE project_id = :project_id AND user_id = :user_id
                """
            ),
            {"project_id": project_id, "user_id": user_id},
        ).scalar_one()
    return bool(value)


def fetch_current_profile(project_id: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, project_id, version, title, requirement_type, completeness,
                       profile_json, source_refs, is_current, created_at
                FROM requirement_profiles
                WHERE project_id = :project_id AND is_current = TRUE
                ORDER BY version DESC
                LIMIT 1
                """
            ),
            {"project_id": project_id},
        ).mappings().first()
    return _serialize_profile(row) if row else None


def save_profile(
    *,
    project_id: str,
    title: str,
    requirement_type: str,
    completeness: int,
    profile: dict,
    source_refs: Optional[list[dict]] = None,
) -> dict:
    profile_id = str(uuid4())
    with connection() as conn:
        version = conn.execute(
            text(
                """
                SELECT COALESCE(MAX(version), 0) + 1
                FROM requirement_profiles
                WHERE project_id = :project_id
                """
            ),
            {"project_id": project_id},
        ).scalar_one()
        conn.execute(
            text(
                """
                UPDATE requirement_profiles
                SET is_current = FALSE
                WHERE project_id = :project_id AND is_current = TRUE
                """
            ),
            {"project_id": project_id},
        )
        conn.execute(
            text(
                """
                INSERT INTO requirement_profiles (
                    id, project_id, version, title, requirement_type, completeness,
                    profile_json, source_refs, is_current
                )
                VALUES (
                    :id, :project_id, :version, :title, :requirement_type, :completeness,
                    :profile_json, :source_refs, TRUE
                )
                """
            ),
            {
                "id": profile_id,
                "project_id": project_id,
                "version": version,
                "title": title,
                "requirement_type": requirement_type,
                "completeness": completeness,
                "profile_json": json.dumps(profile, ensure_ascii=False),
                "source_refs": json.dumps(source_refs or [], ensure_ascii=False),
            },
        )
    saved = fetch_current_profile(project_id)
    if saved is None:
        raise RuntimeError("需求画像保存后未能读取")
    return saved


def append_conversation_turn(
    *,
    project_id: str,
    role: str,
    content: str,
    source_type: str = "chat",
    source_refs: Optional[list[dict]] = None,
) -> dict:
    turn_id = str(uuid4())
    with connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO conversation_turns (
                    id, project_id, role, content, source_type, source_refs
                )
                VALUES (:id, :project_id, :role, :content, :source_type, :source_refs)
                """
            ),
            {
                "id": turn_id,
                "project_id": project_id,
                "role": role,
                "content": content,
                "source_type": source_type,
                "source_refs": json.dumps(source_refs or [], ensure_ascii=False),
            },
        )
        row = conn.execute(
            text(
                """
                SELECT id, project_id, role, content, source_type, source_refs, created_at
                FROM conversation_turns
                WHERE id = :id
                """
            ),
            {"id": turn_id},
        ).mappings().one()
    return _serialize_turn(row)


def fetch_conversation_turns(project_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, project_id, role, content, source_type, source_refs, created_at
                FROM conversation_turns
                WHERE project_id = :project_id
                ORDER BY created_at ASC, id ASC
                """
            ),
            {"project_id": project_id},
        ).mappings()
    return [_serialize_turn(row) for row in rows]


def update_project_progress(
    *,
    project_id: str,
    status: str,
    current_stage: str,
    requirement_type: Optional[str] = None,
) -> None:
    with connection() as conn:
        conn.execute(
            text(
                """
                UPDATE projects
                SET status = :status,
                    current_stage = :current_stage,
                    requirement_type = COALESCE(:requirement_type, requirement_type)
                WHERE id = :project_id
                """
            ),
            {
                "project_id": project_id,
                "status": status,
                "current_stage": current_stage,
                "requirement_type": requirement_type,
            },
        )


def save_assessment(
    *,
    project_id: str,
    profile_id: str,
    assessment: dict,
) -> dict:
    assessment_id = str(uuid4())
    with connection() as conn:
        version = conn.execute(
            text(
                """
                SELECT COALESCE(MAX(version), 0) + 1
                FROM project_assessments
                WHERE project_id = :project_id
                """
            ),
            {"project_id": project_id},
        ).scalar_one()
        conn.execute(
            text(
                """
                UPDATE project_assessments
                SET is_current = FALSE
                WHERE project_id = :project_id AND is_current = TRUE
                """
            ),
            {"project_id": project_id},
        )
        conn.execute(
            text(
                """
                INSERT INTO project_assessments (
                    id, project_id, profile_id, version, value_score, priority,
                    project_size, risk_level, effort_min_pm, effort_max_pm, confidence,
                    dimensions_json, gaps_json, summary, is_current
                )
                VALUES (
                    :id, :project_id, :profile_id, :version, :value_score, :priority,
                    :project_size, :risk_level, :effort_min_pm, :effort_max_pm, :confidence,
                    :dimensions_json, :gaps_json, :summary, TRUE
                )
                """
            ),
            {
                "id": assessment_id,
                "project_id": project_id,
                "profile_id": profile_id,
                "version": version,
                "value_score": assessment["value_score"],
                "priority": assessment["priority"],
                "project_size": assessment["project_size"],
                "risk_level": assessment["risk_level"],
                "effort_min_pm": assessment["effort_min_pm"],
                "effort_max_pm": assessment["effort_max_pm"],
                "confidence": assessment["confidence"],
                "dimensions_json": json.dumps(
                    {
                        "dimensions": assessment["dimensions"],
                        "source": assessment.get("assessment_source", "rules_fallback"),
                        "model": assessment.get("assessment_model"),
                        "businessCriticality": assessment.get("business_criticality", "待确认"),
                        "rationale": assessment.get("assessment_rationale", []),
                        "evidenceGaps": assessment.get("assessment_evidence_gaps", []),
                    },
                    ensure_ascii=False,
                ),
                "gaps_json": json.dumps(assessment["gaps"], ensure_ascii=False),
                "summary": assessment["summary"],
            },
        )
        conn.execute(
            text(
                """
                UPDATE projects
                SET priority = :priority,
                    value_score = :value_score,
                    project_size = :project_size,
                    risk_level = :risk_level,
                    effort_min_pm = :effort_min_pm,
                    effort_max_pm = :effort_max_pm,
                    confidence = :confidence
                WHERE id = :project_id
                """
            ),
            {
                "project_id": project_id,
                "priority": assessment["priority"],
                "value_score": assessment["value_score"],
                "project_size": assessment["project_size"],
                "risk_level": assessment["risk_level"],
                "effort_min_pm": assessment["effort_min_pm"],
                "effort_max_pm": assessment["effort_max_pm"],
                "confidence": assessment["confidence"],
            },
        )
    current = fetch_current_assessment(project_id)
    if current is None:
        raise RuntimeError("项目评估保存后未能读取")
    return current


def fetch_current_assessment(project_id: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, project_id, profile_id, version, value_score, priority,
                       project_size, risk_level, effort_min_pm, effort_max_pm,
                       confidence, dimensions_json, gaps_json, summary, is_current, created_at
                FROM project_assessments
                WHERE project_id = :project_id AND is_current = TRUE
                ORDER BY version DESC
                LIMIT 1
                """
            ),
            {"project_id": project_id},
        ).mappings().first()
    return _serialize_assessment(row) if row else None


def save_generated_documents(
    *,
    project_id: str,
    profile_id: str,
    documents: list[dict[str, str]],
) -> list[dict]:
    with connection() as conn:
        for document in documents:
            version = conn.execute(
                text(
                    """
                    SELECT COALESCE(MAX(version), 0) + 1
                    FROM generated_documents
                    WHERE project_id = :project_id
                      AND tier = :tier
                      AND document_type = :document_type
                    """
                ),
                {
                    "project_id": project_id,
                    "tier": document["tier"],
                    "document_type": document["document_type"],
                },
            ).scalar_one()
            conn.execute(
                text(
                    """
                    INSERT INTO generated_documents (
                        id, project_id, profile_id, tier, document_type, version,
                        title, status, markdown_content, model_name, prompt_version,
                        knowledge_refs
                    )
                    VALUES (
                        :id, :project_id, :profile_id, :tier, :document_type, :version,
                        :title, 'ready', :markdown_content, :model_name,
                        :prompt_version, :knowledge_refs
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "project_id": project_id,
                    "profile_id": profile_id,
                    "tier": document["tier"],
                    "document_type": document["document_type"],
                    "version": version,
                    "title": document["title"],
                    "markdown_content": document["markdown_content"],
                    "model_name": document.get("model_name") or "builtin_template",
                    "prompt_version": document.get("prompt_version") or "plans-v2",
                    "knowledge_refs": json.dumps(document.get("knowledge_refs") or [], ensure_ascii=False),
                },
            )
    return fetch_current_generated_documents(project_id)


def fetch_current_generated_documents(project_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, project_id, profile_id, tier, document_type, version, title,
                       status, markdown_content, storage_path, model_name, prompt_version,
                       knowledge_refs, created_at, updated_at
                FROM generated_documents
                WHERE project_id = :project_id
                ORDER BY tier ASC, document_type ASC, version DESC
                """
            ),
            {"project_id": project_id},
        ).mappings()
        latest = {}
        for row in rows:
            key = (row["tier"], row["document_type"])
            if key not in latest:
                latest[key] = _serialize_generated_document(row)
    return list(latest.values())


def fetch_generated_document(document_id: str) -> Optional[dict]:
    with connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, project_id, profile_id, tier, document_type, version, title,
                       status, markdown_content, storage_path, model_name, prompt_version,
                       knowledge_refs, created_at, updated_at
                FROM generated_documents
                WHERE id = :document_id
                """
            ),
            {"document_id": document_id},
        ).mappings().first()
    return _serialize_generated_document(row) if row else None


def create_review_feedback(
    *,
    project_id: str,
    reviewer_user_id: str,
    action: str,
    note: str,
) -> dict:
    feedback_id = str(uuid4())
    with connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO review_feedback (
                    id, project_id, reviewer_user_id, action, note
                )
                VALUES (:id, :project_id, :reviewer_user_id, :action, :note)
                """
            ),
            {
                "id": feedback_id,
                "project_id": project_id,
                "reviewer_user_id": reviewer_user_id,
                "action": action,
                "note": note,
            },
        )
        row = conn.execute(
            text(
                """
                SELECT id, project_id, reviewer_user_id, action, note, created_at
                FROM review_feedback
                WHERE id = :id
                """
            ),
            {"id": feedback_id},
        ).mappings().one()
    item = dict(row)
    if hasattr(item.get("created_at"), "isoformat"):
        item["created_at"] = item["created_at"].isoformat()
    return item


def fetch_review_feedback(project_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT feedback.id, feedback.project_id, feedback.reviewer_user_id,
                       feedback.action, feedback.note, feedback.created_at,
                       users.display_name AS reviewer_name
                FROM review_feedback AS feedback
                INNER JOIN users ON users.id = feedback.reviewer_user_id
                WHERE feedback.project_id = :project_id
                ORDER BY feedback.created_at DESC, feedback.id DESC
                """
            ),
            {"project_id": project_id},
        ).mappings()
    items = []
    for row in rows:
        item = dict(row)
        if hasattr(item.get("created_at"), "isoformat"):
            item["created_at"] = item["created_at"].isoformat()
        items.append(item)
    return items
