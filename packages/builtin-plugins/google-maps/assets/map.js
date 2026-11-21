(function () {
  function boot() {
    document.querySelectorAll('[data-olps-map-canvas]').forEach((node) => {
      const address = node.getAttribute('data-olps-map-location') || ''
      const key = node.getAttribute('data-olps-map-key') || ''
      const button=node.querySelector('[data-olps-map-load]')
      const content=node.querySelector('[data-olps-map-content]')
      if (!address || !key || !button || !content || node.hasAttribute('data-olps-map-bound')) {
        return
      }
      node.setAttribute('data-olps-map-bound','1')
      button.addEventListener('click',()=>{
        if(node.hasAttribute('data-olps-map-requested'))return
        const url=new URL('https://www.google.com/maps/embed/v1/place')
        url.searchParams.set('key',key)
        url.searchParams.set('q',address)
        if(document.documentElement.lang)url.searchParams.set('language',document.documentElement.lang)
        const frame=document.createElement('iframe')
        frame.title=node.getAttribute('data-olps-map-title')||'Google Maps'
        frame.width='600'
        frame.height='360'
        frame.style.cssText='width:100%;border:0;min-width:200px;min-height:200px;max-width:100%'
        frame.referrerPolicy='strict-origin-when-cross-origin'
        frame.allowFullscreen=true
        frame.src=url.href
        content.replaceChildren(frame)
        content.hidden=false
        button.hidden=true
        node.setAttribute('data-olps-map-requested','1')
      })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
