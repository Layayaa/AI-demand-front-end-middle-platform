import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.auth import hash_password, normalize_username  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import create_user, fetch_user_by_username, run_sql_file  # noqa: E402


if __name__ == "__main__":
    run_sql_file(ROOT / "sql" / "001_init_mysql.sql")
    reviewer_username = normalize_username(settings.reviewer_bootstrap_username)
    if settings.reviewer_bootstrap_password and not fetch_user_by_username(reviewer_username):
        create_user(
            display_name=settings.reviewer_bootstrap_name.strip() or "默认评审人",
            username=reviewer_username,
            password_hash=hash_password(settings.reviewer_bootstrap_password),
            role="reviewer",
        )
        print(f"Bootstrap reviewer created: {reviewer_username}")
    elif not settings.reviewer_bootstrap_password:
        print("Reviewer bootstrap skipped: set REVIEWER_BOOTSTRAP_PASSWORD to create one.")
    print("MySQL schema initialized.")
