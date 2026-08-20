'use strict';
/* 测试用 Mock LLM（OpenAI 兼容 /chat/completions）
   用于在无真实 API Key 时验证混合模式编排：
   - 系统提示含「交付前自检」→ 返回带 2 个缺口的 JSON
   - 其余 → 返回通用澄清回复
   用法：node scripts/mock_llm.js [端口] （默认 3999） */
const http = require('http');

const PORT = parseInt(process.argv[2] || '3999', 10);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      let content = '好的，已记录。请继续补充下一条关键信息（mock）。';
      try {
        const payload = JSON.parse(body);
        const sys = (payload.messages || []).find(m => m.role === 'system');
        const sysText = (sys && sys.content) || '';
        if (sysText.includes('交付前自检')) {
          content = JSON.stringify({
            summary: '这是一个测试需求的画像总结：围绕业务判断建立规则化决策支持。',
            gaps: [
              { question: '该判断涉及金额上限时，是否需要走升级审批？', reason: '影响审批流与权限设计' },
              { question: '数据口径需要与财务部保持一致吗？', reason: '影响取数方案与字段映射' }
            ]
          });
        } else if (sysText.includes('连接测试')) {
          content = '连接成功';
        }
      } catch (e) { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`[mock-llm] http://127.0.0.1:${PORT} 已启动`));
