from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import database_status, fetch_project_summaries


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI 需求前置分析中台后端骨架。当前阶段只建立企业级架构边界，不替换现有 Node 主流程。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:3210"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "name": settings.app_name,
        "version": settings.app_version,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/ready")
def ready() -> dict:
    db = database_status()
    return {
        "ready": db["ready"],
        "database": db,
        "llmApiKeyConfigured": bool(settings.llm_api_key),
        "ragflowEnabled": settings.ragflow_enabled,
        "ragflowApiKeyConfigured": bool(settings.ragflow_api_key),
    }


@app.get("/api/settings/public")
def public_settings() -> dict:
    return settings.public_snapshot()


@app.get("/api/projects")
def list_projects(limit: int = 50) -> dict:
    try:
        return {"items": fetch_project_summaries(max(1, min(limit, 100)))}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MySQL 未就绪或 schema 未初始化：{exc}") from exc


@app.get("/api/integrations/llm/status")
def llm_status() -> dict:
    return {
        "provider": settings.llm_provider,
        "baseUrl": settings.llm_base_url,
        "model": settings.llm_model,
        "apiKeyConfigured": bool(settings.llm_api_key),
        "runtimeMode": settings.runtime_mode,
    }


@app.get("/api/integrations/ragflow/status")
def ragflow_status() -> dict:
    return {
        "enabled": settings.ragflow_enabled,
        "baseUrl": settings.ragflow_base_url,
        "apiKeyConfigured": bool(settings.ragflow_api_key),
        "timeoutSeconds": settings.ragflow_timeout_seconds,
    }

