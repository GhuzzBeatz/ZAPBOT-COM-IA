;(function mountGhzSupport() {
  const script = document.currentScript
  const targetSelector = script?.dataset.target || '.menu-footer, .sidebar-footer, .sidebar-foot'
  const accent = script?.dataset.accent || '#ff9900'
  const preserve = script?.dataset.preserve === 'true'
  const floating = script?.dataset.floating === 'true'

  function openExternal(url) {
    try {
      require('electron').shell.openExternal(url)
    } catch (e) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  function mount() {
    let target = document.querySelector(targetSelector)
    if (!target && floating) {
      target = document.createElement('div')
      target.className = 'ghz-support-floating'
      document.body.appendChild(target)
    }
    if (!target || target.querySelector('.ghz-support-card')) return

    if (!preserve) {
      target.querySelectorAll([
        '.menu-footer-brand', '.menu-footer-name', '.menu-footer-phone', '.menu-footer-site',
        '.footer-brand', '.footer-info', '.foot-brand', '.ghz-brand', '.version-txt',
        '.sidebar-brand', '.sidebar-brand-bottom', '.sidebar-brand-name',
        '.ghz-footer__support', '.ghz-footer__divider', '.ghz-footer__info'
      ].join(',')).forEach((element) => element.remove())
    }

    const style = document.createElement('style')
    style.textContent = `
      .ghz-support-card{--ghz-accent:${accent};width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;font-family:Arial,Helvetica,sans-serif;color:#fff;text-align:left;overflow:hidden}
      .ghz-support-floating{position:fixed;right:14px;bottom:14px;width:210px;box-sizing:border-box;padding:10px;background:#111827;z-index:2147483000}
      .ghz-support-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;min-width:0}
      .ghz-support-logo{width:42px;height:42px;min-width:42px;border-radius:50%;overflow:hidden;background:#000;border:0;box-shadow:none}
      .ghz-support-logo img{width:100%;height:100%;display:block;object-fit:cover;border-radius:50%}
      .ghz-support-title{min-width:0}.ghz-support-title strong{display:block;color:#fff;font-size:13px;line-height:1.1}.ghz-support-title small{display:block;color:#b8c0cc;font-size:9.5px;margin-top:2px}
      .ghz-support-links{display:grid;gap:6px}.ghz-support-link{display:flex;align-items:center;gap:7px;min-width:0;padding:6px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#fff;text-decoration:none;cursor:pointer;transition:background .2s,border-color .2s}
      .ghz-support-link:hover{background:color-mix(in srgb,var(--ghz-accent) 8%,transparent);border-color:color-mix(in srgb,var(--ghz-accent) 28%,transparent)}
      .ghz-support-icon{width:27px;height:27px;min-width:27px;border-radius:8px;background:color-mix(in srgb,var(--ghz-accent) 12%,transparent);display:flex;align-items:center;justify-content:center;font-size:13px}
      .ghz-support-copy{min-width:0}.ghz-support-copy small{display:block;color:#b8c0cc;font-size:8.5px;margin-bottom:1px}.ghz-support-copy strong{display:block;color:var(--ghz-accent);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `
    document.head.appendChild(style)

    const card = document.createElement('section')
    card.className = 'ghz-support-card'
    card.innerHTML = `
      <div class="ghz-support-head">
        <div class="ghz-support-logo"><img src="assets/ghz-logo.png" alt="Logo GHZ Plugin"></div>
        <div class="ghz-support-title"><strong>GHZ Plugin</strong><small>Suporte oficial</small></div>
      </div>
      <div class="ghz-support-links">
        <a class="ghz-support-link" href="https://wa.me/5511948981459"><span class="ghz-support-icon">&#128241;</span><span class="ghz-support-copy"><small>WhatsApp</small><strong>(11) 94898-1459</strong></span></a>
        <a class="ghz-support-link" href="https://ghzplugin.com.br"><span class="ghz-support-icon">&#127760;</span><span class="ghz-support-copy"><small>Site oficial</small><strong>ghzplugin.com.br</strong></span></a>
      </div>
    `
    card.querySelectorAll('a').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault()
      openExternal(link.href)
    }))
    target.appendChild(card)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
})()
