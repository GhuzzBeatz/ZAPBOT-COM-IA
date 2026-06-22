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
      .ghz-support-card{--ghz-accent:${accent};width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding:10px;border-radius:14px;background:linear-gradient(145deg,#0b1220,#111827);border:1px solid rgba(148,163,184,.18);box-shadow:0 8px 22px rgba(0,0,0,.24);font-family:Arial,Helvetica,sans-serif;color:#fff;text-align:left}
      .ghz-support-floating{position:fixed;right:14px;bottom:14px;width:210px;z-index:2147483000}
      .ghz-support-head{display:flex;align-items:center;gap:9px;margin-bottom:9px;min-width:0}
      .ghz-support-logo{width:38px;height:38px;min-width:38px;border-radius:50%;overflow:hidden;background:#000;border:0;box-shadow:none}
      .ghz-support-logo img{width:100%;height:100%;display:block;object-fit:cover;border-radius:50%}
      .ghz-support-title{min-width:0}.ghz-support-title strong{display:block;color:#fff;font-size:13px;line-height:1.1}.ghz-support-title small{display:block;color:#aeb8c8;font-size:9px;margin-top:3px}
      .ghz-support-links{display:grid;gap:6px}.ghz-support-link{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 8px;border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;cursor:pointer}
      .ghz-support-link:hover{background:rgba(255,255,255,.075);border-color:var(--ghz-accent)}
      .ghz-support-icon{width:28px;height:28px;min-width:28px;border-radius:8px;background:color-mix(in srgb,var(--ghz-accent) 16%,transparent);color:var(--ghz-accent);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900}
      .ghz-support-copy{min-width:0}.ghz-support-copy small{display:block;color:#aeb8c8;font-size:8px;margin-bottom:1px}.ghz-support-copy strong{display:block;color:var(--ghz-accent);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ghz-support-status{display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08);color:#aeb8c8;font-size:8px;line-height:1.2}
      .ghz-support-dot{width:6px;height:6px;min-width:6px;border-radius:50%;background:var(--ghz-accent);box-shadow:0 0 7px color-mix(in srgb,var(--ghz-accent) 70%,transparent)}
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
        <a class="ghz-support-link" href="https://wa.me/5511948981459"><span class="ghz-support-icon">WA</span><span class="ghz-support-copy"><small>WhatsApp</small><strong>(11) 94898-1459</strong></span></a>
        <a class="ghz-support-link" href="https://ghzplugin.com.br"><span class="ghz-support-icon">WEB</span><span class="ghz-support-copy"><small>Site oficial</small><strong>ghzplugin.com.br</strong></span></a>
      </div>
      <div class="ghz-support-status"><span class="ghz-support-dot"></span>Atendimento e suporte para clientes</div>
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
