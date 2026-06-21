function fmtMoeda(v) { return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) }
function fmtData(d) { if(!d) return '-'; const p=d.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d }
function dataHoje() { return new Date().toISOString().split('T')[0] }

function getTema() { return localStorage.getItem('@ZAPBOT:tema') || 'dark' }
function aplicarTema(t) { document.documentElement.setAttribute('data-tema',t); localStorage.setItem('@ZAPBOT:tema',t) }
function aplicarTemaAtual() { aplicarTema(getTema()) }

function aviso(tipo, msg) {
  const ok  = document.getElementById('avisoOk')
  const err = document.getElementById('avisoErro')
  if (tipo==='ok') {
    if(err) err.style.display='none'
    if(ok)  { ok.textContent=msg; ok.style.display='block'; setTimeout(()=>ok.style.display='none',3200) }
  } else {
    if(ok)  ok.style.display='none'
    if(err) { err.textContent=msg; err.style.display='block'; setTimeout(()=>err.style.display='none',4000) }
  }
}

function confirmar(mensagem, callback, btnTexto) {
  const ex = document.getElementById('_confirmModal'); if(ex) ex.remove()
  const ov = document.createElement('div')
  ov.id = '_confirmModal'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center'
  ov.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px 28px 22px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.5)"> <div style="font-size:14px;font-weight:600;color:var(--fg);margin-bottom:22px;line-height:1.6">${mensagem}</div> <div style="display:flex;gap:10px;justify-content:flex-end"> <button id="_confirmNao" style="padding:9px 20px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--muted);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button> <button id="_confirmSim" style="padding:9px 20px;border-radius:8px;border:none;background:var(--red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${btnTexto||'Excluir'}</button> </div></div>`
  document.body.appendChild(ov)
  document.getElementById('_confirmSim').onclick = () => { ov.remove(); callback(true) }
  document.getElementById('_confirmNao').onclick = () => { ov.remove(); callback(false) }
  ov.onclick = e => { if(e.target===ov) { ov.remove(); callback(false) } }
}

function avisoModal(mensagem) {
  const ex = document.getElementById('_avisoModal'); if(ex) ex.remove()
  const ov = document.createElement('div')
  ov.id = '_avisoModal'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center'
  ov.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.5)"> <div style="font-size:14px;color:var(--fg);margin-bottom:18px;line-height:1.6">${mensagem}</div> <button id="_avisoOkBtn" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">OK</button> </div>`
  document.body.appendChild(ov)
  document.getElementById('_avisoOkBtn').onclick = () => ov.remove()
}
