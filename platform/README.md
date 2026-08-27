# AI 需求前置中台 Platform

这个目录是企业级架构主线，采用 Vue + FastAPI + MySQL；RAGFlow 暂缓到下一版，第一版由评审人上传本地知识资料作为方案参考。当前根目录的 Node 版本继续作为稳定可运行基线。

本阶段已跑通企业级前置澄清闭环：需求人注册登录、自己的项目隔离、一次一问澄清、需求画像版本、内部规则评估、评审退回补充和状态流转。不要用它替换旧版 Node 主流程。

## 前端启动

### 推荐：一键后台启动

在项目根目录执行：

```bash
./start-dev.sh
```

它会在后台启动前端和后端，并把进程号与日志保存到 `.runtime/`。常用命令：

```bash
./start-dev.sh status
./start-dev.sh restart
./start-dev.sh stop
```

### 手动启动

```bash
cd platform/frontend
cp .env.example .env
npm install
npm run dev
```

浏览器打开：

`http://127.0.0.1:4173`

开发时 Vite 会把 `/api` 代理到 FastAPI `http://127.0.0.1:8001`。`VITE_API_BASE_URL` 留空即可。

同一网络内临时给领导体验时，将 `127.0.0.1` 换成这台电脑的局域网 IP，例如：

`http://172.17.13.6:4173`

电脑需要保持运行，领导和电脑连接同一个 Wi-Fi/办公网络。当前测试模式不需要账号密码，但只适合内部演示；正式使用前应切回 `AUTH_MODE=accounts`。

注意：`localhost` 和 `127.0.0.1` 只代表访问者自己的电脑，不能发给同事。若局域网地址变化，需要重新获取本机 IP；macOS 防火墙也需要允许终端或 Python 接收局域网连接。

不要在前端 `.env` 中放置任何 LLM / RAGFlow API Key。设置页只展示 `apiKeyConfigured` 布尔值。

## 后端启动

```bash
cd platform/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

首次接入 DeepSeek 时，只编辑后端 `.env`：

```dotenv
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
LLM_QUALITY_MODEL=deepseek-v4-pro
LLM_API_KEY=你的 DeepSeek API Key
```

不要把密钥写进前端 `.env`，也不要提交 Git。修改后端 `.env` 后需要重启 FastAPI；通过设置页保存的 LLM 配置会在服务启动时自动加载。

## 账号与角色

- 需求人可在登录页自行注册；只能看到并处理自己的需求，不会看到内部价值分、工作量、模型、知识库或系统配置。
- 评审人不开放注册。请在后端 `.env` 设置 `REVIEWER_BOOTSTRAP_PASSWORD`，然后执行 `python scripts/init_db.py` 创建 `REVIEWER_BOOTSTRAP_USERNAME` 对应账号。
- 评审人可查看全部需求、内部评估和材料，并可“退回补充信息”或“确认完成”。退回意见会自动写入需求人的 AI 对话。

需求人主流程为：新建需求 -> AI 一次一问澄清 -> 确认需求画像 -> 等待评审。上传材料为可选补充，不阻塞澄清入口。

### 本地测试角色切换

当前本地 `.env` 可设置 `AUTH_MODE=test_switch`，前端侧栏会直接显示“需求人 / 评审人”切换，不需要账号密码。后端只在 `APP_ENV` 不为 `production` 时接受 `X-Test-Role` 测试身份，并分别使用 `test-requester` 与 `test-reviewer` 两个固定账号维持项目隔离。

上线或开始真实账号测试前，将 `AUTH_MODE` 改回 `accounts`，再配置 `REVIEWER_BOOTSTRAP_PASSWORD` 并执行初始化脚本。

健康检查：

```bash
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:8001/api/ready
curl http://127.0.0.1:8001/api/settings/public
```

LLM 连接测试：

```bash
curl -X POST http://127.0.0.1:8001/api/integrations/llm/test \
  -H 'Content-Type: application/json' \
  -d '{"mode":"default"}'
```

`mode` 可选 `default` 或 `quality`。前者测试 `deepseek-v4-flash`，后者测试 `deepseek-v4-pro`。设置页也提供同样的两个测试按钮。

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

工作台的项目列表来自 `GET /api/projects`，需求人会按账号归属过滤。新建需求会调用 `POST /api/projects` 创建中台项目，AI 澄清每轮会写入 `conversation_turns` 并保存新的 `requirement_profiles` 版本；确认画像后会写入仅评审人可读的 `project_assessments`，并生成需求人可见的需求解释方案。评审人确认需求后，平台再生成半自动/全自动各自的产品版与技术版，共四份解决方案，版本保存在 `generated_documents`。详情页支持上传 Word、PDF、Excel、CSV、TXT、MD 和常见图片；可解析的文件会保存文本，图片先保存原文件并标记为待视觉识别。评审人可在设置页上传七邦知识资料，下一次方案生成时作为参考依据。

## 旧版 Node 基线

根目录旧版保持可运行，不要删除或大改：

```bash
cd /Users/laya/Desktop/需求前置分析网站
node server.js
```

浏览器打开 `http://localhost:3210`。

## API Key 规则

- `LLM_API_KEY`、`EMBEDDING_API_KEY`、`RERANK_API_KEY`、`RAGFLOW_API_KEY` 只写入后端 `.env` 或部署 Secret。
- 默认 LLM 选型：`deepseek-v4-flash`；全自动方案或特别复杂需求预留 `deepseek-v4-pro`，不要全站默认使用高价模型。
- `LLM_BASE_URL` 默认使用 DeepSeek OpenAI 兼容接口。
- 设置首页只显示当前生效模型和已保存模型档案，可直接切换；「高级设置」中可以从常用厂商预置或自定义 OpenAI 兼容接口新增/编辑模型档案。每个档案的 API Key 独立加密保存，切换档案不需要重新输入密钥。
- 前端只读取 `/api/settings/public` 返回的 `apiKeyConfigured` 布尔值。
- API Key 不回显到前端，并以加密形式保存到 MySQL。
- `.env` 不提交版本库。

官方参考：

- DeepSeek Models & Pricing：https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek OpenAI-compatible API：https://api-docs.deepseek.com/

## 当前范围

已建立：

- Vue 3 + TypeScript + Vite 的需求人端和评审人端；
- FastAPI 鉴权、账号角色、项目归属隔离；
- 需求人一次一问澄清、画像版本、显式缺口和规则评估；
- 评审退回补充信息、确认完成和状态流转；
- 项目材料上传、DOCX/PDF/TXT/MD 文本解析和材料列表接口；
- 上传材料自动补全初始需求画像，并保存文件名、PDF 页码、Word 段落或 Excel 工作表来源；
- 需求解释方案，以及评审确认后生成的半自动/全自动产品版、技术版方案；
- 需求解释方案和四份解决方案均支持 DOCX 导出；
- RAGFlow 检索已接入方案生成，本地知识检索始终保留并在远端失败时降级；
- MySQL schema 初始化脚本，以及仅评审人可读取的 LLM/RAGFlow 配置状态。

下一阶段再做：

- RAGFlow 文档入库、向量化管理和引用快照治理；
- 图片 OCR / 视觉识别，以及表格单元格级来源定位；
- 章节锁定和局部重新生成。
