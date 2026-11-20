(function () {
  function createEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return `inq_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  function getSiteId() {
    const value = document.documentElement.getAttribute('data-olps-site-id')
    return value && value.length > 0 ? value : 'preview'
  }

  function getLocale() {
    return document.documentElement.lang || 'en'
  }

  function getAttribution() {
    if (window.olps && typeof window.olps.getAttribution === 'function') {
      return window.olps.getAttribution()
    }
    return {}
  }

  function getConsent() {
    if (window.olps && typeof window.olps.getConsent === 'function') {
      return window.olps.getConsent()
    }
    return null
  }

  function bindForm(form) {
    if (form.getAttribute('data-olps-bound') === '1') {
      return
    }
    form.setAttribute('data-olps-bound', '1')
    const errorNode = form.querySelector('[data-olps-inquiry-error]')

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (errorNode) {
        errorNode.hidden = true
        errorNode.textContent = ''
      }

      const formData = new FormData(form)
      const eventId = createEventId()
      const payload = {
        name: String(formData.get('name') || ''),
        email: String(formData.get('email') || ''),
        message: String(formData.get('message') || ''),
        privacyConsent: formData.get('privacyConsent') === 'on',
        locale: getLocale(),
        eventId,
        attribution: getAttribution(),
        consent: getConsent(),
      }

      try {
        const response = await fetch(`/api/public/${getSiteId()}/inquiries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          throw new Error(`inquiry_submit_failed:${response.status}`)
        }
        if (window.olps && typeof window.olps.emit === 'function') {
          window.olps.emit('inquiry_submit', { event_id: eventId })
        }
        window.location.assign('/thank-you/')
      } catch (error) {
        if (errorNode) {
          errorNode.hidden = false
          errorNode.textContent =
            error instanceof Error ? error.message : 'inquiry_submit_failed'
        }
      }
    })
  }

  function boot() {
    document.querySelectorAll('form[data-olps-inquiry-form]').forEach(bindForm)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
