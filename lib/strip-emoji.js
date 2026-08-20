'use strict';
/* 去掉展示用表情符号。用 Unicode 属性转义，源码里不写 emoji 字符。 */

function stripEmoji(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE00-\uFE0F\u200D\u20E3]/g, '')
    .replace(/[\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF]/g, '');
}

function stripDeep(value) {
  if (typeof value === 'string') return stripEmoji(value);
  if (Array.isArray(value)) return value.map(stripDeep);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = stripDeep(value[k]); });
    return out;
  }
  return value;
}

module.exports = { stripEmoji, stripDeep };
