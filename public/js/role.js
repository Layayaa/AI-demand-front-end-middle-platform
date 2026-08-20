/* 界面角色：本期无登录，用本地选择区分两套前端 */
(function (global) {
  const KEY = 'reqhub.uiRole';
  const SUBMITTER = 'submitter';
  const REVIEWER = 'reviewer';

  function current() {
    return localStorage.getItem(KEY) === REVIEWER ? REVIEWER : SUBMITTER;
  }

  function isReviewer() {
    return current() === REVIEWER;
  }

  function set(role) {
    localStorage.setItem(KEY, role === REVIEWER ? REVIEWER : SUBMITTER);
    apply();
    window.dispatchEvent(new CustomEvent('ui-role-change'));
  }

  function apply() {
    const reviewer = isReviewer();
    document.documentElement.setAttribute('data-role', current());
    document.querySelectorAll('[data-for]').forEach((el) => {
      const allow = (el.getAttribute('data-for') || '').split(/\s+/);
      el.hidden = allow.indexOf(current()) === -1;
    });
    document.querySelectorAll('[data-role-set]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-role-set') === current());
    });
    const sub = document.getElementById('roleSub');
    if (sub) sub.textContent = reviewer ? '产品 / 业务评审' : '提需业务';
  }

  global.Role = { current, isReviewer, set, apply, SUBMITTER, REVIEWER };
})(window);
