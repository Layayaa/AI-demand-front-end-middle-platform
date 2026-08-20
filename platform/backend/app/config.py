from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "AI Requirement Hub API"
    app_version: str = "0.1.0"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    frontend_origin: str = "http://localhost:5173"

    llm_provider: str = "deepseek"
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"
    llm_api_key: str = ""

    embedding_provider: str = "siliconflow"
    embedding_base_url: str = "https://api.siliconflow.cn/v1"
    embedding_model: str = "BAAI/bge-m3"
    embedding_api_key: str = ""

    rerank_provider: str = "siliconflow"
    rerank_base_url: str = "https://api.siliconflow.cn/v1"
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    rerank_api_key: str = ""

    ragflow_enabled: bool = False
    ragflow_base_url: str = "http://127.0.0.1:9380"
    ragflow_api_key: str = ""
    ragflow_timeout_seconds: float = 30.0

    knowledge_local_path: str = "../../knowledge"
    knowledge_similarity_threshold: float = 0.72
    knowledge_page_size: int = 8
    knowledge_max_context_chars: int = 12000

    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "ai_requirement_hub"
    db_user: str = "reqhub_app"
    db_password: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 10

    runtime_mode: Literal["local_api", "intranet_api", "offline"] = "local_api"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def database_url(self) -> str:
        user = quote_plus(self.db_user)
        password = quote_plus(self.db_password)
        auth = f"{user}:{password}" if password else user
        return f"mysql+pymysql://{auth}@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"

    @property
    def database_server_url(self) -> str:
        user = quote_plus(self.db_user)
        password = quote_plus(self.db_password)
        auth = f"{user}:{password}" if password else user
        return f"mysql+pymysql://{auth}@{self.db_host}:{self.db_port}/?charset=utf8mb4"

    def public_snapshot(self) -> dict:
        return {
            "app": {
                "name": self.app_name,
                "version": self.app_version,
                "environment": self.app_env,
                "runtimeMode": self.runtime_mode,
            },
            "llm": {
                "provider": self.llm_provider,
                "baseUrl": self.llm_base_url,
                "model": self.llm_model,
                "apiKeyConfigured": bool(self.llm_api_key),
            },
            "embedding": {
                "provider": self.embedding_provider,
                "baseUrl": self.embedding_base_url,
                "model": self.embedding_model,
                "apiKeyConfigured": bool(self.embedding_api_key),
            },
            "rerank": {
                "provider": self.rerank_provider,
                "baseUrl": self.rerank_base_url,
                "model": self.rerank_model,
                "apiKeyConfigured": bool(self.rerank_api_key),
            },
            "ragflow": {
                "enabled": self.ragflow_enabled,
                "baseUrl": self.ragflow_base_url,
                "apiKeyConfigured": bool(self.ragflow_api_key),
            },
            "database": {
                "host": self.db_host,
                "port": self.db_port,
                "name": self.db_name,
                "user": self.db_user,
            },
            "knowledge": {
                "localPath": self.knowledge_local_path,
                "similarityThreshold": self.knowledge_similarity_threshold,
                "pageSize": self.knowledge_page_size,
                "maxContextChars": self.knowledge_max_context_chars,
            },
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

