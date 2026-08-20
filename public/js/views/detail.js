/* 需求详情：画像 / 三档方案 / 价值分析 / 进度 */
(function (global) {
  let id = null, cur = null, tab = 'plans';

  async function render(rid, tabHint) {
    id = rid;
    cur = await API.getRequirement(rid);
    if (!cur) { location.hash = '#/dashboard'; return; }
    if (['plans', 'profile', 'value', 'progress'].includes(tabHint)) tab = tabHint;
    if (!Role.isReviewer() && tab === 'value') tab = 'plans';
    const main = document.getElementById('main');
    const v = cur.value;
    const reviewer = Role.isReviewer();
    const valueChip = reviewer && v
      ? '<span class="chip ' + (v.level === 'P0' ? 'lvl-P0' : v.level === 'P1' ? 'lvl-P1' : 'lvl-P2') + '">' + v.level + ' · ' + v.score + ' 分</span>'
      : '';
    const valueTab = reviewer ? '<div class="tab" data-t="value">价值分析</div>' : '';
    const confirmBtn = reviewer
      ? '<button class="btn btn-success" id="confirmDone">确认完成</button>'
      : '';
    const chatBtn = reviewer
      ? ''
      : '<button class="btn btn-primary" id="goChat">继续澄清</button>';
    main.innerHTML = `
      <div class="detail-head card card-pad">
        <div class="info">
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            <h1 style="font-size:20px;font-weight:800">${UI.esc(cur.title)}</h1>
            ${UI.typeChip(cur.type)}${cur.demo ? '<span class="chip chip-demo">示例</span>' : ''}
          </div>
          <div class="muted text-sm mt8">${UI.esc(cur.summary || '—')} · ${UI.esc(cur.department || '')} · 创建于 ${UI.fmtTime(cur.createdAt)}</div>
          <div class="flex mt12" style="gap:12px">
            ${UI.statusChip(cur.status)}
            <div class="flex" style="gap:6px"><div class="progress" style="width:160px"><i style="width:${UI.pct(cur.status)}%"></i></div><span class="text-xs muted">${UI.pct(cur.status)}%</span></div>
            ${valueChip}
          </div>
        </div>
        <div class="flex">
          ${chatBtn}
          ${confirmBtn}
        </div>
      </div>
      <div class="tabs">
        <div class="tab" data-t="plans">方案</div>
        <div class="tab" data-t="profile">需求画像</div>
        ${valueTab}
        <div class="tab" data-t="progress">进度</div>
      </div>
      <div id="tabBody"></div>`;

    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => {
        tab = t.getAttribute('data-t');
        history.replaceState(null, '', '#/req/' + id + '/' + tab);
        renderTab();
      });
    });
    const chat = document.getElementById('goChat');
    if (chat) chat.addEventListener('click', () => { location.hash = '#/new/' + id; });
    const done = document.getElementById('confirmDone');
    if (done) done.addEventListener('click', confirmDone);
    renderTab();
  }

  function confirmDone() {
    UI.confirmModal('确认完成？', '标记为「已完成」后，该需求将从待评审清单移出。', '确认完成').then(async (ok) => {
      if (!ok) return;
      await API.setStatus(id, 'done', '业务确认完成');
      UI.toast('已标记完成', 'ok');
      cur = await API.getRequirement(id);
      location.hash = '#/req/' + id;
    });
  }

  function renderTab() {
    const box = document.getElementById('tabBody');
    if (tab === 'plans') renderPlans(box);
    else if (tab === 'profile') renderProfile(box);
    else if (tab === 'value') renderValue(box);
    else renderProgress(box);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-t') === tab));
  }

  /* ---------- 三档方案 ---------- */
  function renderPlans(box) {
    const plans = cur.plans;
    if (!plans || !plans.basic) {
      box.innerHTML = '<div class="card card-pad empty">方案尚未生成。先完成澄清，再点击「生成三档方案」。' +
        '<div class="mt12"><button class="btn btn-primary" onclick="location.hash=\'#/new/' + id + '\'">继续 AI 澄清</button></div></div>';
      return;
    }
    const tiers = [
      { key: 'basic', name: '初级方案', desc: '快速判断 · 产品版 + 技术版', cls: 'chip-tier-basic' },
      { key: 'intermediate', name: '中级方案', desc: '可评审方案 · 产品版 + 技术版', cls: 'chip-tier-intermediate' },
      { key: 'advanced', name: '高级方案', desc: '完整立项 · 产品版(PRD) + 技术版', cls: 'chip-tier-advanced' }
    ];
    box.innerHTML = '<div class="tier-grid">' + tiers.map(t => {
      const p = plans[t.key];
      // 新数据三档均为产品版+技术版；旧示例的 basic.overview 继续可查看。
      let docs;
      if (t.key === 'basic' && !p.product && p.overview) {
        const mode = p.mode_overview === 'llm' ? 'LLM' : '内置引擎';
        docs = [{ doc: 'overview', t: '方案速览（合并版）', s: '定位 · 价值判断 · 关键要点 · 技术快照（' + mode + '）' }];
      } else {
        const modeP = p.mode_product === 'llm' ? 'LLM' : '内置引擎';
        const modeT = p.mode_tech === 'llm' ? 'LLM' : '内置引擎';
        docs = [
          { doc: 'product', t: '产品版方案', s: '需求定位 · 流程 · 功能 · 验收（' + modeP + '）' },
          { doc: 'tech', t: '技术版方案', s: '数据 · 自动化 · 集成 · 实施（' + modeT + '）' }
        ];
      }
      return `<div class="tier">
        <div class="tier-head">
          <div class="tier-name">${t.name} <span class="chip ${t.cls}">${t.key === 'basic' ? '速览' : t.key === 'intermediate' ? '评审' : '立项'}</span></div>
          <div class="tier-desc">${t.desc}</div>
        </div>
        <div class="tier-body">
          <div class="tier-doc-list">
            ${docs.map(dd => `<button class="doc-btn" data-tier="${t.key}" data-doc="${dd.doc}">
              <div><div class="t">${dd.t}</div><div class="s">${dd.s}</div></div>
            </button>`).join('')}
          </div>
        </div>
      </div>`;
    }).join('') + '</div>' +
    '<div class="card card-pad mt16"><div class="card-title">方案方法论</div><div class="card-sub">三档递进：初级判断「值不值得做」；中级回答「怎么做」；高级回答「如何完整落地」。每档都提供产品版与技术版，共 6 份文档，分别服务业务评审与技术评估。</div></div>';

    box.querySelectorAll('.doc-btn').forEach(b => {
      b.addEventListener('click', () => openDoc(b.getAttribute('data-tier'), b.getAttribute('data-doc')));
    });
  }

  function openDoc(tier, doc) {
    const p = cur.plans[tier];
    const md = p[doc];
    const tierLabel = (tier === 'basic' ? '初级' : tier === 'intermediate' ? '中级' : '高级') + '方案';
    const docName = tierLabel + ' · ' + (doc === 'overview' ? '速览' : doc === 'product' ? '产品版' : '技术版');
    const root = document.getElementById('modalRoot');
    root.innerHTML = '';
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.style.alignItems = 'flex-start';
    mask.style.overflowY = 'auto';
    mask.style.padding = '30px 20px';
    mask.innerHTML = `<div class="doc-viewer" style="margin:0 auto">
      <div class="flex-between mb12">
        <div style="font-size:13px;color:var(--ink-3)">${UI.esc(cur.title)} · ${UI.esc(docName)} · 生成于 ${UI.fmtTime(p.generatedAt)}</div>
        <div class="flex">
          <button class="btn btn-primary btn-sm" id="dlWord">下载 Word</button>
          <button class="btn btn-sm" id="dlMd">Markdown</button>
          <button class="btn btn-sm" id="closeDoc">关闭</button>
        </div>
      </div>
      <div id="docBody">${MD.render(md)}</div>
    </div>`;
    mask.addEventListener('click', (e) => { if (e.target === mask) root.innerHTML = ''; });
    mask.querySelector('#closeDoc').addEventListener('click', () => { root.innerHTML = ''; });
    const saveBlob = (blob, fname) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    mask.querySelector('#dlWord').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-color:#c7d2fe;border-top-color:#fff"></span> 生成中…';
      try {
        const res = await fetch(`/api/requirements/${encodeURIComponent(id)}/documents/${tier}/${doc}/download`);
        if (!res.ok) throw new Error('下载失败');
        const blob = await res.blob();
        saveBlob(blob, `${cur.title}_${tierLabel}_${doc === 'overview' ? '速览' : doc === 'product' ? '产品版' : '技术版'}.docx`);
      } catch (err) {
        UI.toast(err.message, 'err');
      }
      btn.disabled = false; btn.innerHTML = '下载 Word';
    });
    mask.querySelector('#dlMd').addEventListener('click', () => {
      saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${cur.title}_${tierLabel}_${doc === 'overview' ? '速览' : doc === 'product' ? '产品版' : '技术版'}.md`);
    });
    root.appendChild(mask);
  }

  /* ---------- 需求画像 ---------- */
  function renderProfile(box) {
    const p = cur.profile;
    const field = (k, v) => `<div class="prof-field"><div class="k">${k}</div><div class="v ${v ? '' : 'missing'}">${v ? UI.esc(String(v)) : '待确认'}</div></div>`;
    const d = p.decision, s = p.sop;
    let html = `<div class="card card-pad"><div class="flex-between">
        <div class="card-title">需求画像（完整度 ${p.completeness || 0}%）</div>
        <div class="flex">${UI.typeChip(p.type)}<button class="btn btn-sm" id="editProfile">去澄清里补充</button></div>
      </div>`;
    if (!p.type) {
      html += '<div class="empty">尚未开始澄清。</div></div>';
      box.innerHTML = html; bindEdit(); return;
    }
    if (p.type === 'decision') {
      html += `<div class="grid grid-2 mt16">
        <div><div class="prof-group-title">基本信息</div>
          ${field('决策名称', d.name)}${field('归属部门', d.department)}${field('决策人', d.decisionMaker)}
          ${field('频率', UI.freqText(d.frequency))}${field('价值大小', d.value ? d.value.level + (d.value.reason ? ' — ' + d.value.reason : '') : '')}
          ${field('业务影响维度', d.dimensions.join('、'))}${field('每次耗时(分钟)', d.timeCostMin)}${field('参与人数', d.people)}
          ${field('决策目的', d.purpose)}${field('整体描述', d.description)}
        </div>
        <div>
          <div class="prof-group-title">输入数据（${d.inputs.length}）</div>
          ${d.inputs.length ? '<div class="card" style="overflow:hidden"><table class="req-table"><thead><tr><th>数据名称</th><th>来源系统</th><th>取数方式</th></tr></thead><tbody>' +
            d.inputs.map(i => `<tr><td>${UI.esc(i.name)}</td><td>${UI.esc(i.source || '—')}</td><td>${UI.esc(i.method || '—')}</td></tr>`).join('') + '</tbody></table></div>' : field('输入数据', '')}
          <div class="prof-group-title">分析规则</div>
          ${field('规则', d.rules)}
          <div class="prof-group-title">判断标准（${d.standards.length}）</div>
          ${d.standards.length ? '<div class="card" style="overflow:hidden"><table class="req-table"><thead><tr><th>情况/条件</th><th>判断结果</th><th>明确程度</th></tr></thead><tbody>' +
            d.standards.map(x => `<tr><td>${UI.esc(x.condition)}</td><td>${UI.esc(x.result)}</td><td>${UI.esc(x.clarity || '—')}</td></tr>`).join('') + '</tbody></table></div>' : field('判断标准', '')}
          <div class="prof-group-title">对应行动（${d.actions.length}）</div>
          ${d.actions.length ? '<div class="card" style="overflow:hidden"><table class="req-table"><thead><tr><th>判断结果</th><th>谁执行</th><th>做什么</th><th>在哪操作</th></tr></thead><tbody>' +
            d.actions.map(a => `<tr><td>${UI.esc(a.result)}</td><td>${UI.esc(a.who || '—')}</td><td>${UI.esc(a.what)}</td><td>${UI.esc(a.where || '—')}</td></tr>`).join('') + '</tbody></table></div>' : field('对应行动', '')}
        </div>
      </div></div>`;
    } else {
      html += `<div class="grid grid-2 mt16">
        <div><div class="prof-group-title">基本信息</div>
          ${field('流程名称', s.name)}${field('归属部门', s.department)}${field('负责人', s.owner)}
          ${field('频率', UI.freqText(s.frequency))}${field('价值大小', s.value ? s.value.level + (s.value.reason ? ' — ' + s.value.reason : '') : '')}
          ${field('业务影响维度', s.dimensions.join('、'))}${field('每次耗时(分钟)', s.durationMin)}${field('涉及人数', s.people)}
          ${field('流程目的', s.purpose)}${field('整体描述', s.description)}
        </div>
        <div>
          <div class="prof-group-title">步骤拆解（${s.steps.length}）</div>
          <div class="card" style="overflow:hidden"><table class="req-table"><thead><tr><th>#</th><th>具体动作</th><th>类型</th><th>耗时</th><th>来源/取数</th><th>靠人原因</th></tr></thead><tbody>
            ${s.steps.map(st => `<tr><td>${st.seq}</td><td>${UI.esc(st.action)}</td><td>${UI.esc(st.type)}</td><td>${st.minutes ? st.minutes + '分' : '—'}</td><td>${UI.esc([st.source, st.method].filter(Boolean).join('/') || '—')}</td><td class="text-xs">${UI.esc(st.reason || '—')}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
      </div></div>`;
    }
    box.innerHTML = html;
    bindEdit();
    function bindEdit() {
      const b = document.getElementById('editProfile');
      if (b) b.addEventListener('click', () => { location.hash = '#/new/' + id; });
    }
  }

  /* ---------- 价值分析 ---------- */
  function renderValue(box) {
    const v = cur.value;
    if (!v) {
      box.innerHTML = '<div class="card card-pad empty">生成方案后会自动完成价值分析。去 <a class="link" href="#/priority">价值优先级看板</a> 查看全局排序。</div>';
      return;
    }
    const color = v.level === 'P0' ? '#dc2626' : v.level === 'P1' ? '#d97706' : '#64748b';
    const parts = v.parts || [];
    const a = v.assessment;
    const riskColor = (r) => r === '高' ? '#dc2626' : r === '中' ? '#d97706' : '#16a34a';
    const confColor = (c) => c === '高' ? '#16a34a' : c === '中' ? '#d97706' : '#64748b';
    const assCard = a ? `<div class="card card-pad mt16">
      <div class="card-title">项目级评估</div>
      <div class="card-sub">规模 / 风险 / 工作量 / 置信度（由画像与规则自动计算）</div>
      <div class="flex" style="gap:8px;flex-wrap:wrap">
        <span class="chip chip-type">规模：${UI.esc(a.project_size)}</span>
        <span class="chip" style="background:${riskColor(a.risk_level)}22;color:${riskColor(a.risk_level)}">风险：${UI.esc(a.risk_level)}</span>
        <span class="chip" style="background:#eef2ff;color:#4f46e5">工作量：约 ${a.effort_pm_min}~${a.effort_pm_max} 人月（${v.effort} 人天）</span>
        <span class="chip" style="background:${confColor(a.confidence)}22;color:${confColor(a.confidence)}">置信度：${UI.esc(a.confidence)}</span>
      </div>
      ${a.dimensions.length ? `<div class="prof-group-title">评估维度</div>
      ${a.dimensions.map(dm => {
        const dc = dm.score >= 70 ? '#16a34a' : dm.score >= 40 ? '#d97706' : '#dc2626';
        return `<div class="mb8"><div class="flex-between text-sm"><span>${UI.esc(dm.name)} <span class="muted">（${UI.esc(dm.level)}）</span></span>
        <span class="muted">${dm.score} 分 · ${UI.esc((dm.evidence || [])[0] || '')}</span></div>
        <div class="score-bar mt8"><i style="width:${dm.score}%;background:${dc}"></i></div></div>`;
      }).join('')}` : ''}
      ${a.gaps && a.gaps.length ? `<div class="prof-group-title">待确认缺口</div>
      ${a.gaps.map(g => `<div class="flow-chip" style="font-size:12px;padding:5px 10px">${UI.esc(g)}</div>`).join('')}` : ''}
    </div>` : '';

    box.innerHTML = `<div class="grid grid-2">
      <div class="card card-pad">
        <div class="card-title">价值评分</div>
        <div class="flex mt12" style="gap:18px;align-items:center">
          <div class="pri-score-text">${v.score}<span>分</span></div>
          <div>
            ${UI.levelChip(v.level)}
            ${v.effort !== undefined ? `<div class="text-sm muted mt8">预计投入约 <b>${v.effort}</b> 人天 · 自动化潜力 <b>${v.autoRate}%</b></div>` : ''}
          </div>
        </div>
        ${parts.length ? `<div class="prof-group-title">评分构成</div>
        ${parts.map(p => `
          <div class="mb8"><div class="flex-between text-sm"><span>${p.label}</span><span class="muted">${p.got}/${p.base} · ${UI.esc(p.note)}</span></div>
          <div class="score-bar mt8"><i style="width:${Math.round(p.got / p.base * 100)}%;background:${color}"></i></div></div>`).join('')}` : ''}
      </div>
      <div class="card card-pad">
        <div class="card-title">分析结论</div>
        <div class="prof-group-title">建议行动</div>
        <div class="prof-field"><div class="v" style="color:var(--primary);font-weight:600">${UI.esc(v.recommendation)}</div></div>
        <div class="prof-group-title">关键依据</div>
        ${v.reasons.map(r => `<div class="flow-chip" style="font-size:12px;padding:5px 10px">${UI.esc(r)}</div>`).join('')}
        <div class="prof-group-title">评分说明</div>
        <div class="text-sm muted">价值大小 35 分 + 发生频率 15 分 + 耗时投入 15 分 + 影响维度 12 分 + 自动化潜力 15 分 + 参与人数 8 分，总分 100 分：≥80 = P0（立即做），60~79 = P1（本季度做），&lt;60 = P2（暂缓/合并）。</div>
      </div>
    </div>${assCard}`;
  }

  /* ---------- 进度记录 ---------- */
  function renderProgress(box) {
    const hist = (cur.statusHistory || []).slice().reverse();
    const chatCount = (cur.chat || []).length;
    box.innerHTML = `<div class="grid grid-2">
      <div class="card card-pad">
        <div class="card-title">进度时间线</div>
        <div class="timeline mt12">
          ${hist.map(h => `<div class="tl-item">
            <div class="tl-title">${UI.statusChip(h.status)}</div>
            <div class="tl-note">${UI.esc(h.note || '')}</div>
            <div class="tl-time">${UI.fmtTime(h.at)}</div>
          </div>`).join('') || '<div class="muted text-sm">暂无记录</div>'}
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title">当前状态</div>
        <div class="prof-field"><div class="k">需求状态</div><div class="v">${UI.statusChip(cur.status)}（进度 ${UI.pct(cur.status)}%）</div></div>
        <div class="prof-field"><div class="k">AI 澄清对话</div><div class="v">${chatCount} 条消息 · 画像完整度 ${cur.profile.completeness || 0}%</div></div>
        <div class="prof-field"><div class="k">方案文档</div><div class="v">${cur.plans && cur.plans.basic ? '初级/中级/高级 × 产品版/技术版 共 6 份' : '未生成'}</div></div>
        <div class="prof-field"><div class="k">价值优先级</div><div class="v">${cur.value ? cur.value.level + ' · ' + cur.value.score + ' 分' : '待分析'}</div></div>
        <div class="prof-field"><div class="k">创建 / 更新</div><div class="v">${UI.fmtTime(cur.createdAt)} / ${UI.fmtTime(cur.updatedAt)}</div></div>
        <div class="mt12"><button class="btn btn-primary btn-block" id="toChat">继续澄清 / 重新生成</button></div>
      </div>
    </div>`;
    document.getElementById('toChat').addEventListener('click', () => { location.hash = '#/new/' + id; });
  }

  global.Views = global.Views || {};
  global.Views.detail = { render };
})(window);
