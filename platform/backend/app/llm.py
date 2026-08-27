import json
import re
from time import perf_counter
from typing import Any, AsyncIterator, Optional

import httpx

from .config import Settings


class LlmClientError(RuntimeError):
    """用户可理解的 LLM 调用错误，不包含 API Key。"""


def _chat_completions_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _message_content(message: Any) -> str:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return ""


async def chat(
    settings: Settings,
    messages: list[dict[str, str]],
    *,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 1200,
    timeout_seconds: Optional[float] = None,
) -> dict:
    if not settings.llm_api_key:
        raise LlmClientError("LLM_API_KEY 未配置，请先写入 platform/backend/.env")

    selected_model = model or settings.llm_model
    payload = {
        "model": selected_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    started = perf_counter()
    request_timeout = timeout_seconds or settings.llm_timeout_seconds

    try:
        async with httpx.AsyncClient(timeout=request_timeout) as client:
            response = await client.post(
                _chat_completions_url(settings.llm_base_url),
                headers=headers,
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise LlmClientError(f"LLM 请求超时（>{request_timeout:g} 秒）") from exc
    except httpx.HTTPError as exc:
        raise LlmClientError(f"LLM 网络请求失败：{exc}") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            error = body.get("error") if isinstance(body, dict) else None
            if isinstance(error, dict):
                detail = str(error.get("message") or error.get("code") or "")
            elif isinstance(error, str):
                detail = error
        except ValueError:
            detail = response.text[:300]
        suffix = f"：{detail[:300]}" if detail else ""
        raise LlmClientError(f"LLM 返回 HTTP {response.status_code}{suffix}")

    try:
        body = response.json()
    except ValueError as exc:
        raise LlmClientError("LLM 返回了无法解析的 JSON") from exc

    choices = body.get("choices") if isinstance(body, dict) else None
    first_choice = choices[0] if isinstance(choices, list) and choices else {}
    message = first_choice.get("message") if isinstance(first_choice, dict) else {}
    content = _message_content(message)
    if not content:
        raise LlmClientError("LLM 返回成功，但没有可用文本内容")

    return {
        "model": body.get("model") or selected_model,
        "content": content,
        "usage": body.get("usage") if isinstance(body, dict) else None,
        "latencyMs": round((perf_counter() - started) * 1000),
    }


async def chat_stream(
    settings: Settings,
    messages: list[dict[str, str]],
    *,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 1200,
    timeout_seconds: Optional[float] = None,
) -> AsyncIterator[str]:
    """Read OpenAI-compatible SSE deltas from the model gateway."""
    if not settings.llm_api_key:
        raise LlmClientError("LLM_API_KEY 未配置，请先写入 platform/backend/.env")

    selected_model = model or settings.llm_model
    payload = {
        "model": selected_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_timeout = timeout_seconds or settings.llm_timeout_seconds

    try:
        async with httpx.AsyncClient(timeout=request_timeout) as client:
            async with client.stream(
                "POST",
                _chat_completions_url(settings.llm_base_url),
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    detail = ""
                    try:
                        parsed = json.loads(body.decode("utf-8"))
                        error = parsed.get("error") if isinstance(parsed, dict) else None
                        if isinstance(error, dict):
                            detail = str(error.get("message") or error.get("code") or "")
                        elif isinstance(error, str):
                            detail = error
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        detail = body.decode("utf-8", errors="replace")[:300]
                    suffix = f"：{detail[:300]}" if detail else ""
                    raise LlmClientError(f"LLM 返回 HTTP {response.status_code}{suffix}")

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") if isinstance(chunk, dict) else None
                    choice = choices[0] if isinstance(choices, list) and choices else {}
                    delta = choice.get("delta") if isinstance(choice, dict) else {}
                    content = _message_content(delta)
                    if content:
                        yield content
    except LlmClientError:
        raise
    except httpx.TimeoutException as exc:
        raise LlmClientError(f"LLM 流式请求超时（>{request_timeout:g} 秒）") from exc
    except httpx.HTTPError as exc:
        raise LlmClientError(f"LLM 流式网络请求失败：{exc}") from exc


async def test_connection(settings: Settings, *, quality: bool = False) -> dict:
    model = settings.llm_quality_model if quality else settings.llm_model
    result = await chat(
        settings,
        [
            {
                "role": "system",
                "content": "你是连接测试助手。只回复：连接成功",
            },
            {
                "role": "user",
                "content": "请确认当前模型接口可用。",
            },
        ],
        model=model,
        temperature=0,
        max_tokens=256,
    )
    return {
        "ok": True,
        "provider": settings.llm_provider,
        "model": result["model"],
        "reply": result["content"],
        "latencyMs": result["latencyMs"],
        "usage": result["usage"],
    }


async def decide_clarification(
    settings: Settings,
    *,
    project: dict[str, Any],
    profile: dict[str, Any],
    history: list[dict[str, Any]],
    question_catalog: list[dict[str, Any]],
    latest_answer: str = "",
    project_materials: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    if not settings.llm_api_key:
        raise LlmClientError("LLM_API_KEY 未配置，无法启用 AI 主导澄清")

    messages = _clarification_messages(
        project=project,
        profile=profile,
        history=history,
        question_catalog=question_catalog,
        latest_answer=latest_answer,
        project_materials=project_materials or [],
    )
    response = await chat(
        settings,
        messages,
        temperature=0.15,
        max_tokens=900,
    )
    return _parse_clarification_direction(response["content"], question_catalog)


async def assess_requirement(
    settings: Settings,
    *,
    project: dict[str, Any],
    profile: dict[str, Any],
    gaps: list[dict[str, Any]],
    project_materials: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    if not settings.llm_api_key:
        raise LlmClientError("LLM_API_KEY 未配置，无法启用模型价值评估")

    system = """你是广州七邦科技有限公司的经营价值评估顾问。七邦的需求重点围绕电商分销、品牌经营、多渠道销售、采购补货、库存、仓储、订单履约和财务协同。你的任务不是机械计算频率和节省几分钟，而是判断一项需求对经营结果的真实影响。

请优先分析：
1. 是否影响供应链主流程、订单履约或核心渠道连续经营；
2. 是否可能造成断货、库存积压、资金占用、销售损失、毛利下降、平台处罚或客户体验下降；
3. 影响多少渠道、店铺、仓库、SKU、订单或业务人员；
4. 是否存在大促、季节、供应商交期等时间窗口；
5. 是否有人工兜底，以及模型判断的证据是否充分。

规则：
- 业务价值和实施成本必须分开。技术复杂、涉及系统多，不代表业务价值高；需求简单，也可能是高价值。
- 当前画像中的“业务影响/业务价值”可能只是需求人自评或初步描述，不能直接当成模型结论。只有在有具体影响证据时，才提高价值分和置信度；如果只有“高”两个字，应视为自评而不是事实。
- 项目材料和业务确认画像是事实；没有证据的金额、订单量、损失和系统能力只能列为待确认，不能编造。
- 如果明确影响核心供应链并存在断货或积压风险，价值分可以很高；如果还没有范围、损失或风险证据，应降低置信度并列出补证项。
- P0 表示经营连续性或重大损失风险，需要近期处理；P1 表示核心流程的重要改进；P2 表示局部效率优化或价值尚不明确。
- P0 不要求价值分必须机械达到某个固定阈值，但置信度不能为低；证据不足时最多给 P1。

只输出 JSON，不要输出 Markdown：
{
  "valueScore": 0,
  "priority": "P0/P1/P2",
  "businessCriticality": "核心经营主流程/重要业务流程/局部效率事项/待确认",
  "riskLevel": "高/中/低",
  "confidence": "高/中/低",
  "summary": "一句话说明为什么这样判断",
  "rationale": ["最多5条判断依据"],
  "evidenceGaps": ["最多5条需要补充的事实"],
  "dimensions": [
    {"name":"供应连续性","score":0,"evidence":"依据或待确认"},
    {"name":"库存与资金风险","score":0,"evidence":"依据或待确认"},
    {"name":"销售与毛利影响","score":0,"evidence":"依据或待确认"},
    {"name":"影响范围","score":0,"evidence":"依据或待确认"},
    {"name":"紧迫程度","score":0,"evidence":"依据或待确认"},
    {"name":"可复制价值","score":0,"evidence":"依据或待确认"}
  ]
}"""
    user = f"""需求标题：{project.get("title") or "未命名"}
需求摘要：{project.get("summary") or "无"}
所属部门：{project.get("department") or "无"}

当前需求画像：
{json.dumps(profile, ensure_ascii=False)}

当前已识别但可能仍需补证的信息：
{json.dumps(gaps, ensure_ascii=False)}

项目材料（仅作为事实依据；未解析的图片不能用于推断）：
{_project_materials_text(project_materials or [])}"""
    response = await chat(
        settings,
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        model=settings.llm_model,
        temperature=0.2,
        max_tokens=1800,
    )
    return _parse_requirement_assessment(response["content"], response.get("model"))


async def decide_clarification_stream(
    settings: Settings,
    *,
    project: dict[str, Any],
    profile: dict[str, Any],
    history: list[dict[str, Any]],
    question_catalog: list[dict[str, Any]],
    latest_answer: str = "",
    project_materials: Optional[list[dict[str, Any]]] = None,
) -> AsyncIterator[dict[str, Any]]:
    messages = _clarification_messages(
        project=project,
        profile=profile,
        history=history,
        question_catalog=question_catalog,
        latest_answer=latest_answer,
        project_materials=project_materials or [],
    )
    raw = ""
    last_question = ""
    async for delta in chat_stream(
        settings,
        messages,
        temperature=0.15,
        max_tokens=900,
    ):
        raw += delta
        partial_question = _partial_json_string_field(raw, "question")
        if partial_question.startswith(last_question):
            new_text = partial_question[len(last_question):]
            if new_text:
                last_question = partial_question
                yield {"type": "question_delta", "content": new_text}
        elif partial_question:
            last_question = partial_question
            yield {"type": "question_reset", "content": partial_question}
    yield {
        "type": "direction",
        "direction": _parse_clarification_direction(raw, question_catalog),
    }


def _clarification_messages(
    *,
    project: dict[str, Any],
    profile: dict[str, Any],
    history: list[dict[str, Any]],
    question_catalog: list[dict[str, Any]],
    latest_answer: str,
    project_materials: list[dict[str, Any]],
) -> list[dict[str, str]]:
    catalog = "\n".join(
        f'- {item["key"]}（{item["label"]}）：{item["prompt"]}'
        for item in question_catalog
    )
    system = """你是广州七邦科技有限公司的企业需求澄清顾问。你的工作不是把字段填满，而是把业务人员真正想解决的问题、现状、边界和可落地结果聊清楚，直到产品和技术团队可以评审。

请围绕这些关键判断做决定：业务目标与范围是否明确、核心流程或决策规则是否可理解、关键数据与系统是否可得、人工/审批/异常边界是否明确、成功标准是否可验证。字段清单只是内部记录和校验工具，绝不能因为某个字段为空就机械追问。

每一轮只能做一件事：
1. 仍存在会阻塞方案的关键不确定性：只问一个最有价值的问题，并从允许字段中选择对应 questionKey。
2. 已足够形成可信方案，即使仍有非阻塞细节待确认：返回 ready_to_confirm，不要再追问。

重要判断规则：
- ready_to_confirm 之前，至少要明确：需求是“单点决策”还是“SOP 流程”、业务对象、首期范围、当前处理方式或实际系统、自动化/审批边界或成功标准；还要有足以说明核心工作的规则/依据（单点决策）或至少一个流程步骤（SOP）。不满足时必须 continue。
- 需求类型未知时绝不能返回 ready_to_confirm；必须先问清是做判断，还是按步骤执行。
- 不要按问题目录的顺序逐项询问。每轮根据当前对话和最新回答，自由选择最能减少关键不确定性的一个问题；可以跳过目录字段，直接询问目录之外的业务事实、例外、影响或决策依据。
- 不要把标题、部门、历史资料或 AI 常识当成已确认事实。系统名、数据口径、审批阈值、角色和指标都必须来自业务回答或项目材料，并明确区分。
- 不要要求业务人员先给需求贴“高、中、低”标签。优先询问可观察的业务影响；如果用户只回答“高”，把它当成需求人自评，不是价值事实，可以继续追问断货、积压、销售、毛利、客户体验或仅效率影响。
- 用户的最新回答可能回答的是另一个字段，不一定正好回答当前 questionKey。先从回答中提取事实到 facts，再继续问真正缺失的关键问题。
- 如果当前在问业务链路，而用户回答的是“全量商品”“唯品会价格标签”这类业务对象或范围，不要原样重复同一句。把它记录到 businessObject 或 scope，并明确告诉用户现在只需选择业务链路。
- 不要重复已经明确的信息；不要要求用户按“第一步、第二步”逐项报流程；不要向用户解释单点决策、SOP 或字段清单。问题要结合广州七邦科技的业务语境自然表达。
question 只能包含一个需要业务回答的问句。不要使用“另外、同时、以及”追加第二个问题，不要出现两个“？”。
facts 只提取本轮回答中明确说出的事实，不要把模型推测写入画像；可以一次提取多个不同字段。

仅输出 JSON，不能输出 Markdown：
{"status":"continue 或 ready_to_confirm","requirementType":"decision、sop 或 unknown","questionKey":"允许字段 key 或 other；ready_to_confirm 时为 null","question":"continue 时向业务提出的单一问题；ready_to_confirm 时为空字符串","chips":["最多 5 个可选回答"],"facts":{"字段 key 或 other":"本轮明确事实"},"criticalGaps":[{"key":"字段 key 或 other","label":"简短名称","reason":"为什么它会阻塞方案"}]}
criticalGaps 只列当前真正阻塞的 1-3 项；ready_to_confirm 时可为空。"""
    user = f"""需求标题：{project.get("title") or "未命名"}
需求摘要：{project.get("summary") or "无"}
所属部门：{project.get("department") or "无"}

当前结构化画像：
{json.dumps(profile, ensure_ascii=False)}

允许绑定的问题字段：
{catalog}

最近对话：
{_history_text(history)}

本轮业务最新回答：
{latest_answer or "（这是首轮判断，没有最新回答）"}

当前需求已上传材料（这些是当前项目事实依据；不能把材料中的建议直接当成已确认事实）：
{_project_materials_text(project_materials)}"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _history_text(history: list[dict[str, Any]]) -> str:
    turns = history[-16:]
    if not turns:
        return "（尚未开始对话）"
    return "\n".join(
        f'{"业务人员" if item.get("role") == "user" else "AI"}：{str(item.get("content") or "")}'
        for item in turns
    )


def _project_materials_text(source_files: list[dict[str, Any]]) -> str:
    if not source_files:
        return "（尚未上传项目材料）"
    blocks: list[str] = []
    remaining = 12000
    for item in source_files:
        name = str(item.get("original_filename") or "未命名材料")
        status = str(item.get("parse_status") or "unknown")
        text = str(item.get("extracted_text") or "").strip()
        if text:
            excerpt = text[: min(3000, remaining)]
            blocks.append(f"- {name}（{status}）\n{excerpt}")
            remaining -= len(excerpt)
        else:
            message = "图片或文件尚未提取出文字，不能据此推断具体事实。"
            blocks.append(f"- {name}（{status}）：{message}")
        if remaining <= 0:
            break
    return "\n\n".join(blocks)


def _partial_json_string_field(content: str, key: str) -> str:
    marker = f'"{key}"'
    marker_index = content.find(marker)
    if marker_index < 0:
        return ""
    colon_index = content.find(":", marker_index + len(marker))
    if colon_index < 0:
        return ""
    quote_index = content.find('"', colon_index + 1)
    if quote_index < 0:
        return ""

    raw_chars: list[str] = []
    escaped = False
    for char in content[quote_index + 1:]:
        if escaped:
            raw_chars.append(f"\\{char}")
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            break
        else:
            raw_chars.append(char)
    raw = "".join(raw_chars)
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return (
            raw.replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )


def _parse_clarification_direction(
    content: str,
    question_catalog: list[dict[str, Any]],
) -> dict[str, Any]:
    raw = content.strip().replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not match:
        raise LlmClientError("LLM 澄清决策格式无效")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise LlmClientError("LLM 澄清决策不是有效 JSON") from exc

    status = data.get("status")
    if status not in {"continue", "ready_to_confirm"}:
        raise LlmClientError("LLM 未给出有效澄清结论")
    allowed_keys = {item["key"] for item in question_catalog}
    question_key = data.get("questionKey")
    if status == "continue" and question_key not in allowed_keys:
        raise LlmClientError("LLM 选择了不支持的澄清字段")

    requirement_type = data.get("requirementType")
    facts = data.get("facts")
    normalized_facts = {
        str(key): str(value).strip()
        for key, value in facts.items()
        if str(key) in allowed_keys and isinstance(value, (str, int, float)) and str(value).strip()
    } if isinstance(facts, dict) else {}
    return {
        "status": status,
        "requirementType": requirement_type if requirement_type in {"decision", "sop", "unknown"} else "unknown",
        "questionKey": question_key if status == "continue" else None,
        "question": _single_question(str(data.get("question") or "").strip()),
        "chips": [item for item in data.get("chips", []) if isinstance(item, str) and item.strip()][:5],
        "facts": normalized_facts,
        "criticalGaps": [
            {
                "key": str(item.get("key") or "other"),
                "label": str(item.get("label") or "待确认项"),
                "reason": str(item.get("reason") or "该信息会影响方案判断。"),
            }
            for item in data.get("criticalGaps", [])
            if isinstance(item, dict)
        ][:3],
    }


def _parse_requirement_assessment(content: str, model: Optional[str] = None) -> dict[str, Any]:
    raw = content.strip().replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not match:
        raise LlmClientError("LLM 价值评估格式无效")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise LlmClientError("LLM 价值评估不是有效 JSON") from exc

    score = data.get("valueScore")
    priority = data.get("priority")
    risk_level = data.get("riskLevel")
    confidence = data.get("confidence")
    if not isinstance(score, (int, float)) or priority not in {"P0", "P1", "P2"}:
        raise LlmClientError("LLM 未给出有效价值评分或优先级")
    if risk_level not in {"高", "中", "低"} or confidence not in {"高", "中", "低"}:
        raise LlmClientError("LLM 未给出有效风险或置信度")

    dimensions = []
    for item in data.get("dimensions", []):
        if not isinstance(item, dict):
            continue
        item_score = item.get("score")
        if not isinstance(item_score, (int, float)):
            continue
        dimensions.append(
            {
                "name": str(item.get("name") or "业务影响").strip(),
                "score": max(0, min(100, round(item_score))),
                "evidence": str(item.get("evidence") or "模型未提供具体依据。").strip(),
            }
        )

    return {
        "value_score": max(0, min(100, round(score))),
        "priority": priority,
        "business_criticality": str(data.get("businessCriticality") or "待确认").strip(),
        "risk_level": risk_level,
        "confidence": confidence,
        "summary": str(data.get("summary") or "").strip(),
        "rationale": [
            str(item).strip()
            for item in data.get("rationale", [])
            if isinstance(item, str) and item.strip()
        ][:5],
        "evidence_gaps": [
            str(item).strip()
            for item in data.get("evidenceGaps", [])
            if isinstance(item, str) and item.strip()
        ][:5],
        "dimensions": dimensions[:8],
        "model": model,
    }


def _single_question(value: str) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        return ""
    question_end = text.find("？")
    if question_end >= 0:
        return text[:question_end + 1]
    question_end = text.find("?")
    if question_end >= 0:
        return text[:question_end + 1]
    for marker in ("另外", "同时", "以及"):
        index = text.find(marker)
        if index > 0:
            return text[:index].rstrip("，；;。 ") + "？"
    return text


async def generate_document(
    settings: Settings,
    *,
    project: dict[str, Any],
    profile: dict[str, Any],
    document: dict[str, Any],
    references: list[dict[str, Any]],
) -> dict[str, str]:
    draft = str(document.get("markdown_content") or "").strip()
    if not draft:
        raise LlmClientError("文档草稿为空，无法交给模型润色")

    reference_text = "\n".join(
        f'- {item.get("source") or "参考资料"}：{item.get("excerpt") or ""}'
        for item in references
        if isinstance(item, dict)
    )
    system = """你是资深企业产品与技术方案顾问，负责把一份需求方案草稿整理成可直接评审的中文 Markdown 文档。

硬性规则：
1. 需求画像和项目材料是事实来源；不得虚构接口、系统、指标、角色、阈值或已完成的能力。
2. 草稿中写“待确认”的内容必须保留，不要用常识补齐。
3. 保留文档的定位、章节层级和产品版/技术版边界；可以优化标题、段落、表格和表达。
4. 方案建议必须明确区分“已确认事实”“AI 建议”“待评审确认”，避免把建议写成现状。
5. 这是需求前置中台的方向性方案，不是最终 PRD；删除背景铺垫、价值宣言、重复画像和泛化总结。
6. 产品版只描述产品形态、业务使用方式、人机分工和产品侧待定取舍；技术版只描述数据接入、自动化方式、规则/流程承载、执行方式和技术侧待定选型。
7. 不要输出详细功能清单、验收标准、接口契约、数据字典、实施任务、技术栈或完整架构设计；这些由评审人后续完成。
8. 方案应让评审人 1 分钟内看懂“建议怎么选、为什么、哪里还需要自己补齐”；不要把内容写成字段清单或填空题。
9. 如果是“需求解释方案”，最多保留：需求目标、当前做法、目标状态、评审要点、待确认项；不要补充完整画像、长篇背景或详细方案。
10. 输出纯 Markdown，不要包裹代码围栏，不要附加解释。"""
    user = f"""项目标题：{project.get("title") or "未命名"}
项目摘要：{project.get("summary") or "无"}
需求画像：
{json.dumps(profile, ensure_ascii=False)}

可引用材料（仅能作为依据，不能替代需求画像）：
{reference_text or "无"}

待整理文档草稿：
{draft}"""
    result = await chat(
        settings,
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        model=settings.llm_quality_model or settings.llm_model,
        temperature=0.25,
        max_tokens=2800,
        timeout_seconds=settings.llm_document_timeout_seconds,
    )
    content = result["content"].strip()
    content = re.sub(r"^```(?:markdown|md)?\s*", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\s*```$", "", content).strip()
    if len(content) < 120:
        raise LlmClientError("LLM 返回的文档内容过短")
    return {
        "markdown_content": content,
        "model_name": result["model"],
        "prompt_version": "plans-llm-v2",
    }
