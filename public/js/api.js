/* API 客户端 */
(function (global) {
  async function req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(path, opt);
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || ('请求失败 HTTP ' + res.status));
    return data;
  }
  global.API = {
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b || {}),
    put: (p, b) => req('PUT', p, b || {}),
    // 业务接口
    health: () => req('GET', '/api/health'),
    getSettings: () => req('GET', '/api/settings'),
    saveSettings: (s) => req('PUT', '/api/settings', s),
    testLLM: (llm) => req('POST', '/api/settings/test', { llm }),
    knowledgeStatus: () => req('GET', '/api/knowledge/status'),
    testKnowledge: (knowledge) => req('POST', '/api/knowledge/test', { knowledge }),
    searchKnowledge: (query) => req('POST', '/api/knowledge/search', { query }),
    listRequirements: () => req('GET', '/api/requirements'),
    createRequirement: (b) => req('POST', '/api/requirements', b),
    getRequirement: (id) => req('GET', '/api/requirements/' + encodeURIComponent(id)),
    chat: (id, message) => req('POST', '/api/requirements/' + encodeURIComponent(id) + '/chat', { message }),
    generatePlans: (id, tiers) => req('POST', '/api/requirements/' + encodeURIComponent(id) + '/plans', { tiers }),
    setStatus: (id, status, note) => req('POST', '/api/requirements/' + encodeURIComponent(id) + '/status', { status, note }),
    priority: () => req('GET', '/api/priority'),
    resetData: () => req('POST', '/api/data/reset'),
    seedData: () => req('POST', '/api/data/seed')
  };
})(window);
