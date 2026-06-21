const SALT_ZB   = 'GHZ2026ZAPBOT'
const LS_KEY_ZB = '@ZAPBOT:licenca'
const PREFIX_ZB = 'ZAPBOT'

function gerarChaveZB(n) {
  const p1 = String(n).padStart(4, '0')
  const p2 = btoa(n + SALT_ZB).replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase()
  const p3 = String((n * 23) % 9999).padStart(4, '0')
  return `${PREFIX_ZB}-${p1}-${p2}-${p3}`
}

function validarChaveLocal(key) {
  const parts = key.split('-')
  if (parts.length !== 4 || parts[0] !== PREFIX_ZB) return false
  const n = parseInt(parts[1])
  if (isNaN(n)) return false
  return gerarChaveZB(n) === key
}

function validarChaveSupabase(key) {
  const parts = key.split('-')
  if (parts.length !== 5 || parts[0] !== PREFIX_ZB) return false
  return parts.slice(1).every(p => /^[A-F0-9]{4}$/.test(p))
}

function validarChaveZB(key) {
  if (!key) return false
  const clean = key.trim().toUpperCase()
  return validarChaveLocal(clean) || validarChaveSupabase(clean)
}

function licencaAtivaZB() {
  try { return validarChaveZB(localStorage.getItem(LS_KEY_ZB) || '') } catch(e) { return false }
}
function salvarLicencaZB(key) {
  localStorage.setItem(LS_KEY_ZB, key.trim().toUpperCase())
}
