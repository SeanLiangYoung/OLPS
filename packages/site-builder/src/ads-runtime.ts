/** 注入到广告页发布 HTML 中的访客 Guide 运行时（悬浮、visited、后退截断）。 */
export function adsRuntimeScript(payloadJson: string, inquiryApiPath: string): string {
  return `<script id="olps-ads-data" type="application/json">${payloadJson.replace(/</g, '\\u003c')}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('olps-ads-data').textContent);
  const root = document.getElementById('olps-ads-root');
  if (!root) return;
  const params = new URLSearchParams(location.search);
  const keyword = params.get('kw') || root.getAttribute('data-kw') || data.keywordCluster[0];
  let currentId = data.guide.entryByKeyword[keyword] || data.guide.entryByKeyword[data.keywordCluster[0]];
  let visited = [];

  const panel = document.createElement('div');
  panel.setAttribute('data-olps-guide-float', '1');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:40;max-width:320px;background:#10231f;color:#f4fffb;padding:14px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:14px/1.4 system-ui,sans-serif;';
  document.body.appendChild(panel);

  const stage = document.createElement('section');
  stage.className = 'card';
  root.replaceWith(stage);

  function truncateVisitedAt(screenId) {
    const idx = visited.indexOf(screenId);
    if (idx >= 0) visited = visited.slice(0, idx + 1);
    else visited = [...visited, screenId];
  }

  function render() {
    const screen = data.screens.find((s) => s.screenId === currentId);
    if (!screen) throw new Error('screen missing: ' + currentId);
    if (!visited.includes(currentId)) visited.push(currentId);
    stage.innerHTML = screen.html;
    const node = data.guide.nodes[currentId] || { options: [] };
    const visible = node.options.filter((opt) => {
      if (opt.action === 'navigate' && opt.targetScreenId && visited.includes(opt.targetScreenId)) return false;
      return true;
    });
    panel.innerHTML = '<strong style="display:block;margin-bottom:8px;">Guide</strong>';
    if (visible.length === 0 && screen.role !== 'cta') {
      const btn = document.createElement('button');
      btn.textContent = 'Go to inquiry';
      btn.onclick = () => { currentId = data.screens.find((s) => s.role === 'cta').screenId; history.pushState({ screenId: currentId, visited: [...visited] }, ''); render(); };
      panel.appendChild(btn);
    }
    for (const opt of visible) {
      const btn = document.createElement('button');
      btn.style.cssText = 'display:block;width:100%;margin:6px 0;padding:8px 10px;border:0;border-radius:10px;background:#1f8f78;color:#fff;cursor:pointer;';
      btn.textContent = opt.label;
      btn.onclick = () => {
        if (opt.action === 'go_cta') {
          currentId = data.screens.find((s) => s.role === 'cta').screenId;
        } else if (opt.action === 'navigate') {
          currentId = opt.targetScreenId;
        }
        history.pushState({ screenId: currentId, visited: [...visited] }, '');
        render();
      };
      panel.appendChild(btn);
    }
    const form = stage.querySelector('[data-olps-inquiry]');
    if (form) {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void (async () => {
          const fd = new FormData(form);
          const payload = Object.fromEntries(fd.entries());
          const status = form.querySelector('[data-olps-inquiry-status]');
          const res = await fetch(${JSON.stringify(inquiryApiPath)}, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error('inquiry failed');
          if (status) status.textContent = 'Submitted';
        })();
      }, { once: true });
    }
  }

  window.addEventListener('popstate', (ev) => {
    if (ev.state && ev.state.screenId) {
      currentId = ev.state.screenId;
      visited = Array.isArray(ev.state.visited) ? [...ev.state.visited] : [];
      truncateVisitedAt(currentId);
      render();
    }
  });

  history.replaceState({ screenId: currentId, visited: [] }, '');
  render();
})();
</script>`
}
