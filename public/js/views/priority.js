/* 价值优先级看板 */
(function (global) {
  async function render() {
    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="page-head"><div><h1>价值优先级分析</h1><div class="sub">AI 按统一模型给每个需求打分排序，回答「先做哪个」</div></div>
        <button class="btn" id="refresh">重新分析</button></div>
      <div class="card card-pad mb16">
        <div class="card-title">评分模型</div>
        <div class="card-sub">价值大小(35) + 发生频率(15) + 耗时投入(15) + 影响维度(12) + 自动化潜力(15) + 参与人数(8)，总分 100。≥80=P0 立即做 · 60~79=P1 本季度做 · &lt;60=P2 暂缓/合并</div>
        <div class="flex" style="flex-wrap:wrap;gap:8px">
          <span class="chip lvl-P0">P0 · 立即做</span>
          <span class="chip lvl-P1">P1 · 本季度做</span>
          <span class="chip lvl-P2">P2 · 暂缓/合并</span>
        </div>
      </div>
      <div id="priList"></div>`;
    document.getElementById('refresh').addEventListener('click', load);
    await load();
  }

  async function load() {
    const box = document.getElementById('priList');
    box.innerHTML = '<div class="card card-pad empty"><div class="spin" style="border-color:#c7d2fe;border-top-color:#4f46e5;width:26px;height:26px"></div><div class="mt8">分析中…</div></div>';
    const data = await API.priority();
    const items = data.items;
    if (!items.length) {
      box.innerHTML = '<div class="card card-pad empty">暂无需求。先完成澄清后再看价值排序。</div>';
      return;
    }
    const color = (l) => l === 'P0' ? '#dc2626' : l === 'P1' ? '#d97706' : '#64748b';
    box.innerHTML = items.map((i, idx) => `
      <div class="card pri-card mb12" style="cursor:pointer" data-id="${i.id}">
        <div class="pri-score-text">${i.score}<span>分</span></div>
        <div class="pri-main">
          <div class="flex-between">
            <div>
              <span style="font-weight:700">${idx + 1}. ${UI.esc(i.title)}</span>
              ${i.demo ? '<span class="demo-tag" style="font-size:11px;color:#db2777;background:#fdf2f8;padding:1px 6px;border-radius:6px;margin-left:6px">示例</span>' : ''}
            </div>
            ${UI.levelChip(i.level)}
          </div>
          <div class="score-bar mt8"><i style="width:${i.score}%;background:${color(i.level)}"></i></div>
          <div class="pri-reasons">${i.reasons.map(r => '<span class="pri-reason">' + UI.esc(r) + '</span>').join('')}</div>
          <div class="pri-rec"><b>建议：</b>${UI.esc(i.recommendation)}</div>
        </div>
      </div>`).join('');
    box.querySelectorAll('.pri-card').forEach(c => {
      c.addEventListener('click', () => { location.hash = '#/req/' + c.getAttribute('data-id'); });
    });
  }

  global.Views = global.Views || {};
  global.Views.priority = { render };
})(window);
