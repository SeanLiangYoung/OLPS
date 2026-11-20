(function () {
  function bindButton(node) {
    if (node.getAttribute('data-olps-bound') === '1') {
      return
    }
    node.setAttribute('data-olps-bound', '1')
    node.addEventListener('click', () => {
      if (window.olps && typeof window.olps.emit === 'function') {
        window.olps.emit('whatsapp_click', {
          href: node.getAttribute('href') || '',
        })
      }
    })
  }

  function boot() {
    document.querySelectorAll('[data-olps-whatsapp-button]').forEach(bindButton)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
