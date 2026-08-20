'use strict';
/* 纯 Node 生成 Word (.docx) —— 零依赖
   ZIP 容器(Deflate) + OOXML(WordprocessingML) + 简易 Markdown 解析
   支持：标题1-4 / 段落(加粗/斜体/行内代码/链接) / 表格(表头着色) /
        无序有序列表 / 引用 / 代码块 / 分隔线 */
const zlib = require('zlib');

/* ---------- ZIP writer ---------- */
function crc32(buf) {
  return zlib.crc32(buf);
}
function zipEntries(entries) {
  // entries: [{ name, data:Buffer }]
  const local = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const method = 8; // deflate
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0x0800, 6);      // flags: UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);          // extra len
    local.push(Buffer.concat([lh, nameBuf, comp]));

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0x0800, 8);      // flags
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra
    ch.writeUInt16LE(0, 32);          // comment
    ch.writeUInt16LE(0, 34);          // disk
    ch.writeUInt16LE(0, 36);          // internal attrs
    ch.writeUInt32LE(0, 38);          // external attrs
    ch.writeUInt32LE(offset, 42);     // local header offset
    central.push(Buffer.concat([ch, nameBuf]));
    offset += lh.length + nameBuf.length + comp.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, eocd]);
}

/* ---------- Markdown 解析成块 ---------- */
function parseBlocks(md) {
  const lines = String(md || '').split(/\r?\n/);
  const blocks = [];
  let i = 0, listType = null, listItems = [], tableBuf = null, codeBuf = null;

  const pushTable = () => {
    if (!tableBuf) return;
    const rows = tableBuf.map(ln => ln.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    const data = rows.filter(r => !(r.length && r.every(c => /^:?-{2,}:?$/.test(c))));
    if (data.length) blocks.push({ type: 'table', rows: data });
    tableBuf = null;
  };
  const pushList = () => {
    if (listType) { blocks.push({ type: listType, items: listItems }); listType = null; listItems = []; }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (codeBuf !== null) {
      if (/^```/.test(t)) { blocks.push({ type: 'code', text: codeBuf.join('\n') }); codeBuf = null; }
      else codeBuf.push(raw);
      i++; continue;
    }
    if (/^```/.test(t)) { pushTable(); pushList(); codeBuf = []; i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(t)) { pushList(); if (!tableBuf) tableBuf = []; tableBuf.push(t); i++; continue; }
    pushTable();
    if (!t) { pushList(); i++; continue; }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { pushList(); blocks.push({ type: 'h' + h[1].length, text: h[2] }); i++; continue; }
    if (/^>\s?/.test(t)) { pushList(); blocks.push({ type: 'quote', text: t.replace(/^>\s?/, '') }); i++; continue; }
    if (/^[-*•]\s+/.test(t)) {
      if (listType !== 'ul') { pushList(); listType = 'ul'; }
      listItems.push(t.replace(/^[-*•]\s+/, ''));
      i++; continue;
    }
    const ol = t.match(/^\d+[.、)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { pushList(); listType = 'ol'; }
      listItems.push(ol[1]);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { pushList(); blocks.push({ type: 'hr' }); i++; continue; }
    pushList();
    blocks.push({ type: 'p', text: t });
    i++;
  }
  if (codeBuf !== null) blocks.push({ type: 'code', text: codeBuf.join('\n') });
  pushTable(); pushList();
  return blocks;
}

/* ---------- OOXML 构建 ---------- */
const XML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runs(seg) {
  // seg: 已转义前的原始文本，解析 **bold** *italic* `code` [link](url)
  const tokens = [];
  let buf = '';
  const flush = () => { if (buf) { tokens.push({ t: buf }); buf = ''; } };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (seg.startsWith('**', i)) {
      const end = seg.indexOf('**', i + 2);
      if (end > i) { flush(); tokens.push({ b: seg.slice(i + 2, end) }); i = end + 1; continue; }
    }
    if (seg.startsWith('`', i)) {
      const end = seg.indexOf('`', i + 1);
      if (end > i) { flush(); tokens.push({ c: seg.slice(i + 1, end) }); i = end; continue; }
    }
    if (seg.startsWith('*', i)) {
      const end = seg.indexOf('*', i + 1);
      if (end > i) { flush(); tokens.push({ i: seg.slice(i + 1, end) }); i = end; continue; }
    }
    if (seg.startsWith('[', i)) {
      const m = seg.slice(i).match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
      if (m) { flush(); tokens.push({ l: m[1], u: m[2] }); i += m[0].length - 1; continue; }
    }
    buf += c;
  }
  flush();
  return tokens.map(tk => {
    let rpr = '';
    if (tk.b) rpr = '<w:rPr><w:b/></w:rPr>';
    else if (tk.i) rpr = '<w:rPr><w:i/></w:rPr>';
    else if (tk.c) rpr = '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F1F5F9"/></w:rPr>';
    else if (tk.l) rpr = '<w:rPr><w:color w:val="4F46E5"/><w:u w:val="single"/></w:rPr>';
    return '<w:r>' + rpr + '<w:t xml:space="preserve">' + XML(tk.t || tk.b || tk.i || tk.c || tk.l || '') + '</w:t></w:r>';
  }).join('');
}

function para(text, opts) {
  opts = opts || {};
  let ppr = '';
  if (opts.indent) ppr += '<w:pPr><w:ind w:left="' + opts.indent + '"/></w:pPr>';
  if (opts.prefix) return '<w:p>' + ppr + runs(opts.prefix) + runs(text) + '</w:p>';
  return '<w:p>' + ppr + runs(text) + '</w:p>';
}

function heading(level, text) {
  const style = 'Heading' + Math.min(level, 4);
  return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/><w:keepNext/></w:pPr>' + runs(text) + '</w:p>';
}

function quote(text) {
  return '<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="4F46E5"/></w:pBdr><w:ind w:left="240"/></w:pPr>' +
    '<w:r><w:rPr><w:i/><w:color w:val="475569"/></w:rPr><w:t xml:space="preserve">' + XML(text) + '</w:t></w:r></w:p>';
}

function codeBlock(text) {
  const lines = XML(text).split('\n').map(l =>
    '<w:p><w:pPr><w:shd w:val="clear" w:fill="F1F5F9"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="1E293B"/></w:rPr><w:t xml:space="preserve">' + (l || ' ') + '</w:t></w:r></w:p>');
  return '<w:p><w:pPr><w:pStyle w:val="CodeBlock"/><w:keepNext/></w:pPr></w:p>' + lines.join('');
}

function table(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  const width = Math.floor(9000 / cols);
  let xml = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:color="CBD5E1"/>' +
    '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:color="CBD5E1"/>' +
    '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders></w:tblPr>';
  rows.forEach((row, ri) => {
    xml += '<w:tr>';
    for (let c = 0; c < cols; c++) {
      const cellText = row[c] || '';
      const header = ri === 0;
      const shd = header ? '<w:shd w:val="clear" w:fill="EEF2FF"/>' : '';
      const bold = header ? '<w:b/>' : '';
      xml += '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' + shd +
        '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr>' +
        '<w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>' +
        '<w:r><w:rPr>' + bold + '</w:rPr><w:t xml:space="preserve">' + XML(cellText) + '</w:t></w:r></w:p></w:tc>';
    }
    xml += '</w:tr>';
  });
  return xml + '</w:tbl><w:p/>';
}

function hr() {
  return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>';
}

function blocksToXml(blocks) {
  let body = '';
  for (const b of blocks) {
    switch (b.type) {
      case 'h1': body += heading(1, b.text); break;
      case 'h2': body += heading(2, b.text); break;
      case 'h3': body += heading(3, b.text); break;
      case 'h4': body += heading(4, b.text); break;
      case 'p': body += para(b.text); break;
      case 'quote': body += quote(b.text); break;
      case 'code': body += codeBlock(b.text); break;
      case 'hr': body += hr(); break;
      case 'table': body += table(b.rows); break;
      case 'ul': body += b.items.map(it => para(it, { prefix: '•  ', indent: 360 })).join(''); break;
      case 'ol': body += b.items.map((it, idx) => para(it, { prefix: (idx + 1) + '. ', indent: 360 })).join(''); break;
    }
  }
  return body;
}

/* ---------- 组装 .docx ---------- */
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:color w:val="20364D"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="CodeBlock"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="100" w:after="100"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>
</w:styles>`;

function mdToDocx(md, title, meta) {
  const blocks = parseBlocks(md);
  let body = blocksToXml(blocks);
  // 封面头
  const head = '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr>' +
    '<w:r><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="40"/></w:rPr><w:t xml:space="preserve">' + XML(title) + '</w:t></w:r></w:p>' +
    (meta ? '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>' +
      '<w:r><w:rPr><w:color w:val="667085"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">' + XML(meta) + '</w:t></w:r></w:p>' : '');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${head}${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`;
  return zipEntries([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(WORD_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES, 'utf8') }
  ]);
}

module.exports = { mdToDocx, parseBlocks, zipEntries };
