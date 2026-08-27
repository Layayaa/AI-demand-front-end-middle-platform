import base64
import hashlib
import hmac
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def encrypt_runtime_secret(value: str, secret_key: str) -> str:
    nonce = secrets.token_bytes(16)
    key = hashlib.sha256(secret_key.encode("utf-8")).digest()
    stream = bytearray()
    counter = 0
    while len(stream) < len(value.encode("utf-8")):
        stream.extend(
            hmac.new(
                key,
                b"runtime-llm-stream" + nonce + counter.to_bytes(4, "big"),
                hashlib.sha256,
            ).digest()
        )
        counter += 1
    plaintext = value.encode("utf-8")
    ciphertext = bytes(item ^ stream[index] for index, item in enumerate(plaintext))
    tag = hmac.new(key, b"runtime-llm-auth" + nonce + ciphertext, hashlib.sha256).digest()
    encode = lambda item: base64.urlsafe_b64encode(item).decode("ascii")
    return f"v1:{encode(nonce)}:{encode(ciphertext)}:{encode(tag)}"


def decrypt_runtime_secret(value: str, secret_key: str) -> str:
    try:
        version, nonce_value, ciphertext_value, tag_value = value.split(":", 3)
        if version != "v1":
            raise ValueError("不支持的运行时密钥版本")
        decode = lambda item: base64.urlsafe_b64decode(item.encode("ascii"))
        nonce = decode(nonce_value)
        ciphertext = decode(ciphertext_value)
        tag = decode(tag_value)
    except (ValueError, TypeError):
        raise ValueError("运行时密钥格式无效") from None

    key = hashlib.sha256(secret_key.encode("utf-8")).digest()
    expected_tag = hmac.new(key, b"runtime-llm-auth" + nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected_tag):
        raise ValueError("运行时密钥校验失败")

    stream = bytearray()
    counter = 0
    while len(stream) < len(ciphertext):
        stream.extend(
            hmac.new(
                key,
                b"runtime-llm-stream" + nonce + counter.to_bytes(4, "big"),
                hashlib.sha256,
            ).digest()
        )
        counter += 1
    plaintext = bytes(item ^ stream[index] for index, item in enumerate(ciphertext))
    return plaintext.decode("utf-8")


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "AI Requirement Hub API"
    app_version: str = "0.1.0"
    api_host: str = "127.0.0.1"
    api_port: int = 8001
    frontend_origin: str = "http://localhost:4173"

    auth_mode: Literal["accounts", "test_switch"] = "accounts"
    auth_secret_key: str = "development-only-change-before-production"
    auth_token_ttl_minutes: int = 480
    reviewer_bootstrap_name: str = "默认评审人"
    reviewer_bootstrap_username: str = "reviewer"
    reviewer_bootstrap_password: str = ""

    llm_provider: str = "deepseek"
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"
    llm_quality_model: str = "deepseek-v4-pro"
    llm_timeout_seconds: float = 30.0
    llm_document_timeout_seconds: float = 90.0
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
    ragflow_dataset_id: str = ""
    ragflow_timeout_seconds: float = 30.0

    knowledge_local_path: str = "../../knowledge"
    knowledge_upload_dir: str = "data/knowledge"
    knowledge_similarity_threshold: float = 0.72
    knowledge_page_size: int = 8
    knowledge_max_context_chars: int = 12000

    upload_dir: str = "data/uploads"
    upload_max_size_mb: int = 30

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
            "auth": {
                "requesterRegistrationEnabled": True,
            },
            "llm": {
                "provider": self.llm_provider,
                "baseUrl": self.llm_base_url,
                "model": self.llm_model,
                "qualityModel": self.llm_quality_model,
                "timeoutSeconds": self.llm_timeout_seconds,
                "documentTimeoutSeconds": self.llm_document_timeout_seconds,
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
                "uploadDir": self.knowledge_upload_dir,
                "similarityThreshold": self.knowledge_similarity_threshold,
                "pageSize": self.knowledge_page_size,
                "maxContextChars": self.knowledge_max_context_chars,
            },
        }

    @property
    def upload_root(self) -> Path:
        path = Path(self.upload_dir)
        if path.is_absolute():
            return path
        return Path(__file__).resolve().parents[1] / path

    @property
    def knowledge_upload_root(self) -> Path:
        path = Path(self.knowledge_upload_dir)
        if path.is_absolute():
            return path
        return Path(__file__).resolve().parents[1] / path


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
