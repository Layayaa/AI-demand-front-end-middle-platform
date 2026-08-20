/* UI 工具：toast / modal / 状态徽章 / 时间格式化 / 转义 */
(function (global) {
  const STATUS = {
    submitted: { label: '已提交', cls: 'chip-submitted' },
    clarifying: { label: 'AI前置澄清中', cls: 'chip-clarifying' },
    analyzing: { label: '画像分析中', cls: 'chip-analyzing' },
    profiled: { label: '需求画像完成', cls: 'chip-profiled' },
    planning: { label: '方案生成中', cls: 'chip-planning' },
    review: { label: '待业务评审', cls: 'chip-review' },
    done: { label: '已完成', cls: 'chip-done' }
  };
  const STATUS_PCT = { submitted: 10, clarifying: 35, analyzing: 55, profiled: 65, planning: 75, review: 90, done: 100 };

  function toast(msg, type) {
    const root = document.getElementById('toastRoot');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = MD.stripEmoji(msg);
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 350); }, 2600);
  }
  function confirmModal(title, text, okText, danger) {
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      root.innerHTML = '';
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = '<div class="modal"><h3>' + MD.esc(title) + '</h3><p>' + MD.esc(text) + '</p>' +
        '<div class="actions"><button class="btn" data-act="no">取消</button><button class="btn ' + (danger ? 'btn-danger-soft' : 'btn-primary') + '" data-act="yes">' + MD.esc(okText || '确定') + '</button></div></div>';
      mask.addEventListener('click', (e) => {
        if (e.target === mask) { root.innerHTML = ''; resolve(false); }
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'yes') { root.innerHTML = ''; resolve(true); }
        if (act === 'no') { root.innerHTML = ''; resolve(false); }
      });
      root.appendChild(mask);
    });
  }
  function statusChip(s) {
    const info = STATUS[s] || { label: s, cls: 'chip-submitted' };
    return '<span class="chip ' + info.cls + '">' + MD.esc(info.label) + '</span>';
  }
  function levelChip(l) {
    const map = { P0: ['P0 · 立即做', 'lvl-P0'], P1: ['P1 · 本季度做', 'lvl-P1'], P2: ['P2 · 暂缓/合并', 'lvl-P2'] };
    const m = map[l] || ['P2 · 待评估', 'lvl-P2'];
    return '<span class="chip ' + m[1] + '">' + m[0] + '</span>';
  }
  function typeChip(t) {
    if (t === 'decision') return '<span class="chip chip-type">单点决策</span>';
    if (t === 'sop') return '<span class="chip chip-type">SOP流程</span>';
    return '<span class="chip chip-type">待识别</span>';
  }
  function fmtTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }
  function esc(s) { return MD.esc(s); }
  function pct(s) { return STATUS_PCT[s] || 10; }
  function freqText(f) {
    if (!f) return '待确认';
    return `${f.n}次/${f.unit}`;
  }
  global.UI = { toast, confirmModal, statusChip, levelChip, typeChip, fmtTime, timeAgo, esc, pct, freqText, STATUS };
})(window);
