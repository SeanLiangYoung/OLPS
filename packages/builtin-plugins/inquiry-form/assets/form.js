(function () {
  function createEventId() {
    return window.crypto.randomUUID()
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

  function bindForm(form) {
    if (form.getAttribute('data-olps-bound') === '1') {
      return
    }
    form.setAttribute('data-olps-bound', '1')
    const errorNode = form.querySelector('[data-olps-inquiry-error]')
    let eventId = createEventId()
    let submitting = false
    form.addEventListener('input', () => {
      if (!submitting) eventId = createEventId()
    })

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (submitting) return
      submitting = true
      const buttons = form.querySelectorAll('button[type="submit"]')
      buttons.forEach(button => { button.disabled = true })
      if (errorNode) {
        errorNode.hidden = true
        errorNode.textContent = ''
      }

      const formData = new FormData(form)
      const payload = {
        fields: {
          name: String(formData.get('name') || ''),
          email: String(formData.get('email') || ''),
          message: String(formData.get('message') || ''),
        },
        privacyConsent: formData.get('privacyConsent') === 'on',
        locale: getLocale(),
        eventId,
        attribution: getAttribution(),
        consent: window.olps && typeof window.olps.getConsent === 'function' ? window.olps.getConsent() || { analytics: false, advertising: false } : { analytics: false, advertising: false },
        formId: form.getAttribute('data-olps-form-id'),
        target: JSON.parse(form.getAttribute('data-olps-target') || 'null'),
      }

      try {
        const endpoint = form.getAttribute('data-olps-inquiry-endpoint')
        if (!endpoint) throw new Error('询盘服务地址缺失')
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          throw new Error(`inquiry_submit_failed:${response.status}`)
        }
        if (form.getAttribute('data-olps-source') !== 'preview' && window.olps && typeof window.olps.emit === 'function') {
          window.olps.emit('inquiry_submit', { event_id: eventId })
        }
        const thankYouUrl = form.getAttribute('data-olps-thank-you-url')
        if (!thankYouUrl) throw new Error('提交结果页面地址缺失')
        window.location.assign(thankYouUrl)
      } catch (error) {
        if (errorNode) {
          errorNode.hidden = false
          errorNode.textContent = form.getAttribute('data-olps-submit-error') || 'Please check your connection and try submitting again.'
        }
      } finally {
        submitting = false
        buttons.forEach(button => { button.disabled = false })
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
