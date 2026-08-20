/* 设置：AI 引擎 / 大模型 / 数据管理 */
(function (global) {
  let settings = null;

  async function render() {
    settings = await API.getSettings();
    const kb = settings.knowledge || {};
    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="page-head"><div><h1>设置</h1><div class="sub">AI 能力来源、模型配置与数据管理</div></div></div>

      <div class="card card-pad mb16">
        <div class="card-title">AI 能力来源</div>
        <div class="card-sub">推荐使用「大模型API」——对话最接近真实顾问，AI 自主追问并做交付前自检；未配置 Key 或调用失败时自动回退「内置引擎」保底。</div>
        <div class="mode-cards">
          <div class="mode-card" data-mode="llm">
            <div class="name">🌐 大模型 API <span class="chip chip-type">推荐体验 · 顾问式对话</span></div>
            <div class="desc">接入 OpenAI 兼容接口（DeepSeek / OpenAI / 通义 / Kimi 等）：业务自由描述，AI 自主判断还缺什么、追问关键点、交付前自检缺口；文档由大模型生成更专业。失败自动回退内置引擎。</div>
          </div>
          <div class="mode-card" data-mode="builtin">
            <div class="name">🤖 内置 AI 引擎 <span class="chip chip-submitted">保底 · 离线可用</span></div>
            <div class="desc">规则引擎兜底模式：结构化提问、自动提取画像、模板生成方案。无需 API Key、完全离线，作为未配置大模型或调用失败时的保障。</div>
          </div>
        </div>
        <div id="llmForm" style="display:none" class="mt16">
          <div class="field-label">接口地址 (Base URL)</div>
          <input type="text" id="llm-base" placeholder="https://api.deepseek.com" value="${UI.esc(settings.llm.baseUrl)}">
          <div class="field-label">API Key</div>
          <input type="password" id="llm-key" placeholder="sk-..." value="${UI.esc(settings.llm.apiKey)}">
          <div class="field-label">模型名称</div>
          <input type="text" id="llm-model" placeholder="deepseek-chat / gpt-4o / qwen-plus / moonshot-v1-8k" value="${UI.esc(settings.llm.model)}">
          <div class="flex mt12">
            <button class="btn" id="testLlm">🔌 测试连接</button>
            <button class="btn btn-primary" id="saveLlm">保存配置</button>
            <span class="text-xs muted" id="llmTestResult"></span>
          </div>
        </div>
      </div>

      <div class="card card-pad mb16">
        <div class="card-title">知识库挂载</div>
        <div class="card-sub">默认关闭。启用后，AI 澄清、自检和方案生成可引用挂载资料；检索失败不会阻断主流程。</div>
        <div class="form-row">
          <label><input type="checkbox" id="kb-enabled" ${kb.enabled ? 'checked' : ''}> 启用知识库上下文</label>
        </div>
        <div class="form-row">
          <label>知识库 Provider</label>
          <select id="kb-provider">
            <option value="local" ${kb.provider === 'local' ? 'selected' : ''}>本地目录（零依赖）</option>
            <option value="ragflow" ${kb.provider === 'ragflow' ? 'selected' : ''}>RAGFlow</option>
            <option value="http" ${kb.provider === 'http' ? 'selected' : ''}>通用 HTTP 检索服务</option>
          </select>
        </div>
        <div id="kb-local-fields">
          <div class="form-row"><label>本地挂载目录</label><input type="text" id="kb-mount" placeholder="/绝对路径/knowledge" value="${UI.esc(kb.mountPath || '')}"></div>
        </div>
        <div id="kb-remote-fields">
          <div class="form-row"><label>服务地址</label><input type="text" id="kb-base" placeholder="http://127.0.0.1:9380" value="${UI.esc(kb.baseUrl || '')}"></div>
          <div class="form-row"><label>通用检索地址（HTTP Provider 可填）</label><input type="text" id="kb-search-url" placeholder="https://example.com/retrieve" value="${UI.esc(kb.searchUrl || '')}"></div>
          <div class="form-row"><label>知识库 / Dataset ID</label><input type="text" id="kb-dataset" value="${UI.esc(kb.datasetId || '')}"></div>
          <div class="form-row"><label>知识库 API Key</label><input type="password" id="kb-key" placeholder="可选" value="${UI.esc(kb.apiKey || '')}"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-row"><label>最多返回片段数</label><input type="text" id="kb-topk" value="${UI.esc(kb.topK || 5)}"></div>
          <div class="form-row"><label>注入上下文最大字符数</label><input type="text" id="kb-maxchars" value="${UI.esc(kb.maxChars || 6000)}"></div>
        </div>
        <div class="flex mt12">
          <button class="btn" id="testKnowledge">🔎 检查知识库</button>
          <button class="btn btn-primary" id="saveKnowledge">保存知识库配置</button>
          <span class="text-xs muted" id="kbTestResult"></span>
        </div>
      </div>

      <div class="card card-pad mb16">
        <div class="card-title">数据管理</div>
        <div class="card-sub">示例数据展示完整流程效果，可随时清空或恢复。</div>
        <div class="flex">
          <button class="btn btn-primary" id="seedData">恢复示例数据</button>
          <button class="btn btn-danger-soft" id="resetData">清空全部数据</button>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-title">平台说明</div>
        <div class="card-sub">需求前置分析方法论</div>
        <div class="text-sm" style="color:var(--ink-2);line-height:2">
          🧭 <b>前置澄清</b>：AI 先判断需求是「单点决策」还是「SOP流程」，按《表1-单点决策拆解表》《表2-SOP流程拆解表》框架逐步提问，把模糊需求聊成结构化画像。<br>
          📄 <b>三档方案</b>：初级（快速判断）→ 中级（可评审）→ 高级（完整立项），每档输出 <b>产品版 + 技术版</b> 两份文档，共 6 份。<br>
          📚 <b>知识库挂载</b>：可挂载本地目录、RAGFlow 或通用检索服务，作为 AI 的可选背景上下文。<br>
          🎯 <b>价值优先级</b>：按 价值/频率/耗时/影响/自动化潜力/人数 六维打分，输出 P0/P1/P2 排序与建议。<br>
          🕐 <b>进度反馈</b>：提交 → 澄清 → 画像 → 方案 → 评审 → 完成，全程留痕可追溯。
        </div>
      </div>`;

    document.querySelectorAll('.mode-card').forEach(c => {
      c.addEventListener('click', () => selectMode(c.getAttribute('data-mode')));
    });
    document.getElementById('testLlm').addEventListener('click', testLlm);
    document.getElementById('saveLlm').addEventListener('click', saveLlm);
    document.getElementById('kb-provider').addEventListener('change', updateKnowledgeVisibility);
    document.getElementById('testKnowledge').addEventListener('click', testKnowledge);
    document.getElementById('saveKnowledge').addEventListener('click', saveKnowledge);
    document.getElementById('seedData').addEventListener('click', async () => {
      if (!await UI.confirmModal('恢复示例数据？', '将清空当前数据并载入两条完整示例需求（滞销SKU处置判断 / 商品优化建议SOP）。', '恢复')) return;
      await API.seedData(); UI.toast('示例数据已恢复', 'ok'); location.hash = '#/dashboard';
    });
    document.getElementById('resetData').addEventListener('click', async () => {
      if (!await UI.confirmModal('清空全部数据？', '所有需求、画像、方案将被删除，此操作不可恢复。', '清空', true)) return;
      await API.resetData(); UI.toast('数据已清空', 'ok'); location.hash = '#/dashboard';
    });
    selectMode(settings.aiMode);
    updateKnowledgeVisibility();
    updateBadge();
  }

  function selectMode(mode) {
    document.querySelectorAll('.mode-card').forEach(c => c.classList.toggle('active', c.getAttribute('data-mode') === mode));
    document.getElementById('llmForm').style.display = mode === 'llm' ? 'block' : 'none';
  }

  async function saveLlm() {
    settings.llm = {
      baseUrl: document.getElementById('llm-base').value.trim(),
      apiKey: document.getElementById('llm-key').value.trim(),
      model: document.getElementById('llm-model').value.trim()
    };
    settings.aiMode = document.querySelector('.mode-card.active').getAttribute('data-mode');
    await API.saveSettings(settings);
    updateBadge();
    UI.toast('配置已保存', 'ok');
  }

  async function testLlm() {
    const btn = document.getElementById('testLlm');
    const out = document.getElementById('llmTestResult');
    btn.disabled = true; out.textContent = '测试中…';
    const llm = {
      baseUrl: document.getElementById('llm-base').value.trim(),
      apiKey: document.getElementById('llm-key').value.trim(),
      model: document.getElementById('llm-model').value.trim()
    };
    const r = await API.testLLM(llm);
    out.textContent = r.ok ? ('✅ ' + r.reply) : ('❌ ' + r.error);
    btn.disabled = false;
  }

  function readKnowledgeForm() {
    return {
      enabled: document.getElementById('kb-enabled').checked,
      provider: document.getElementById('kb-provider').value,
      mountPath: document.getElementById('kb-mount').value.trim(),
      baseUrl: document.getElementById('kb-base').value.trim(),
      searchUrl: document.getElementById('kb-search-url').value.trim(),
      datasetId: document.getElementById('kb-dataset').value.trim(),
      apiKey: document.getElementById('kb-key').value.trim(),
      topK: Number(document.getElementById('kb-topk').value) || 5,
      maxChars: Number(document.getElementById('kb-maxchars').value) || 6000
    };
  }

  function updateKnowledgeVisibility() {
    const provider = document.getElementById('kb-provider').value;
    document.getElementById('kb-local-fields').style.display = provider === 'local' ? 'block' : 'none';
    document.getElementById('kb-remote-fields').style.display = provider === 'local' ? 'none' : 'block';
  }

  async function saveKnowledge() {
    settings.knowledge = readKnowledgeForm();
    await API.saveSettings({ knowledge: settings.knowledge });
    UI.toast('知识库配置已保存', 'ok');
    await testKnowledge();
  }

  async function testKnowledge() {
    const btn = document.getElementById('testKnowledge');
    const out = document.getElementById('kbTestResult');
    btn.disabled = true;
    out.textContent = '检查中…';
    try {
      const r = await API.testKnowledge(readKnowledgeForm());
      out.textContent = r.ok ? `✅ 可用，命中 ${r.resultCount || 0} 个片段` : ('❌ ' + (r.error || '不可用'));
    } catch (e) {
      out.textContent = '❌ ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  function updateBadge() {
    const badge = document.getElementById('aiModeBadge');
    if (badge) badge.textContent = settings.aiMode === 'llm' ? '🌐 大模型API模式' : '🤖 内置AI引擎';
  }

  global.Views = global.Views || {};
  global.Views.settings = { render };
})(window);
