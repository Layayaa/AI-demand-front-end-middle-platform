'use strict';
/* 通用 Markdown → Word(.docx) 转换脚本（复用 lib/docx.js）
   用法：node scripts/md2docx.js <输入.md> <输出.docx> "<标题>" "<副标题/元信息>"
   例：  node scripts/md2docx.js docs/a.md docs/a.docx "需求文档" "V1.0 · 2026-08-17" */
const fs = require('fs');
const path = require('path');
const { mdToDocx } = require('../lib/docx');

const [, , input, output, title, meta] = process.argv;
if (!input || !output) {
  console.error('用法: node scripts/md2docx.js <输入.md> <输出.docx> "<标题>" "<元信息>"');
  process.exit(1);
}
const md = fs.readFileSync(input, 'utf8');
const buf = mdToDocx(md, title || path.basename(input, '.md'), meta || '');
fs.writeFileSync(output, buf);
console.log(`已生成 ${output}（${(buf.length / 1024).toFixed(1)} KB）`);
