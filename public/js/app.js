/* 应用路由与启动 */
(function () {
  async function route() {
    const hash = location.hash || '#/dashboard';
    const parts = hash.slice(2).split('/'); // 去掉 '#/'
    const name = parts[0] || 'dashboard';
    const arg = parts.slice(1).join('/');
    const nav = document.getElementById('nav');
    const activeKey = name === 'req' || name === 'new' ? (name === 'new' ? 'new' : 'dashboard') : name;
    nav.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('data-nav') === activeKey));

    const main = document.getElementById('main');
    try {
      if (name === 'dashboard') await Views.dashboard.render();
      else if (name === 'new') {
        if (arg) await Views.intake.renderChat(arg);
        else await Views.intake.renderForm();
      }
      else if (name === 'req') {
        const rid = parts[1];
        const tabHint = parts[2];
        await Views.detail.render(rid, tabHint);
      }
      else if (name === 'priority') await Views.priority.render();
      else if (name === 'settings') await Views.settings.render();
      else { location.hash = '#/dashboard'; }
    } catch (e) {
      console.error(e);
      main.innerHTML = '<div class="card card-pad empty"><div class="big">⚠️</div>页面加载失败：' + UI.esc(e.message) + '<div class="mt12"><button class="btn btn-primary" onclick="location.hash=\'#/dashboard\'">返回工作台</button></div></div>';
    }
  }

  async function boot() {
    try {
      const h = await API.health();
      const s = await API.getSettings();
      const badge = document.getElementById('aiModeBadge');
      if (badge) badge.textContent = s.aiMode === 'llm' ? '🌐 大模型API模式' : '🤖 内置AI引擎';
    } catch (e) {
      document.getElementById('main').innerHTML = '<div class="card card-pad empty"><div class="big">📡</div>无法连接服务：' + UI.esc(e.message) + '<div class="mt12 muted text-sm">请确认已通过 <code>node server.js</code> 启动后端服务</div></div>';
      return;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
