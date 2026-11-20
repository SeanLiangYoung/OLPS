(function () {
  function boot() {
    document.querySelectorAll('[data-olps-map-canvas]').forEach((node) => {
      const address = node.getAttribute('data-olps-map-address') || ''
      const key = node.getAttribute('data-olps-map-key') || ''
      if (!address || !key) {
        return
      }
      node.setAttribute('data-olps-map-ready', '1')
      node.textContent = address
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
