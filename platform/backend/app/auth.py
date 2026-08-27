import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any


class AuthenticationError(RuntimeError):
    """认证失败时返回给 API 层的安全错误。"""


def normalize_username(value: str) -> str:
    return value.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 310_000
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt=salt,
        iterations=iterations,
    )
    return "$".join(
        (
            "pbkdf2_sha256",
            str(iterations),
            _encode(salt),
            _encode(derived),
        )
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_value, salt_value, expected_value = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = _decode(salt_value)
        expected = _decode(expected_value)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt=salt,
            iterations=int(iterations_value),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def create_access_token(user: dict[str, Any], secret_key: str, ttl_minutes: int) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    payload = {
        "sub": user["id"],
        "role": user["role"],
        "exp": int(expires_at.timestamp()),
    }
    encoded_payload = _encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        secret_key.encode("utf-8"),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_encode(signature)}"


def decode_access_token(token: str, secret_key: str) -> dict[str, Any]:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected = hmac.new(
            secret_key.encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_decode(encoded_signature), expected):
            raise AuthenticationError("登录状态无效，请重新登录")
        payload = json.loads(_decode(encoded_payload))
        if not isinstance(payload, dict):
            raise AuthenticationError("登录状态无效，请重新登录")
        if not isinstance(payload.get("sub"), str) or not isinstance(payload.get("role"), str):
            raise AuthenticationError("登录状态无效，请重新登录")
        if int(payload.get("exp", 0)) <= int(datetime.now(timezone.utc).timestamp()):
            raise AuthenticationError("登录已过期，请重新登录")
        return payload
    except AuthenticationError:
        raise
    except (ValueError, TypeError, json.JSONDecodeError):
        raise AuthenticationError("登录状态无效，请重新登录") from None


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "displayName": user["display_name"],
        "username": user["username"],
        "role": user["role"],
    }


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
