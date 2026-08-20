import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import run_sql_file  # noqa: E402


if __name__ == "__main__":
    run_sql_file(ROOT / "sql" / "001_init_mysql.sql")
    print("MySQL schema initialized.")
