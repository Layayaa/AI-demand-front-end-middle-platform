/* 新建需求 + AI 前置澄清对话 */
(function (global) {
  let cur = null;        // 当前需求对象
  let sending = false;
  let reqId = null;

  async function renderForm() {
    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="page-head"><h1>提出需求</h1></div>
      <div class="card card-pad" style="max-width:560px">
        <div class="form-row"><label>标题</label><input type="text" id="f-title" placeholder="要解决什么问题" maxlength="60"></div>
        <div class="form-row"><label>说明</label><textarea id="f-summary" placeholder="已知事实写这里，不清楚的留空" maxlength="300"></textarea></div>
        <div class="form-row"><label>部门</label><input type="text" id="f-dept" placeholder="可选" maxlength="30"></div>
        <button class="btn btn-primary" id="f-submit">开始澄清</button>
      </div>`;
    document.getElementById('f-submit').addEventListener('click', submit);
    ['f-title', 'f-summary', 'f-dept'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && id === 'f-title') submit(); });
    });
  }

  async function submit() {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { UI.toast('请填写需求名称', 'warn'); return; }
    const btn = document.getElementById('f-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 创建中…';
    try {
      const r = await API.createRequirement({ title, summary: document.getElementById('f-summary').value.trim(), department: document.getElementById('f-dept').value.trim() });
      UI.toast('需求已创建，AI 澄清开始 🎉', 'ok');
      location.hash = '#/new/' + r.id;
    } catch (e) {
      UI.toast(e.message, 'err');
      btn.disabled = false; btn.innerHTML = '提交需求，开始 AI 前置澄清 →';
    }
  }

  /* ---------- 聊天模式 ---------- */
  async function renderChat(id) {
    reqId = id;
    cur = await API.getRequirement(id);
    if (!cur) { location.hash = '#/dashboard'; return; }
    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="flex-between mb16">
        <div>
          <h1 style="font-size:20px;font-weight:800">${UI.esc(cur.title)}</h1>
          <div class="sub muted mt8">AI 前置澄清中 · 阶段：<span id="stageLabel">—</span> · <a class="link" href="#/req/${id}">查看详情</a></div>
        </div>
        <div class="flex">
          <button class="btn" id="skipBtn">跳过澄清，直接生成方案</button>
          <button class="btn btn-primary" id="genBtn" disabled><span>⚡</span> 生成三档方案</button>
        </div>
      </div>
      <div class="chat-layout">
        <div class="chat-box">
          <div class="chat-head">
            <div class="avatar">🤖</div>
            <div><div class="who">AI 需求顾问</div><div class="state" id="aiState">正在与业务对话，梳理需求画像</div></div>
          </div>
          <div class="chat-msgs" id="chatMsgs"></div>
          <div class="chat-input">
            <textarea id="chatInput" placeholder="输入你的回答…（Enter 发送，Shift+Enter 换行）"></textarea>
            <button class="btn btn-primary send-btn" id="sendBtn">发送</button>
          </div>
        </div>
        <div>
          <div class="panel">
            <h3>🧭 澄清进度</h3>
            <div class="stepper" id="stepper"></div>
          </div>
          <div class="panel">
            <h3>📋 需求画像</h3>
            <div class="ring-wrap">
              <div class="ring" id="ring"><b>0%</b></div>
              <div class="ring-note" id="ringNote">AI 边聊边提取，<br>信息越全方案越准</div>
            </div>
            <div id="profFields" class="mt12"></div>
          </div>
        </div>
      </div>`;

    document.getElementById('sendBtn').addEventListener('click', send);
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('genBtn').addEventListener('click', generatePlans);
    document.getElementById('skipBtn').addEventListener('click', async () => {
      if (await UI.confirmModal('跳过澄清？', '画像完整度 ' + (cur.profile.completeness || 0) + '%。未聊清楚的部分会用「待确认」占位生成方案。建议先聊完再生成。', '仍要生成')) generatePlans();
    });

    renderMsgs();
    renderPanel();
  }

  function renderMsgs() {
    const box = document.getElementById('chatMsgs');
    const msgs = cur.chat || [];
    box.innerHTML = msgs.map((m, i) => {
      // 服务端角色为 assistant，前端按 ai 渲染（历史兼容两者）
      const isAi = m.role === 'ai' || m.role === 'assistant';
      const cls = isAi ? 'ai' : m.role === 'user' ? 'user' : m.role;
      return `<div class="msg ${cls}">
        ${isAi ? '<div class="avatar" style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🤖</div>' : ''}
        <div>
          <div class="bubble">${isAi ? MD.render(m.content) : UI.esc(m.content)}</div>
          ${isAi && i === msgs.length - 1 ? '<div class="chips" id="chipsRow"></div>' : ''}
          <div class="time">${UI.fmtTime(m.at)}</div>
        </div>
      </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
    // 刷新后把当前问题的可选项重新弹出来
    const last = msgs[msgs.length - 1];
    if (last && (last.role === 'ai' || last.role === 'assistant')) renderChips(cur.lastSuggestions || []);
  }

  function renderChips(chips) {
    const row = document.getElementById('chipsRow');
    if (!row) return;
    const list = (chips || []).filter(Boolean);
    row.innerHTML = list.length ? '<span class="chips-label">可选项：</span>' : '';
    list.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip-btn';
      b.textContent = c;
      b.addEventListener('click', () => {
        const inp = document.getElementById('chatInput');
        inp.value = c;
        send();
      });
      row.appendChild(b);
    });
  }

  async function send() {
    if (sending) return;
    const inp = document.getElementById('chatInput');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    sending = true;
    const box = document.getElementById('chatMsgs');
    box.insertAdjacentHTML('beforeend', `<div class="msg user"><div><div class="bubble">${UI.esc(text)}</div><div class="time">刚刚</div></div></div>`);
    const typing = document.createElement('div');
    typing.className = 'msg ai';
    typing.innerHTML = '<div class="avatar" style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🤖</div><div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>';
    box.appendChild(typing);
    box.scrollTop = box.scrollHeight;
    const btn = document.getElementById('sendBtn');
    btn.disabled = true;
    try {
      const res = await API.chat(reqId, text);
      cur.chat = cur.chat.concat([{ role: 'user', content: text }, { role: 'assistant', content: res.reply, at: new Date().toISOString() }]);
      cur.profile = res.profile;
      cur.status = res.status;
      cur.lastSuggestions = res.suggestions;
      renderMsgs();
      renderPanel(res);
      const genBtn = document.getElementById('genBtn');
      genBtn.disabled = !res.canGenerate;
      if (res.canGenerate) genBtn.classList.add('btn-success');
      document.getElementById('aiState').textContent = res.stageLabel + ' · 画像完整度 ' + res.completeness + '%';
      if (res.llmFailed) UI.toast('大模型调用失败，已自动切换内置引擎', 'warn');
    } catch (e) {
      UI.toast(e.message, 'err');
      box.removeChild(typing);
    } finally {
      sending = false;
      btn.disabled = false;
      document.getElementById('chatInput').focus();
    }
  }

  const STEPS = ['确认需求类型', '补全决策画像', '补全流程画像', '确认画像', '可生成方案'];

  function renderPanel(res) {
    const p = cur.profile || {};
    const comp = p.completeness || 0;
    const ring = document.getElementById('ring');
    if (ring) { ring.style.setProperty('--p', comp); ring.querySelector('b').textContent = comp + '%'; }
    const st = document.getElementById('stepper');
    if (st) {
      const stageIdx = res ? res.stageIndex : (p.stage === 'done' ? 4 : p.stage === 'confirm' ? 3 : p.type === 'sop' ? 2 : p.type === 'decision' ? 1 : 0);
      st.innerHTML = STEPS.map((s, i) => {
        const cls = i < stageIdx ? 'done' : i === stageIdx ? 'cur' : '';
        const mark = i < stageIdx ? '✓' : i === stageIdx ? (i + 1) : '';
        return `<div class="step ${cls}"><span class="dot">${mark}</span>${s}</div>`;
      }).join('');
    }
    renderProfileFields(p);
  }

  function renderProfileFields(p) {
    const box = document.getElementById('profFields');
    if (!box) return;
    if (!p.type) {
      box.innerHTML = '<div class="prof-field"><div class="v missing">等待确认需求类型（单点决策 / SOP流程）…</div></div>';
      return;
    }
    const d = p.decision, s = p.sop;
    const isD = p.type === 'decision';
    const html = [];
    const field = (k, v) => `<div class="prof-field"><div class="k">${k}</div><div class="v ${v ? '' : 'missing'}">${v ? UI.esc(String(v)) : '待确认'}</div></div>`;
    if (isD) {
      html.push(field('决策名称', d.name));
      html.push(field('归属部门 / 决策人', [d.department, d.decisionMaker].filter(Boolean).join(' / ')));
      html.push(field('频率 / 价值', `${UI.freqText(d.frequency)} / ${d.value ? d.value.level : ''}`));
      html.push(field('影响维度', d.dimensions.join('、')));
      html.push(field('决策目的', d.purpose));
      if (d.inputs.length) {
        html.push('<div class="prof-group-title">输入数据（' + d.inputs.length + '）</div>');
        d.inputs.forEach(i => html.push(field('· ' + (i.name || '待确认'), [i.source, i.method].filter(Boolean).join(' · '))));
      }
      if (d.standards.length) {
        html.push('<div class="prof-group-title">判断标准（' + d.standards.length + '）</div>');
        d.standards.forEach(x => html.push(field('· ' + (x.condition || ''), (x.result || '') + (x.clarity ? '（' + x.clarity + '）' : ''))));
      }
      if (d.actions.length) {
        html.push('<div class="prof-group-title">对应行动（' + d.actions.length + '）</div>');
        d.actions.forEach(a => html.push(field('· ' + (a.result || ''), [a.who, a.what, a.where].filter(Boolean).join(' → '))));
      }
    } else {
      html.push(field('流程名称', s.name));
      html.push(field('归属部门 / 负责人', [s.department, s.owner].filter(Boolean).join(' / ')));
      html.push(field('频率 / 价值', `${UI.freqText(s.frequency)} / ${s.value ? s.value.level : ''}`));
      html.push(field('影响维度', s.dimensions.join('、')));
      html.push(field('流程目的', s.purpose));
      if (s.steps.length) {
        html.push('<div class="prof-group-title">步骤拆解（' + s.steps.length + ' 步）</div>');
        s.steps.forEach(st => html.push(field('· ' + st.seq + '. ' + (st.action || ''), [st.type, st.minutes ? st.minutes + '分钟' : '', st.source].filter(Boolean).join(' · '))));
      }
    }
    box.innerHTML = html.join('');
  }

  async function generatePlans() {
    const btn = document.getElementById('genBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    const settings = await API.getSettings();
    if (settings.aiMode === 'llm') {
      btn.innerHTML = '<span class="spin"></span> 正在调用大模型生成 6 份文档（约 1~3 分钟）…';
    } else {
      btn.innerHTML = '<span class="spin"></span> 生成中（内置引擎）…';
    }
    try {
      await API.generatePlans(reqId, ['basic', 'intermediate', 'advanced']);
      cur = await API.getRequirement(reqId);
      UI.toast('三档方案已生成 ✅ 三档各含产品版 + 技术版，共 6 份', 'ok');
      location.hash = '#/req/' + reqId;
    } catch (e) {
      UI.toast(e.message, 'err');
      btn.disabled = false;
      btn.innerHTML = '<span>⚡</span> 生成三档方案';
    }
  }

  global.Views = global.Views || {};
  global.Views.intake = {
    renderForm,
    renderChat,
    reload: async (id) => { reqId = id; cur = await API.getRequirement(id); renderMsgs(); renderPanel(); }
  };
})(window);
