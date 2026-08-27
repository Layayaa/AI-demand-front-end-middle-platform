# Cursor 交接文档

## 1. 项目一句话

这是一个 **AI 需求前置分析中台**，不是库存自动化系统，也不是 ERP 执行器。

核心流程是：

`需求/材料上传 -> 文档解析 -> 需求画像 -> AI 澄清 -> 价值/规模/风险评估 -> 产品版/技术版方案 -> 评审、版本、导出`

## 2. 当前状态

项目现在有两条线：

1. 根目录 `Node + 原生前端`：当前稳定可运行基线。
2. `platform/`：正在迁移的企业级主线，目标是 `Vue + FastAPI + MySQL + RAGFlow`。

当前结论：

- 旧 Node 版先保留，不要删，不要大改。
- 新 `platform/` 继续往企业级方向走。
- API Key 只放后端 `.env` / Secret，不进前端。
- 模型默认用 `deepseek-v4-flash`，全自动复杂方案或特别复杂需求再用 `deepseek-v4-pro` 兜底。
- 完全离线不是当前首要目标，先做“本地部署 + 云端 AI API”。
- 库存、上下架、ERP 只作为样例需求，不是平台本职。

## 3. 已完成

### 根目录基线

- `server.js` 可直接启动旧版平台。
- `public/` 下有原生前端页面。
- `lib/engine/` 已有：
  - `extract.js`
  - `interview.js`
  - `hybrid.js`
  - `plans.js`
  - `value.js`
  - `llm.js`

### 企业级主线骨架

- `platform/README.md`
- `platform/frontend/`
- `platform/backend/app/main.py`
- `platform/backend/app/config.py`
- `platform/backend/app/database.py`
- `platform/backend/sql/001_init_mysql.sql`
- `platform/backend/scripts/init_db.py`
- `platform/backend/.env.example`

### 已有接口

- `GET /api/health`
- `GET /api/ready`
- `GET /api/settings/public`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{id}`
- `GET /api/projects/{id}/files`
- `POST /api/projects/{id}/files`
- `GET /api/integrations/llm/status`
- `POST /api/integrations/llm/test`
- `GET /api/integrations/ragflow/status`

### 数据库结构

MySQL 初始化表已经预留了：

- `projects`
- `source_files`
- `requirement_profiles`
- `conversation_turns`
- `requirement_gaps`
- `project_assessments`
- `generated_documents`
- `knowledge_connectors`
- `audit_logs`

## 4. 这个项目真正要做什么

平台重点不是“把一个需求直接做完”，而是：

1. 接住业务材料。
2. 把需求聊清楚。
3. 形成结构化需求画像。
4. 自动识别缺口和风险。
5. 生成可评审的产品版和技术版方案。
6. 给出价值优先级和项目级评估。

## 4.1 模型选型

首选模型：`deepseek-v4-flash`

- 成本低，适合全站默认使用。
- 中文业务文档、需求澄清、画像提取、结构化输出够用。
- OpenAI 兼容接口，后端可沿用统一 LLM 适配器。

质量兜底：`deepseek-v4-pro`

- 用在全自动复杂方案生成、特别复杂需求、多系统集成分析。
- 不建议全站默认使用，避免成本失控。

配置边界：

- `LLM_MODEL=deepseek-v4-flash`
- `LLM_QUALITY_MODEL=deepseek-v4-pro`
- `LLM_API_KEY` 只放 `platform/backend/.env` 或部署 Secret。
- 前端只展示是否已配置 Key，不保存、不回显密钥。

官方参考：

- DeepSeek 模型信息：https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek OpenAI 兼容接口说明：https://api-docs.deepseek.com/

## 5. 不要做偏的方向

以下方向不要继续发散：

- 不要把平台做成库存管理系统。
- 不要把 RAGFlow 做成主流程单点依赖。
- 不要把前端密钥直连 AI 服务。
- 不要为了“未来可能用到”去做一堆没落地的抽象。

## 6. 最值得参考的开源项目

目前没有看到一个和本项目完全一样的“AI 需求前置分析中台”，但下面这些项目值得参考局部做法。

### 6.1 NatPRD

地址：https://github.com/anatasof/NatPRD

值得参考：

- 一次一问式访谈。
- 不知道就标 `[TBD]`，不编造事实。
- 把缺口、来源、确认状态写进 PRD。

我们可吸收：

- AI 澄清时不要一次问一堆问题。
- 需求画像里保留“待确认字段”。
- 生成方案时明确标注未确认信息。

不要照搬：

- 它偏 PRD 助手，我们要做的是中台，有项目、文件、评审、版本、知识库和评估。

### 6.2 SpecForge

地址：https://github.com/dennisrongo/spec-forge

值得参考：

- 项目工作台。
- AI 引导式问答。
- 输出 PRD、技术规格、文件结构。
- 有 AI Provider 设置和生成进度。

我们可吸收：

- Vue 工作台可以参考它的“项目 -> 澄清 -> 生成 -> 查看结果”的页面节奏。
- 产品版/技术版方案的预览、编辑、导出体验可以参考。

不要照搬：

- 它更偏“把产品想法变成开发规格”，我们还要处理企业内部材料、RAGFlow、业务价值优先级和评审流。

### 6.3 AI-Requirement-Engineering-System

地址：https://github.com/Harika-Satti/AI-Requirement-Engineering-System

值得参考：

- `FastAPI + RAG + 文档生成` 的后端方向。
- 需求分析、歧义检测、用户故事、用例、SRS、PDF/DOCX 导出这条产物链。
- 多 Agent / LangGraph 的拆分思路。

我们可吸收：

- 后端可以把“解析、澄清、评估、生成文档”拆成清晰服务模块。
- 文件解析后的需求分析产物可以参考它的 SRS/用例结构。

不要照搬：

- 当前阶段不要上复杂多 Agent 编排；先迁移现有规则引擎和稳定 API。

### 6.4 requirements-engineering-skill

地址：https://github.com/SwiftyJourney/requirements-engineering-skill

值得参考：

- 把模糊需求转成 BDD、用例、模型字段、接口契约、流程图、依赖图。
- 强调先澄清，再规格化。
- 适合 Cursor / Claude Code / Windsurf 等 AI 编码工具。

我们可吸收：

- 技术版方案里增加“接口契约、数据模型、验收条件、异常路径”。
- 澄清问题可以围绕 Who / What / Where / When / Why / How 建立问题库。

不要照搬：

- 它是 Agent Skill，不是完整平台；不要拿它替代我们的 Web 中台架构。

### 6.5 SpecDD

地址：https://github.com/specdd/specdd

值得参考：

- 用小型本地规格文件约束 AI agent 和开发人员。
- 明确写出 `Must`、`Must not`、边界、验收标准。
- 很适合防止 Cursor 后续把项目做偏。

我们可吸收：

- 后续可以给关键模块补轻量规格文件，例如：
  - `需求澄清模块必须只做分析，不执行库存操作`
  - `API Key 必须只存在后端环境变量`
  - `RAGFlow 不可用时主流程必须降级`

不要照搬：

- 当前先不用引入完整 SpecDD 工具链；可以先吸收它的“边界和验收写清楚”的方法。

### 6.6 srs-generator

地址：https://github.com/cbwinslow/srs-generator

值得参考：

- 交互式 SRS 生成。
- Docker 启动。
- REST API。
- GitHub / Linear 模板同步。
- 实时文档预览。

我们可吸收：

- 后期可以增加需求模板、评审模板、导出模板。
- 方案生成页可以做实时预览和下载。

不要照搬：

- 它偏 SRS 文档生成器，我们的平台还需要需求画像、价值评估、知识库引用和版本治理。

## 7. 下一步最建议做什么

建议下一步按这个顺序继续：

1. 固化“需求解释方案 + 半自动/全自动两档解决方案”的产品版与技术版，共 4 份解决方案，保存版本并支持 DOCX 导出。
2. 把项目材料解析文本接入初始需求画像，保留文件名和页码/段落来源。
3. 接 RAGFlow 检索和本地文本兜底，在方案中显式标记知识库引用与 AI 假设。
4. 持续优化一次一问澄清逻辑，优先追问高影响缺口。

LLM 接入当前已经完成第一步：后端会从 `platform/backend/.env` 读取 `LLM_API_KEY`，设置页可以测试默认模型和高质量模型。不要在聊天、前端 `.env` 或数据库里保存密钥。

当前本地测试环境使用 `AUTH_MODE=test_switch`：前端可直接在需求人和评审人之间切换，不需要账号密码。此模式只能用于非生产环境；真实测试或上线时改回 `AUTH_MODE=accounts`。

## 8. 本地运行

### 旧版 Node 基线

```bash
cd /Users/laya/Desktop/需求前置分析网站
node server.js
```

浏览器打开：

`http://localhost:3210`

### 新版后端骨架

```bash
cd /Users/laya/Desktop/需求前置分析网站/platform/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

### 新版前端工作台

```bash
cd /Users/laya/Desktop/需求前置分析网站/platform/frontend
cp .env.example .env
npm install
npm run dev
```

浏览器打开：

`http://127.0.0.1:4173`

### MySQL 初始化

```bash
cd /Users/laya/Desktop/需求前置分析网站/platform/backend
python scripts/init_db.py
```

## 9. Cursor 接手时的注意点

- 先读 `README.md` 和 `docs/AI需求前置中台_架构迁移路线_V1.3.md`。
- 再读本节的参考项目，但只吸收局部做法，不要照搬架构。
- 优先沿用现有命名和数据结构。
- 修改尽量小步，不要重写整个项目。
- 如果要做大改，先确认是不是会破坏旧 Node 基线。

## 10. 这次交接的核心结论

这个项目的方向已经定了：

- 当前阶段：本地部署 + 云端 AI API。
- 中期方向：Vue + FastAPI + MySQL + RAGFlow。
- 长期再考虑完全离线。

所以 Cursor 接手后，最该做的是沿着“文件上传解析 -> 需求画像 -> AI 澄清 -> 方案生成”的中台链路继续补完整，而不是把项目拽成别的业务系统。
