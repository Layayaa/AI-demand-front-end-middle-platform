# AI 需求前置中台 Platform

这个目录是未来企业级架构主线，目标是逐步迁移到 Vue + FastAPI + MySQL + RAGFlow。当前根目录的 Node 版本继续作为稳定可运行基线。

## 后端启动

```bash
cd platform/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/ready
curl http://127.0.0.1:8000/api/settings/public
```

## MySQL 初始化

先按 `.env` 配好 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`，然后执行：

```bash
cd platform/backend
python scripts/init_db.py
```

也可以手动执行：

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < sql/001_init_mysql.sql
```

## API Key 规则

- `LLM_API_KEY`、`EMBEDDING_API_KEY`、`RERANK_API_KEY`、`RAGFLOW_API_KEY` 只写入后端 `.env` 或部署 Secret。
- 前端只读取 `/api/settings/public` 返回的 `apiKeyConfigured` 布尔值。
- MySQL 不保存明文 Key。
- `.env` 不提交版本库。

## 当前范围

已建立：

- FastAPI 后端入口；
- 安全配置快照接口；
- MySQL schema 初始化脚本；
- LLM/RAGFlow 配置状态接口；
- 项目列表读取接口。

暂未迁移：

- 当前 Node 版规则引擎；
- 文件上传解析；
- RAGFlow 检索调用；
- Vue 前端页面。

