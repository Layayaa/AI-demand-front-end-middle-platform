/* 轻量 Markdown 渲染器（安全：先转义 HTML，再解析） */
(function (global) {
  /* 展示层去掉表情符号。源码不写 emoji 字符，避免页面或调试器里再看到。 */
  function stripEmoji(s) {
    return String(s == null ? '' : s)
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[\uFE00-\uFE0F\u200D\u20E3]/g, '')
      .replace(/[\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF]/g, '');
  }
  function esc(s) {
    return stripEmoji(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    s = esc(s);
    // 行内代码
    s = s.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
    // 链接（仅 http/https）
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => '<a class="link" href="' + u + '" target="_blank" rel="noopener">' + t + '</a>');
    // 加粗
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return s;
  }
  function renderTable(lines) {
    const rows = [];
    for (const ln of lines) {
      const cells = ln.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      rows.push(cells);
    }
    // 去掉分隔行 | --- | --- |
    const filtered = rows.filter(r => !(r.length && r.every(c => /^:?-{2,}:?$/.test(c))));
    if (!filtered.length) return '';
    const head = filtered[0];
    let html = '<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
    for (let i = 1; i < filtered.length; i++) {
      html += '<tr>' + filtered[i].map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }
  function render(md) {
    if (!md) return '';
    const lines = stripEmoji(md).split(/\r?\n/);
    let html = '';
    let i = 0;
    let listType = null, inCode = false, codeBuf = [], tableBuf = null;
    const flushTable = () => {
      if (tableBuf) { html += renderTable(tableBuf); tableBuf = null; }
    };
    const flushList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
    while (i < lines.length) {
      const line = lines[i];
      if (inCode) {
        if (/^```/.test(line.trim())) { inCode = false; html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; codeBuf = []; }
        else codeBuf.push(line);
        i++; continue;
      }
      if (/^```/.test(line.trim())) { flushTable(); flushList(); inCode = true; i++; continue; }
      // 表格
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushList();
        if (!tableBuf) tableBuf = [];
        tableBuf.push(line);
        i++; continue;
      } else { flushTable(); }
      const t = line.trim();
      if (!t) { flushList(); html += ''; i++; continue; }
      // 标题
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushList(); const lv = h[1].length + 1; html += '<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'; i++; continue; }
      // 引用
      if (/^>\s?/.test(t)) { flushList(); html += '<blockquote>' + inline(t.replace(/^>\s?/, '')) + '</blockquote>'; i++; continue; }
      // 无序列表
      if (/^[-*•]\s+/.test(t)) { if (listType !== 'ul') { flushList(); listType = 'ul'; html += '<ul>'; } html += '<li>' + inline(t.replace(/^[-*•]\s+/, '')) + '</li>'; i++; continue; }
      // 有序列表
      const ol = t.match(/^\d+[.、)]\s+(.*)$/);
      if (ol) { if (listType !== 'ol') { flushList(); listType = 'ol'; html += '<ol>'; } html += '<li>' + inline(ol[1]) + '</li>'; i++; continue; }
      // 分隔线
      if (/^(-{3,}|\*{3,})$/.test(t)) { flushList(); html += '<hr>'; i++; continue; }
      flushList();
      html += '<p>' + inline(t) + '</p>';
      i++;
    }
    if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
    flushTable(); flushList();
    return html;
  }
  global.MD = { render, inline, esc, stripEmoji };
})(window);
