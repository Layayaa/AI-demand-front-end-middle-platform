/* 工作台视图 */
(function (global) {
  async function render() {
    const main = document.getElementById('main');
    main.innerHTML = '<div class="page-head"><h1>项目</h1>' +
      '<a href="#/new" class="btn btn-primary">提出需求</a></div>' +
      '<div class="sum-line" id="stats"></div>' +
      '<div class="card card-pad"><div class="flex-between mb12"><div class="card-title">需求列表</div><div class="muted text-sm" id="listCount"></div></div><div id="reqList"></div></div>';

    const [reqs, pri] = await Promise.all([API.listRequirements(), API.priority()]);
    renderStats(reqs, pri.items);
    renderList(reqs);
  }

  function renderStats(reqs, items) {
    const total = reqs.length;
    const active = reqs.filter(r => !['done', 'review'].includes(r.status)).length;
    const review = reqs.filter(r => r.status === 'review').length;
    const p0 = items.filter(i => i.level === 'P0').length;
    document.getElementById('stats').textContent =
      total + ' 条 · ' + active + ' 进行中 · ' + review + ' 待评审 · ' + p0 + ' 个 P0';
  }

  function renderList(reqs) {
    const box = document.getElementById('reqList');
    document.getElementById('listCount').textContent = '共 ' + reqs.length + ' 条';
    if (!reqs.length) {
      box.innerHTML = '<div class="empty">还没有需求。<a class="link" href="#/new">提出一条</a></div>';
      return;
    }
    const rows = reqs.map(r => `
      <tr class="rowlink" data-id="${r.id}">
        <td>
          <div class="req-title">${UI.esc(r.title)}${r.demo ? '<span class="demo-tag">示例</span>' : ''}</div>
          <div class="req-meta">${UI.esc(r.summary || '—')}</div>
        </td>
        <td>${UI.esc(r.department || '—')}</td>
        <td>${UI.typeChip(r.type)}</td>
        <td>
          <div class="progress"><i style="width:${UI.pct(r.status)}%"></i></div>
          <div class="progress-label">${UI.statusChip(r.status)} · 画像 ${r.completeness}%</div>
        </td>
        <td>
          ${r.value ? `<span class="chip ${r.value.level === 'P0' ? 'lvl-P0' : r.value.level === 'P1' ? 'lvl-P1' : 'lvl-P2'}">${r.value.level}</span>
          <div class="text-xs muted mt8">${r.value.score} 分</div>` : '<span class="muted text-sm">待分析</span>'}
        </td>
        <td class="text-xs muted">${UI.timeAgo(r.updatedAt)}</td>
      </tr>`).join('');
    box.innerHTML = `<table class="req-table"><thead><tr>
      <th>需求</th><th>部门</th><th>类型</th><th>进度</th><th>价值优先级</th><th>更新时间</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
    box.querySelectorAll('tr.rowlink').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/req/' + tr.getAttribute('data-id'); });
    });
  }

  global.Views = global.Views || {};
  global.Views.dashboard = { render };
})(window);
