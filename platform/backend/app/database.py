from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from .config import settings


_engine: Optional[Engine] = None


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


def fetch_project_summaries(limit: int = 50) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, title, status, current_stage, priority, value_score,
                       project_size, risk_level, effort_min_pm, effort_max_pm,
                       updated_at
                FROM projects
                ORDER BY updated_at DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings()
        return [dict(row) for row in rows]
