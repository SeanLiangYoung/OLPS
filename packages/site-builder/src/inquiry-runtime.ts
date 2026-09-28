export function inquiryRuntimeScript(inquiryApiPath: string): string {
  return `<script id="olps-inquiry-runtime">
(() => {
  const endpoint = ${JSON.stringify(inquiryApiPath)};
  function bindForms() {
    for (const form of document.querySelectorAll('[data-olps-inquiry]')) {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void (async () => {
          const fd = new FormData(form);
          const payload = Object.fromEntries(fd.entries());
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error('inquiry failed');
          const status = form.querySelector('[data-olps-inquiry-status]');
          if (status) status.textContent = 'Submitted';
        })();
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindForms);
  } else {
    bindForms();
  }
})();
</script>`
}
