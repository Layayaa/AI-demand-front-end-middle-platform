import asyncio
import json
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal, Optional
from uuid import uuid4
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError

from .assessment import assess, merge_model_assessment
from .auth import (
    AuthenticationError,
    create_access_token,
    decode_access_token,
    hash_password,
    normalize_username,
    public_user,
    verify_password,
)
from .clarification import (
    apply_ai_direction,
    apply_answer,
    confirmation_gaps_for,
    gaps_for,
    new_profile,
    next_message,
    normalize_profile,
    question_catalog,
    visible_gaps_for,
)
from .config import settings
from .database import (
    append_conversation_turn,
    create_project,
    create_review_feedback,
    create_user,
    database_status,
    fetch_conversation_turns,
    fetch_current_assessment,
    fetch_current_generated_documents,
    fetch_generated_document,
    fetch_current_profile,
    fetch_project,
    fetch_source_file,
    fetch_project_source_files,
    fetch_project_summaries,
    fetch_review_feedback,
    activate_llm_profile,
    fetch_llm_profile,
    fetch_llm_profiles,
    fetch_runtime_llm_config,
    fetch_user_by_id,
    fetch_user_by_username,
    insert_source_file,
    project_owned_by,
    save_assessment,
    save_generated_documents,
    save_llm_profile,
    save_runtime_llm_config,
    save_profile,
    update_project_progress,
)
from .document_parser import DocumentParseError, parse_document, parser_type_for
from .docx_export import render_document_docx, safe_docx_filename
from .knowledge import collect_plan_references, list_uploaded_knowledge_files
from .material_profile import merge_material_into_profile
from .llm_presets import public_llm_presets
from .llm import (
    LlmClientError,
    assess_requirement,
    decide_clarification,
    decide_clarification_stream,
    test_connection,
)
from .plans import generate_documents, generate_requirement_explanation


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI 需求前置分析中台：需求人完成澄清，评审人查看内部评估并处理需求。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_origin,
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3210",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer_scheme = HTTPBearer(auto_error=False)
TEST_USERNAMES = {
    "requester": "test-requester",
    "reviewer": "test-reviewer",
}
TEST_DISPLAY_NAMES = {
    "requester": "测试需求人",
    "reviewer": "测试评审人",
}


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    summary: str = Field(default="", max_length=5000)
    department: str = Field(default="", max_length=120)
    requirement_type: Optional[Literal["decision", "sop"]] = None

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("需求标题不能为空")
        return title


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("display_name")
    @classmethod
    def display_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("姓名不能为空")
        return value

    @field_validator("username")
    @classmethod
    def username_must_be_valid(cls, value: str) -> str:
        value = normalize_username(value)
        if not value or any(char.isspace() for char in value):
            raise ValueError("账号不能包含空格")
        return value


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def normalized_username(cls, value: str) -> str:
        return normalize_username(value)


class ClarificationMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    input_mode: Literal["manual", "suggestion", "confirm"] = "manual"
    question_key: Optional[str] = Field(default=None, max_length=80)
    attachment_ids: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("回答不能为空")
        return value


class ReviewRequest(BaseModel):
    action: Literal["request_info", "approve"]
    note: str = Field(min_length=1, max_length=5000)

    @field_validator("note")
    @classmethod
    def note_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("评审意见不能为空")
        return value


class LlmTestRequest(BaseModel):
    mode: Literal["default", "quality"] = "default"


class LlmConfigRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=120)
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(min_length=1, max_length=180)
    quality_model: str = Field(min_length=1, max_length=180)
    api_key: Optional[str] = Field(default=None, max_length=1000)
    clear_api_key: bool = False
    timeout_seconds: float = Field(default=30, ge=5, le=300)
    document_timeout_seconds: float = Field(default=90, ge=15, le=1800)

    @field_validator("provider", "model", "quality_model")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("模型配置不能为空")
        return value

    @field_validator("base_url")
    @classmethod
    def base_url_must_be_http_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")):
            raise ValueError("Base URL 必须以 http:// 或 https:// 开头")
        return value


class LlmProfileRequest(LlmConfigRequest):
    profile_id: Optional[str] = Field(default=None, max_length=64)
    profile_name: str = Field(min_length=1, max_length=120)

    @field_validator("profile_name")
    @classmethod
    def profile_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("模型配置名称不能为空")
        return value


def database_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"MySQL 未就绪或 schema 未初始化：{exc}")


def _safe_filename(filename: str) -> str:
    name = Path(filename or "upload").name
    cleaned = "".join(ch if ch.isalnum() or ch in ".-_ " else "_" for ch in name).strip()
    return cleaned or "upload"


def _apply_runtime_llm_config(config: Optional[dict]) -> None:
    if not config:
        return
    settings.llm_provider = config["llm_provider"]
    settings.llm_base_url = config["llm_base_url"]
    settings.llm_model = config["llm_model"]
    settings.llm_quality_model = config["llm_quality_model"]
    settings.llm_timeout_seconds = float(config["llm_timeout_seconds"])
    settings.llm_document_timeout_seconds = float(config["llm_document_timeout_seconds"])
    if "llm_api_key" in config:
        settings.llm_api_key = config.get("llm_api_key") or ""


def _load_runtime_llm_config() -> None:
    try:
        _apply_runtime_llm_config(fetch_runtime_llm_config())
    except Exception as exc:
        print(f"[settings] runtime LLM 配置加载失败，继续使用环境变量：{exc}")


def _llm_status_payload() -> dict:
    try:
        profiles = fetch_llm_profiles()
    except Exception as exc:
        print(f"[settings] LLM 配置档案读取失败：{exc}")
        profiles = []
    return {
        "provider": settings.llm_provider,
        "baseUrl": settings.llm_base_url,
        "model": settings.llm_model,
        "qualityModel": settings.llm_quality_model,
        "timeoutSeconds": settings.llm_timeout_seconds,
        "documentTimeoutSeconds": settings.llm_document_timeout_seconds,
        "apiKeyConfigured": bool(settings.llm_api_key),
        "runtimeMode": settings.runtime_mode,
        "presets": public_llm_presets(),
        "profiles": [
            {
                "id": item["profile_id"],
                "name": item["profile_name"],
                "provider": item["llm_provider"],
                "baseUrl": item["llm_base_url"],
                "model": item["llm_model"],
                "qualityModel": item["llm_quality_model"],
                "timeoutSeconds": float(item["llm_timeout_seconds"]),
                "documentTimeoutSeconds": float(item["llm_document_timeout_seconds"]),
                "apiKeyConfigured": item["api_key_configured"],
                "active": bool(item["is_active"]),
            }
            for item in profiles
        ],
    }


def _file_summary(source_file: dict) -> dict:
    text = source_file.get("extracted_text") or ""
    item = dict(source_file)
    item["text_length"] = len(text)
    item["text_preview"] = text[:600]
    item.pop("extracted_text", None)
    return item


def _knowledge_file_summary(knowledge_file: dict) -> dict:
    return _file_summary(knowledge_file)


def _login_response(user: dict[str, Any]) -> dict:
    return {
        "accessToken": create_access_token(
            user,
            settings.auth_secret_key,
            settings.auth_token_ttl_minutes,
        ),
        "user": public_user(user),
    }


def _test_user(role: str) -> dict:
    if settings.app_env == "production":
        raise HTTPException(status_code=403, detail="生产环境不能启用测试身份切换")
    username = TEST_USERNAMES[role]
    try:
        user = fetch_user_by_username(username)
        if user is None:
            try:
                user = create_user(
                    display_name=TEST_DISPLAY_NAMES[role],
                    username=username,
                    password_hash="test-switch-only",
                    role=role,
                )
            except IntegrityError:
                user = fetch_user_by_username(username)
        if user is None:
            raise RuntimeError("测试身份创建后未能读取")
        return user
    except HTTPException:
        raise
    except Exception as exc:
        raise database_unavailable(exc) from exc


def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    test_role: Optional[str] = Header(default=None, alias="X-Test-Role"),
) -> dict:
    if settings.auth_mode == "test_switch":
        if test_role not in TEST_USERNAMES:
            raise HTTPException(status_code=401, detail="请选择测试角色")
        return _test_user(test_role)

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="请先登录")
    try:
        payload = decode_access_token(credentials.credentials, settings.auth_secret_key)
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    try:
        user = fetch_user_by_id(payload["sub"])
    except Exception as exc:
        raise database_unavailable(exc) from exc
    if user is None or user["status"] != "active" or user["role"] != payload["role"]:
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录")
    return user


def reviewer_user(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "reviewer":
        raise HTTPException(status_code=403, detail="此功能仅面向评审人")
    return user


def project_for_user(project_id: str, user: dict) -> dict:
    try:
        project = fetch_project(project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        if user["role"] != "reviewer" and not project_owned_by(project_id, user["id"]):
            raise HTTPException(status_code=403, detail="无权查看此需求")
        return project
    except HTTPException:
        raise
    except Exception as exc:
        raise database_unavailable(exc) from exc


def _profile_for_project(project: dict) -> tuple[dict, Optional[str]]:
    record = fetch_current_profile(project["id"])
    if record:
        return normalize_profile(record["profile_json"]), record["id"]
    profile = new_profile(
        title=project["title"],
        department=project.get("department"),
        summary=project.get("summary"),
        requirement_type=project.get("requirement_type"),
    )
    return profile, None


def _attachment_refs(project_id: str, attachment_ids: list[str]) -> list[dict[str, Any]]:
    unique_ids = list(dict.fromkeys(item.strip() for item in attachment_ids if item.strip()))
    if not unique_ids:
        return []
    files = {
        item["id"]: item
        for item in fetch_project_source_files(project_id)
        if item.get("id")
    }
    missing = [item for item in unique_ids if item not in files]
    if missing:
        raise HTTPException(status_code=400, detail="附件不属于当前需求，无法关联到本轮回答")
    return [
        {
            "id": files[file_id]["id"],
            "name": files[file_id]["original_filename"],
            "parserType": files[file_id].get("parser_type"),
            "parseStatus": files[file_id].get("parse_status"),
            "textLength": files[file_id].get("text_length", len(files[file_id].get("extracted_text") or "")),
        }
        for file_id in unique_ids
    ]


def _repair_invalid_confirmation(profile: dict) -> tuple[dict, bool]:
    if profile.get("stage") != "confirm" or profile.get("aiJudged"):
        return profile, False
    if profile.get("type") in {"decision", "sop"}:
        return profile, False
    gaps = [
        {
            "key": "type",
            "label": "需求形态",
            "severity": "high",
            "reason": "AI 尚未判断这是一次业务判断还是一条执行流程。",
        }
    ]
    profile["stage"] = "clarifying"
    profile["activeQuestion"] = None
    profile["aiJudged"] = False
    profile["aiGaps"] = gaps[:5]
    return profile, True


def _save_profile_for_project(project: dict, profile: dict) -> dict:
    requirement_type = profile["type"] if profile["type"] in {"decision", "sop"} else "unknown"
    return save_profile(
        project_id=project["id"],
        title=project["title"],
        requirement_type=requirement_type,
        completeness=profile["completeness"],
        profile=profile,
        source_refs=[{"sourceType": "project_summary"}] if project.get("summary") else [],
    )


def _clarification_payload(project: dict, profile: dict, profile_id: Optional[str] = None) -> dict:
    return {
        "projectId": project["id"],
        "projectStatus": project["status"],
        "projectStage": project["current_stage"],
        "profile": profile,
        "profileId": profile_id,
        "gaps": visible_gaps_for(profile),
        "next": next_message(profile),
        "messages": fetch_conversation_turns(project["id"]),
    }


def _question_texts_from_history(history: list[dict]) -> list[str]:
    return [
        str(item.get("content") or "").strip()
        for item in history
        if item.get("role") == "assistant"
        and item.get("source_type") in {"ai_question", "ai_guardrail"}
        and str(item.get("content") or "").strip()
    ][-8:]


def _ensure_current_question_turn(
    project_id: str,
    profile: dict,
    messages: Optional[list[dict]] = None,
) -> list[dict]:
    messages = list(messages if messages is not None else fetch_conversation_turns(project_id))
    prompt = next_message(profile)
    if prompt.get("stage") in {"done", "confirm"}:
        return messages
    content = str(prompt.get("content") or "").strip()
    if not content:
        return messages
    latest = messages[-1] if messages else None
    if (
        latest
        and latest.get("role") == "assistant"
        and str(latest.get("content") or "").strip() == content
    ):
        return messages
    turn = append_conversation_turn(
        project_id=project_id,
        role="assistant",
        content=content,
        source_type="ai_question",
        source_refs=[
            {
                "questionKey": prompt.get("questionKey"),
                "stage": prompt.get("stage"),
            }
        ],
    )
    messages.append(turn)
    return messages


async def _direct_clarification(
    project: dict,
    profile: dict,
    *,
    latest_answer: str = "",
    project_materials: Optional[list[dict[str, Any]]] = None,
) -> Optional[dict]:
    if not settings.llm_api_key or profile.get("stage") == "done":
        return None
    history = fetch_conversation_turns(project["id"])
    direction = await decide_clarification(
        settings,
        project=project,
        profile=profile,
        history=history,
        question_catalog=question_catalog(profile),
        latest_answer=latest_answer,
        project_materials=project_materials or [],
    )
    return apply_ai_direction(
        profile,
        direction,
        recent_question_texts=_question_texts_from_history(history),
    )


def _plan_references(project: dict, profile: dict) -> list[dict]:
    return collect_plan_references(
        settings=settings,
        project=project,
        profile=profile,
        source_files=fetch_project_source_files(project["id"]),
        knowledge_files=list_uploaded_knowledge_files(settings),
    )


def _assessment_gaps(profile: dict) -> list[dict[str, str]]:
    return visible_gaps_for(profile)


async def _build_assessment(
    *,
    project: dict,
    profile: dict,
    gaps: list[dict[str, str]],
) -> dict:
    fallback = assess(profile, gaps)
    if not settings.llm_api_key:
        return fallback
    try:
        model_assessment = await assess_requirement(
            settings,
            project=project,
            profile=profile,
            gaps=gaps,
            project_materials=fetch_project_source_files(project["id"]),
        )
        return merge_model_assessment(fallback, model_assessment)
    except LlmClientError as exc:
        print(f"[llm] 价值评估回退基础规则：{project.get('title')}: {exc}")
        return fallback


async def _generate_with_llm_fallback(
    *,
    project: dict,
    profile: dict,
    documents: list[dict],
    references: list[dict],
) -> list[dict]:
    async def enhance(document: dict) -> dict:
        item = dict(document)
        # 需求前置方案是方向性选型，不让模型二次扩写，保证和 demo 一样短而可扫读。
        item["model_name"] = "builtin_template"
        item["prompt_version"] = item.get("prompt_version") or "plans-v8"
        return item

    return list(await asyncio.gather(*(enhance(document) for document in documents)))


async def _save_requirement_explanation(
    *,
    project: dict,
    profile: dict,
    profile_id: str,
) -> list[dict]:
    references = _plan_references(project, profile)
    draft = generate_requirement_explanation(
        project,
        profile,
        _assessment_gaps(profile),
        references=references,
    )
    documents = await _generate_with_llm_fallback(
        project=project,
        profile=profile,
        documents=[draft],
        references=references,
    )
    return save_generated_documents(
        project_id=project["id"],
        profile_id=profile_id,
        documents=documents,
    )


async def _save_solution_documents(
    *,
    project: dict,
    profile: dict,
    profile_id: str,
) -> list[dict]:
    references = _plan_references(project, profile)
    drafts = generate_documents(
        project,
        profile,
        _assessment_gaps(profile),
        references=references,
    )
    documents = await _generate_with_llm_fallback(
        project=project,
        profile=profile,
        documents=drafts,
        references=references,
    )
    return save_generated_documents(
        project_id=project["id"],
        profile_id=profile_id,
        documents=documents,
    )


def _has_requirement_explanation(project_id: str) -> bool:
    return any(
        document["tier"] == "requirement_explanation"
        and document["document_type"] == "explanation"
        and document.get("prompt_version") == "plans-v8"
        and document.get("model_name") == "builtin_template"
        for document in fetch_current_generated_documents(project_id)
    )


def _requester_document(document: dict) -> dict:
    visible = dict(document)
    visible["markdown_content"] = _requester_markdown(document.get("markdown_content") or "")
    for key in ("profile_id", "storage_path", "model_name", "prompt_version", "knowledge_refs"):
        visible.pop(key, None)
    return visible


def _requester_markdown(markdown: str) -> str:
    start_marker = "### 七邦参考知识（仅供参考，不等同于当前事实）"
    end_marker = "### AI 推测与落地边界"
    start = markdown.find(start_marker)
    if start < 0:
        return markdown
    end = markdown.find(end_marker, start)
    replacement = (
        "### 内部参考边界\n\n"
        "- 内部知识库参考已由评审人核验；此处仅展示已经确认的方案结论。\n\n"
    )
    if end < 0:
        return markdown[:start].rstrip() + "\n\n" + replacement.rstrip()
    return markdown[:start].rstrip() + "\n\n" + replacement + markdown[end:]


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "name": settings.app_name,
        "version": settings.app_version,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.on_event("startup")
def load_runtime_settings() -> None:
    _load_runtime_llm_config()


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> dict:
    if settings.auth_mode == "test_switch":
        raise HTTPException(status_code=409, detail="当前为测试角色切换模式，无需注册")
    try:
        if fetch_user_by_username(payload.username):
            raise HTTPException(status_code=409, detail="该账号已存在")
        user = create_user(
            display_name=payload.display_name,
            username=payload.username,
            password_hash=hash_password(payload.password),
            role="requester",
        )
    except HTTPException:
        raise
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该账号已存在") from exc
    except Exception as exc:
        raise database_unavailable(exc) from exc
    return _login_response(user)


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict:
    if settings.auth_mode == "test_switch":
        raise HTTPException(status_code=409, detail="当前为测试角色切换模式，无需登录")
    try:
        user = fetch_user_by_username(payload.username)
    except Exception as exc:
        raise database_unavailable(exc) from exc
    if user is None or user["status"] != "active" or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    return _login_response(user)


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)) -> dict:
    return public_user(user)


@app.get("/api/ready")
def ready(_: dict = Depends(reviewer_user)) -> dict:
    _load_runtime_llm_config()
    db = database_status()
    return {
        "ready": db["ready"],
        "database": db,
        "llmApiKeyConfigured": bool(settings.llm_api_key),
        "ragflowEnabled": settings.ragflow_enabled,
        "ragflowApiKeyConfigured": bool(settings.ragflow_api_key),
    }


@app.get("/api/settings/public")
def public_settings(_: dict = Depends(reviewer_user)) -> dict:
    _load_runtime_llm_config()
    return settings.public_snapshot()


@app.get("/api/projects")
def list_projects(limit: int = 50, user: dict = Depends(current_user)) -> dict:
    try:
        owner_user_id = user["id"] if user["role"] == "requester" else None
        return {"items": fetch_project_summaries(max(1, min(limit, 100)), owner_user_id)}
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.post("/api/projects", status_code=status.HTTP_201_CREATED)
def create_project_endpoint(
    payload: ProjectCreateRequest,
    user: dict = Depends(current_user),
) -> dict:
    if user["role"] != "requester":
        raise HTTPException(status_code=403, detail="评审人不能以需求人身份新建需求")
    try:
        return create_project(
            title=payload.title,
            summary=payload.summary.strip(),
            department=payload.department.strip(),
            requirement_type=payload.requirement_type,
            owner_user_id=user["id"],
        )
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, user: dict = Depends(current_user)) -> dict:
    return project_for_user(project_id, user)


@app.get("/api/projects/{project_id}/files")
def list_project_files(project_id: str, user: dict = Depends(current_user)) -> dict:
    project_for_user(project_id, user)
    try:
        files = fetch_project_source_files(project_id)
        return {"items": [_file_summary(file) for file in files]}
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.get("/api/projects/{project_id}/files/{file_id}/download")
def download_project_file(
    project_id: str,
    file_id: str,
    user: dict = Depends(current_user),
) -> FileResponse:
    project_for_user(project_id, user)
    try:
        source_file = fetch_source_file(file_id)
    except Exception as exc:
        raise database_unavailable(exc) from exc

    if source_file is None or source_file.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="附件不存在")

    try:
        upload_root = settings.upload_root.resolve()
        file_path = (settings.upload_root.parent / source_file["storage_path"]).resolve()
        file_path.relative_to(upload_root)
    except (KeyError, OSError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="附件存储路径无效") from exc

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="附件文件不存在")

    return FileResponse(
        path=file_path,
        filename=source_file.get("original_filename") or "download",
        media_type=source_file.get("mime_type") or "application/octet-stream",
        content_disposition_type="inline",
    )


@app.get("/api/knowledge/files")
def list_knowledge_files_endpoint(_: dict = Depends(reviewer_user)) -> dict:
    try:
        return {"items": [_knowledge_file_summary(item) for item in list_uploaded_knowledge_files(settings)]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"知识库文件读取失败：{exc}") from exc


@app.post("/api/knowledge/files", status_code=status.HTTP_201_CREATED)
async def upload_knowledge_file(
    file: UploadFile = File(...),
    _: dict = Depends(reviewer_user),
) -> dict:
    original_filename = _safe_filename(file.filename or "knowledge-upload")
    try:
        parser_type_for(original_filename)
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    content = await file.read()
    max_size = settings.upload_max_size_mb * 1024 * 1024
    if len(content) > max_size:
        raise HTTPException(status_code=413, detail=f"文件超过 {settings.upload_max_size_mb}MB 限制")
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    settings.knowledge_upload_root.mkdir(parents=True, exist_ok=True)
    storage_name = f"{uuid4().hex}__{original_filename}"
    storage_path = settings.knowledge_upload_root / storage_name
    storage_path.write_bytes(content)

    try:
        uploaded_file = next(
            item
            for item in list_uploaded_knowledge_files(settings)
            if item["storage_name"] == storage_name
        )
    except StopIteration as exc:
        raise HTTPException(status_code=500, detail="知识库文件保存后未能读取") from exc
    return _knowledge_file_summary(uploaded_file)


@app.post("/api/projects/{project_id}/files", status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
) -> dict:
    project = project_for_user(project_id, user)
    if user["role"] != "requester":
        raise HTTPException(status_code=403, detail="评审人不能上传需求材料")

    original_filename = _safe_filename(file.filename or "upload")
    try:
        parser_type_for(original_filename)
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    content = await file.read()
    max_size = settings.upload_max_size_mb * 1024 * 1024
    if len(content) > max_size:
        raise HTTPException(status_code=413, detail=f"文件超过 {settings.upload_max_size_mb}MB 限制")
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    upload_dir = settings.upload_root / project_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(original_filename).suffix.lower()
    storage_path = upload_dir / f"{uuid4().hex}{suffix}"
    storage_path.write_bytes(content)

    digest = sha256(content).hexdigest()
    try:
        parsed = parse_document(storage_path, original_filename)
        parse_status = (
            "stored"
            if parsed.get("metadata", {}).get("textExtraction") == "pending_vision_ocr"
            else "parsed"
        )
        extracted_text = parsed["text"]
        parser_metadata = parsed["metadata"]
        page_count = parsed["page_count"]
        parser_type = parsed["parser_type"]
    except DocumentParseError as exc:
        parse_status = "failed"
        extracted_text = ""
        parser_metadata = {"error": str(exc)}
        page_count = None
        parser_type = parser_type_for(original_filename)

    try:
        source_file = insert_source_file(
            project_id=project_id,
            original_filename=original_filename,
            storage_path=str(storage_path.relative_to(settings.upload_root.parent)),
            mime_type=file.content_type or "",
            file_size=len(content),
            file_sha256=digest,
            parser_type=parser_type,
            parse_status=parse_status,
            page_count=page_count,
            extracted_text=extracted_text,
            parser_metadata=parser_metadata,
        )
        if extracted_text.strip():
            profile, _ = _profile_for_project(project)
            enriched_profile = merge_material_into_profile(
                profile,
                filename=original_filename,
                text=extracted_text,
                parser_type=parser_type,
            )
            save_profile(
                project_id=project_id,
                title=project["title"],
                requirement_type=enriched_profile.get("type") or "unknown",
                completeness=enriched_profile["completeness"],
                profile=enriched_profile,
                source_refs=[
                    {
                        "sourceType": "project_material",
                        "sourceId": source_file["id"],
                        "source": original_filename,
                    }
                ],
            )
    except Exception as exc:
        raise database_unavailable(exc) from exc
    return _file_summary(source_file)


@app.get("/api/projects/{project_id}/clarification")
async def get_clarification(project_id: str, user: dict = Depends(current_user)) -> dict:
    project = project_for_user(project_id, user)
    if user["role"] != "requester":
        raise HTTPException(status_code=403, detail="评审人请在需求详情查看画像和评估")
    try:
        profile, profile_id = _profile_for_project(project)
        profile, repaired = _repair_invalid_confirmation(profile)
        if repaired:
            saved_profile = _save_profile_for_project(project, profile)
            profile_id = saved_profile["id"]
        if project["status"] == "needs_info" and profile["stage"] == "done":
            profile["stage"] = "confirm"
        if not fetch_conversation_turns(project_id):
            try:
                directed_profile = await _direct_clarification(
                    project,
                    profile,
                    project_materials=fetch_project_source_files(project_id),
                )
                if directed_profile is not None:
                    profile = directed_profile
                    saved_profile = _save_profile_for_project(project, profile)
                    profile_id = saved_profile["id"]
            except LlmClientError:
                profile["activeQuestion"] = None
                profile["aiJudged"] = False
        if profile["stage"] != "done":
            update_project_progress(
                project_id=project_id,
                status="clarifying",
                current_stage="clarification",
                requirement_type=profile["type"],
            )
            project = fetch_project(project_id) or project
        messages = fetch_conversation_turns(project_id)
        if repaired and messages:
            repair_prompt = next_message(profile)
            messages.append(
                append_conversation_turn(
                    project_id=project_id,
                    role="assistant",
                    content=repair_prompt["content"],
                    source_type="ai_guardrail",
                    source_refs=[
                        {
                            "questionKey": repair_prompt.get("questionKey"),
                            "stage": repair_prompt.get("stage"),
                        }
                    ],
                )
            )
        if profile["stage"] != "done":
            messages = _ensure_current_question_turn(project_id, profile, messages)
        if not messages:
            initial_prompt = next_message(profile)
            assistant_turn = append_conversation_turn(
                project_id=project_id,
                role="assistant",
                content=initial_prompt["content"],
                source_type="ai_question",
                source_refs=[
                    {
                        "questionKey": initial_prompt.get("questionKey"),
                        "stage": initial_prompt.get("stage"),
                    }
                ],
            )
            messages = [assistant_turn]
        payload = _clarification_payload(project, profile, profile_id)
        payload["messages"] = messages
        return payload
    except Exception as exc:
        raise database_unavailable(exc) from exc


async def _direct_clarification_stream(
    project: dict,
    profile: dict,
    *,
    latest_answer: str,
    project_materials: list[dict[str, Any]],
    emit_event,
) -> Optional[dict]:
    if not settings.llm_api_key or profile.get("stage") == "done":
        return None
    direction = None
    history = fetch_conversation_turns(project["id"])
    async for event in decide_clarification_stream(
        settings,
        project=project,
        profile=profile,
        history=history,
        question_catalog=question_catalog(profile),
        latest_answer=latest_answer,
        project_materials=project_materials,
    ):
        if event.get("type") == "question_delta":
            await emit_event({"type": "assistant_delta", "content": event["content"]})
        elif event.get("type") == "question_reset":
            await emit_event({"type": "assistant_reset", "content": event["content"]})
        elif event.get("type") == "direction":
            direction = event.get("direction")
    if not isinstance(direction, dict):
        return None
    return apply_ai_direction(
        profile,
        direction,
        recent_question_texts=_question_texts_from_history(history),
    )


async def _process_clarification_message(
    project_id: str,
    payload: ClarificationMessageRequest,
    user: dict,
    *,
    emit_event=None,
) -> dict:
    project = project_for_user(project_id, user)
    if user["role"] != "requester":
        raise HTTPException(status_code=403, detail="评审人不能代替需求人回答澄清问题")
    if project["status"] == "completed":
        raise HTTPException(status_code=409, detail="需求已完成，不能继续澄清")

    try:
        profile, _ = _profile_for_project(project)
        profile, repaired = _repair_invalid_confirmation(profile)
        if repaired:
            _save_profile_for_project(project, profile)
        if project["status"] == "needs_info" and profile["stage"] == "done":
            profile["stage"] = "confirm"
        attachment_refs = _attachment_refs(project_id, payload.attachment_ids)
        question_before_answer = next_message(profile)
        _ensure_current_question_turn(project_id, profile)
        user_source_type = {
            "manual": "chat",
            "suggestion": "suggested_answer",
            "confirm": "confirmation",
        }[payload.input_mode]
        append_conversation_turn(
            project_id=project_id,
            role="user",
            content=payload.content,
            source_type=user_source_type,
            source_refs=[
                {
                    "inputMode": payload.input_mode,
                    "questionKey": payload.question_key,
                    "questionText": question_before_answer.get("content"),
                    "attachments": attachment_refs,
                }
            ],
        )
        result = apply_answer(profile, payload.content)
        profile = result["profile"]
        profile["activeQuestion"] = None

        llm_directed = False
        if profile["stage"] != "done" and result.get("reason") != "confirmation_blocked":
            try:
                if emit_event is not None:
                    await emit_event({"type": "status", "message": "正在分析你的回答…"})
                    directed_profile = await _direct_clarification_stream(
                        project,
                        profile,
                        latest_answer=payload.content,
                        project_materials=fetch_project_source_files(project_id),
                        emit_event=emit_event,
                    )
                else:
                    directed_profile = await _direct_clarification(
                        project,
                        profile,
                        latest_answer=payload.content,
                        project_materials=fetch_project_source_files(project_id),
                    )
                if directed_profile is not None:
                    profile = directed_profile
                    llm_directed = True
            except LlmClientError:
                if emit_event is not None:
                    await emit_event({"type": "status", "message": "正在整理澄清结果…"})
                    try:
                        directed_profile = await _direct_clarification(
                            project,
                            profile,
                            latest_answer=payload.content,
                            project_materials=fetch_project_source_files(project_id),
                        )
                        if directed_profile is not None:
                            profile = directed_profile
                            llm_directed = True
                    except LlmClientError:
                        profile["activeQuestion"] = None
                        profile["aiJudged"] = False
                else:
                    profile["activeQuestion"] = None
                    profile["aiJudged"] = False
        if result.get("reason") == "business_chain_unclear":
            profile["stage"] = "clarifying"
            profile["aiJudged"] = False
            profile["aiGaps"] = []
            profile["activeQuestion"] = {
                "key": "businessChain",
                "content": (
                    f"我先把“{payload.content.strip()}”记录为业务对象。"
                    "现在还需要确认它属于哪条七邦业务链路，请选择最接近的一项。"
                ),
                "chips": [
                    "商品、库存与商品后台运营",
                    "商品优化与客户 VOC",
                    "订单、财务与单据协同",
                    "培训与组织学习",
                    "其他业务链路",
                ],
            }
        saved_profile = _save_profile_for_project(project, profile)

        if profile["stage"] == "done":
            gaps = _assessment_gaps(profile)
            assessment = await _build_assessment(
                project=project,
                profile=profile,
                gaps=gaps,
            )
            assessment = save_assessment(
                project_id=project_id,
                profile_id=saved_profile["id"],
                assessment=assessment,
            )
            documents = await _save_requirement_explanation(
                project=project,
                profile=profile,
                profile_id=saved_profile["id"],
            )
            update_project_progress(
                project_id=project_id,
                status="waiting_review",
                current_stage="review",
                requirement_type=profile["type"],
            )
            assistant_content = (
                "需求画像已确认，已生成一份需求解释方案，等待评审人确认需求范围、口径和边界。评审确认后会再生成 4 份需求解决方案。"
            )
        elif result.get("reason") == "confirmation_blocked":
            assessment = None
            update_project_progress(
                project_id=project_id,
                status="clarifying",
                current_stage="clarification",
                requirement_type=profile["type"],
            )
            assistant_content = next_message(profile)["content"]
        elif result.get("reason") == "type_unclear" and not llm_directed:
            assessment = None
            update_project_progress(
                project_id=project_id,
                status="clarifying",
                current_stage="clarification",
            )
            assistant_content = "我还不能可靠判断需求形态。请说明它是做一次判断，还是要按步骤跑一条流程。"
        else:
            assessment = None
            stage = "confirmation" if next_message(profile)["stage"] == "confirm" else "clarification"
            update_project_progress(
                project_id=project_id,
                status="clarifying",
                current_stage=stage,
                requirement_type=profile["type"],
            )
            assistant_content = next_message(profile)["content"]

        assistant_prompt = next_message(profile)
        append_conversation_turn(
            project_id=project_id,
            role="assistant",
            content=assistant_content,
            source_type="ai_question" if profile["stage"] != "done" else "ai_transition",
            source_refs=[
                {
                    "questionKey": assistant_prompt.get("questionKey"),
                    "stage": assistant_prompt.get("stage"),
                    "llmDirected": llm_directed,
                }
            ],
        )
        updated_project = fetch_project(project_id) or project
        response = _clarification_payload(updated_project, profile, saved_profile["id"])
        response["assessmentReady"] = assessment is not None
        response["documentsGenerated"] = len(documents) if profile["stage"] == "done" else 0
        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.post("/api/projects/{project_id}/clarification/messages")
async def send_clarification_message(
    project_id: str,
    payload: ClarificationMessageRequest,
    user: dict = Depends(current_user),
) -> dict:
    return await _process_clarification_message(project_id, payload, user)


def _sse_line(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.post("/api/projects/{project_id}/clarification/messages/stream")
async def send_clarification_message_stream(
    project_id: str,
    payload: ClarificationMessageRequest,
    user: dict = Depends(current_user),
) -> StreamingResponse:
    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        finished = object()

        async def emit_event(event: dict) -> None:
            await queue.put(event)

        async def worker() -> None:
            try:
                await queue.put({"type": "status", "message": "已收到回答，AI 正在分析…"})
                session = await _process_clarification_message(
                    project_id,
                    payload,
                    user,
                    emit_event=emit_event,
                )
                await queue.put({"type": "complete", "session": session})
            except HTTPException as exc:
                await queue.put(
                    {
                        "type": "error",
                        "status": exc.status_code,
                        "message": str(exc.detail),
                    }
                )
            except Exception as exc:
                error = database_unavailable(exc)
                await queue.put(
                    {
                        "type": "error",
                        "status": error.status_code,
                        "message": str(error.detail),
                    }
                )
            finally:
                await queue.put(finished)

        task = asyncio.create_task(worker())
        try:
            while True:
                event = await queue.get()
                if event is finished:
                    break
                yield _sse_line(event)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/projects/{project_id}/assessment")
async def get_project_assessment(
    project_id: str,
    user: dict = Depends(reviewer_user),
) -> dict:
    project = project_for_user(project_id, user)
    try:
        assessment = fetch_current_assessment(project_id)
        if assessment and assessment.get("assessment_source") == "rules_fallback":
            profile_record = fetch_current_profile(project_id)
            if profile_record:
                profile = normalize_profile(profile_record["profile_json"])
                if profile.get("stage") == "done" and settings.llm_api_key:
                    refreshed = await _build_assessment(
                        project=project,
                        profile=profile,
                        gaps=_assessment_gaps(profile),
                    )
                    if refreshed.get("assessment_source") == "llm":
                        assessment = save_assessment(
                            project_id=project_id,
                            profile_id=profile_record["id"],
                            assessment=refreshed,
                        )
    except Exception as exc:
        raise database_unavailable(exc) from exc
    if assessment is None:
        raise HTTPException(status_code=404, detail="该需求尚未完成评估")
    return assessment


@app.get("/api/projects/{project_id}/documents")
def list_project_documents(
    project_id: str,
    user: dict = Depends(current_user),
) -> dict:
    project_for_user(project_id, user)
    try:
        documents = fetch_current_generated_documents(project_id)
        if user["role"] == "requester":
            documents = [_requester_document(document) for document in documents]
        return {"items": documents}
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.get("/api/projects/{project_id}/documents/{document_id}/download")
def download_project_document(
    project_id: str,
    document_id: str,
    user: dict = Depends(current_user),
) -> StreamingResponse:
    project = project_for_user(project_id, user)
    try:
        document = fetch_generated_document(document_id)
        if document is None or document.get("project_id") != project_id:
            raise HTTPException(status_code=404, detail="方案文档不存在")
        if user["role"] == "requester":
            document = _requester_document(document)
        filename = safe_docx_filename(f"{project['title']}-{document['title']}-V{document['version']}")
        return StreamingResponse(
            render_document_docx(document, project),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DOCX 生成失败：{exc}") from exc


@app.post("/api/projects/{project_id}/documents/generate")
async def generate_project_documents(
    project_id: str,
    user: dict = Depends(reviewer_user),
) -> dict:
    project = project_for_user(project_id, user)
    try:
        record = fetch_current_profile(project_id)
        if record is None:
            raise HTTPException(status_code=409, detail="请先完成需求画像")
        profile = normalize_profile(record["profile_json"])
        if profile["stage"] != "done":
            raise HTTPException(status_code=409, detail="请先由需求人确认需求画像")
        if project["status"] != "completed":
            raise HTTPException(status_code=409, detail="评审确认需求后才能生成解决方案")

        assessment = fetch_current_assessment(project_id)
        if assessment is None:
            assessment = await _build_assessment(
                project=project,
                profile=profile,
                gaps=_assessment_gaps(profile),
            )
            assessment = save_assessment(
                project_id=project_id,
                profile_id=record["id"],
                assessment=assessment,
            )
        if not _has_requirement_explanation(project_id):
            await _save_requirement_explanation(
                project=project,
                profile=profile,
                profile_id=record["id"],
            )
        documents = await _save_solution_documents(
            project=project,
            profile=profile,
            profile_id=record["id"],
        )
        return {"items": documents}
    except HTTPException:
        raise
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.post("/api/projects/{project_id}/review")
async def review_project(
    project_id: str,
    payload: ReviewRequest,
    user: dict = Depends(reviewer_user),
) -> dict:
    project = project_for_user(project_id, user)
    try:
        if payload.action == "request_info":
            feedback = create_review_feedback(
                project_id=project_id,
                reviewer_user_id=user["id"],
                action=payload.action,
                note=payload.note,
            )
            update_project_progress(
                project_id=project_id,
                status="needs_info",
                current_stage="clarification",
            )
            append_conversation_turn(
                project_id=project_id,
                role="assistant",
                source_type="review_request",
                content=f"评审人请补充以下信息：{payload.note}",
            )
        else:
            record = fetch_current_profile(project_id)
            if record is None:
                raise HTTPException(status_code=409, detail="该需求尚未形成需求解释方案")
            profile = normalize_profile(record["profile_json"])
            if profile["stage"] != "done":
                raise HTTPException(status_code=409, detail="请先由需求人确认需求画像")
            assessment = fetch_current_assessment(project_id)
            if assessment is None:
                assessment = await _build_assessment(
                    project=project,
                    profile=profile,
                    gaps=_assessment_gaps(profile),
                )
                assessment = save_assessment(
                    project_id=project_id,
                    profile_id=record["id"],
                    assessment=assessment,
                )
            if not _has_requirement_explanation(project_id):
                await _save_requirement_explanation(
                    project=project,
                    profile=profile,
                    profile_id=record["id"],
                )
            documents = await _save_solution_documents(
                project=project,
                profile=profile,
                profile_id=record["id"],
            )
            feedback = create_review_feedback(
                project_id=project_id,
                reviewer_user_id=user["id"],
                action=payload.action,
                note=payload.note,
            )
            update_project_progress(
                project_id=project_id,
                status="completed",
                current_stage="completed",
            )
            append_conversation_turn(
                project_id=project_id,
                role="assistant",
                source_type="review_result",
                content=f"评审已确认该需求：{payload.note}\n\n已生成半自动与全自动两档需求解决方案，每档各含产品版和技术版，共 4 份。",
            )
        return {
            "feedback": feedback,
            "project": fetch_project(project_id),
            "documentsGenerated": len(documents) if payload.action == "approve" else 0,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.get("/api/projects/{project_id}/review-feedback")
def get_review_feedback(
    project_id: str,
    user: dict = Depends(reviewer_user),
) -> dict:
    project_for_user(project_id, user)
    try:
        return {"items": fetch_review_feedback(project_id)}
    except Exception as exc:
        raise database_unavailable(exc) from exc


@app.get("/api/integrations/llm/status")
def llm_status(_: dict = Depends(reviewer_user)) -> dict:
    _load_runtime_llm_config()
    return _llm_status_payload()


@app.put("/api/integrations/llm/config")
def update_llm_config(
    payload: LlmConfigRequest,
    _: dict = Depends(reviewer_user),
) -> dict:
    _load_runtime_llm_config()
    try:
        existing = fetch_runtime_llm_config()
        if payload.clear_api_key:
            api_key = ""
        elif payload.api_key and payload.api_key.strip():
            api_key = payload.api_key.strip()
        elif existing and existing.get("llm_api_key") is not None:
            api_key = existing["llm_api_key"]
        else:
            api_key = settings.llm_api_key or None
        saved = save_runtime_llm_config(
            provider=payload.provider,
            base_url=payload.base_url,
            model=payload.model,
            quality_model=payload.quality_model,
            api_key=api_key,
            timeout_seconds=payload.timeout_seconds,
            document_timeout_seconds=payload.document_timeout_seconds,
        )
    except Exception as exc:
        raise database_unavailable(exc) from exc
    _apply_runtime_llm_config(saved)
    return _llm_status_payload()


@app.post("/api/integrations/llm/profiles")
def create_llm_profile(
    payload: LlmProfileRequest,
    _: dict = Depends(reviewer_user),
) -> dict:
    try:
        existing = (
            fetch_llm_profile(payload.profile_id, include_secret=True)
            if payload.profile_id
            else None
        )
        if payload.clear_api_key:
            api_key = ""
        elif payload.api_key and payload.api_key.strip():
            api_key = payload.api_key.strip()
        elif existing:
            api_key = existing.get("llm_api_key") or None
        else:
            api_key = None
        profile = save_llm_profile(
            profile_id=payload.profile_id,
            profile_name=payload.profile_name.strip(),
            provider=payload.provider,
            base_url=payload.base_url,
            model=payload.model,
            quality_model=payload.quality_model,
            api_key=api_key,
            timeout_seconds=payload.timeout_seconds,
            document_timeout_seconds=payload.document_timeout_seconds,
            activate=True,
        )
        saved = save_runtime_llm_config(
            provider=profile["llm_provider"],
            base_url=profile["llm_base_url"],
            model=profile["llm_model"],
            quality_model=profile["llm_quality_model"],
            api_key=profile.get("llm_api_key") or None,
            timeout_seconds=float(profile["llm_timeout_seconds"]),
            document_timeout_seconds=float(profile["llm_document_timeout_seconds"]),
        )
    except Exception as exc:
        raise database_unavailable(exc) from exc
    _apply_runtime_llm_config(saved)
    return _llm_status_payload()


@app.post("/api/integrations/llm/profiles/{profile_id}/activate")
def switch_llm_profile(
    profile_id: str,
    _: dict = Depends(reviewer_user),
) -> dict:
    try:
        profile = activate_llm_profile(profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="模型配置档案不存在")
        saved = save_runtime_llm_config(
            provider=profile["llm_provider"],
            base_url=profile["llm_base_url"],
            model=profile["llm_model"],
            quality_model=profile["llm_quality_model"],
            api_key=profile.get("llm_api_key") or None,
            timeout_seconds=float(profile["llm_timeout_seconds"]),
            document_timeout_seconds=float(profile["llm_document_timeout_seconds"]),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise database_unavailable(exc) from exc
    _apply_runtime_llm_config(saved)
    return _llm_status_payload()


@app.post("/api/integrations/llm/test")
async def test_llm_connection(
    payload: LlmTestRequest,
    _: dict = Depends(reviewer_user),
) -> dict:
    try:
        return await test_connection(settings, quality=payload.mode == "quality")
    except LlmClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/integrations/ragflow/status")
def ragflow_status(_: dict = Depends(reviewer_user)) -> dict:
    return {
        "enabled": settings.ragflow_enabled,
        "baseUrl": settings.ragflow_base_url,
        "apiKeyConfigured": bool(settings.ragflow_api_key),
        "timeoutSeconds": settings.ragflow_timeout_seconds,
    }
