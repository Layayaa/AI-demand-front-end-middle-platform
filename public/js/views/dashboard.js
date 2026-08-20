/* 工作台：提需看进度，产品/业务看价值和待评审 */
(function (global) {
  async function render() {
    const reviewer = Role.isReviewer();
    const main = document.getElementById('main');
    main.innerHTML = '<div class="page-head"><h1>' + (reviewer ? '需求看板' : '我的需求') + '</h1>' +
      (reviewer ? '' : '<a href="#/new" class="btn btn-primary">提出需求</a>') + '</div>' +
      '<div class="sum-line" id="stats"></div>' +
      '<div class="card card-pad"><div class="flex-between mb12"><div class="card-title">' +
      (reviewer ? '全部需求' : '需求列表') +
      '</div><div class="muted text-sm" id="listCount"></div></div><div id="reqList"></div></div>';

    const [reqs, pri] = await Promise.all([API.listRequirements(), API.priority()]);
    renderStats(reqs, pri.items, reviewer);
    renderList(reqs, reviewer);
  }

  function renderStats(reqs, items, reviewer) {
    const total = reqs.length;
    const active = reqs.filter(r => !['done', 'review'].includes(r.status)).length;
    const review = reqs.filter(r => r.status === 'review').length;
    const p0 = items.filter(i => i.level === 'P0').length;
    document.getElementById('stats').textContent = reviewer
      ? total + ' 条 · ' + review + ' 待评审 · ' + p0 + ' 个 P0'
      : total + ' 条 · ' + active + ' 进行中';
  }

  function renderList(reqs, reviewer) {
    const box = document.getElementById('reqList');
    document.getElementById('listCount').textContent = '共 ' + reqs.length + ' 条';
    if (!reqs.length) {
      box.innerHTML = reviewer
        ? '<div class="empty">还没有需求。</div>'
        : '<div class="empty">还没有需求。<a class="link" href="#/new">提出一条</a></div>';
      return;
    }
    const valueCol = reviewer
      ? '<th>价值优先级</th>'
      : '';
    const rows = reqs.map(r => {
      const valueCell = reviewer
        ? `<td>${r.value ? `<span class="chip ${r.value.level === 'P0' ? 'lvl-P0' : r.value.level === 'P1' ? 'lvl-P1' : 'lvl-P2'}">${r.value.level}</span>
          <div class="text-xs muted mt8">${r.value.score} 分</div>` : '<span class="muted text-sm">待分析</span>'}</td>`
        : '';
      return `
      <tr class="rowlink" data-id="${r.id}">
        <td>
          <div class="req-title">${UI.esc(r.title)}${r.demo ? '<span class="demo-tag">示例</span>' : ''}</div>
          <div class="req-meta">${UI.esc(r.summary || '—')}</div>
        </td>
        <td>${UI.esc(r.department || '—')}</td>
        <td>
          <div class="progress"><i style="width:${UI.pct(r.status)}%"></i></div>
          <div class="progress-label">${UI.statusChip(r.status)}${reviewer ? '' : ' · 画像 ' + r.completeness + '%'}</div>
        </td>
        ${valueCell}
        <td class="text-xs muted">${UI.timeAgo(r.updatedAt)}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table class="req-table"><thead><tr>
      <th>需求</th><th>部门</th><th>进度</th>${valueCol}<th>更新</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
    box.querySelectorAll('tr.rowlink').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/req/' + tr.getAttribute('data-id'); });
    });
  }

  global.Views = global.Views || {};
  global.Views.dashboard = { render };
})(window);
