'use strict';
/* 极简 JSON 文件持久化：加载 + 原子写盘 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function defaultSettings() {
  return {
    aiMode: 'llm', // 'builtin' | 'llm'
    llm: {
      baseUrl: 'https://api.aicodemirror.ai/api/codex/backend-api/codex/v1',
      apiKey: '',
      model: 'gpt-5.5'
    },
    knowledge: {
      enabled: false,
      provider: 'local', // 'local' | 'ragflow' | 'http'
      mountPath: path.join(__dirname, '..', 'knowledge'),
      baseUrl: '',
      searchUrl: '',
      apiKey: '',
      datasetId: '',
      topK: 5,
      maxChars: 6000
    }
  };
}

function emptyDb() {
  return {
    settings: defaultSettings(),
    requirements: [],
    createdAt: new Date().toISOString()
  };
}

let db = null;

function load() {
  if (db) return db;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const defaults = defaultSettings();
      db.settings = {
        ...defaults,
        ...(db.settings || {}),
        llm: { ...defaults.llm, ...((db.settings && db.settings.llm) || {}) },
        knowledge: { ...defaults.knowledge, ...((db.settings && db.settings.knowledge) || {}) }
      };
      if (!db.requirements) db.requirements = [];
      return db;
    }
  } catch (e) {
    console.error('[db] 读取失败，重建空库:', e.message);
  }
  db = emptyDb();
  save();
  return db;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('[db] 写盘失败:', e.message);
  }
}

function reset() {
  db = emptyDb();
  save();
  return db;
}

module.exports = { load, save, reset, DB_FILE };
