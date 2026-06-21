const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const { spawn, execFileSync } = require('child_process')

app.setName('ZapBot IA')

const IA_HEAVY_MODEL_DEFAULT = 'qwen2.5:7b'
const MAX_LOGS = 500
const MAX_MEMORY_PER_NUMBER = 16
const MAX_RESUMO_PALAVRAS = 100
const DDG_ENDPOINT = 'https://api.duckduckgo.com/'

const IA_DEFAULTS = {
  enabled: true,
  mode: 'fallback_ai',
  ollama_url: 'http://127.0.0.1:11434',
  model: IA_HEAVY_MODEL_DEFAULT,
  temperature: 0.25,
  max_tokens: 380,
  internet_context: false,
  reply_delay_ms: 500,
  system_prompt:
    'Você é o assistente comercial do negócio. Responda em português do Brasil, curto, claro e educado. ' +
    'Não invente informações. Quando não tiver certeza, peça dados e ofereça encaminhar para atendimento humano.'
}

let cliente = null
let botStatus = 'desconectado'
let win = null
let logMsgs = []
let initTimer = null
let tentativas = 0

const processedMessageIds = new Set()
const filaPorChat = new Map()
let installProcess = null
let ollamaServeProcess = null
let modelsPreparePromise = null
let modelsPreparedPath = null
let runtimePreparePromise = null
let iaFilaGlobal = Promise.resolve()
let iaFilaPendentes = 0
const filaAvisoChat = new Map()

function getDataDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, 'data')
}

function garantirDataDir() {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function lerJSON(nome, padrao) {
  const f = path.join(garantirDataDir(), nome + '.json')
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    return padrao
  }
}

function salvarJSON(nome, dados) {
  const f = path.join(garantirDataDir(), nome + '.json')
  fs.writeFileSync(f, JSON.stringify(dados, null, 2), 'utf8')
}

function lerLeads() {
  const lista = lerJSON('leads', [])
  return Array.isArray(lista) ? lista : []
}

function salvarLeads(lista) {
  salvarJSON('leads', Array.isArray(lista) ? lista : [])
}

function lerLeadStates() {
  const st = lerJSON('lead_states', {})
  return st && typeof st === 'object' ? st : {}
}

function salvarLeadStates(st) {
  salvarJSON('lead_states', st && typeof st === 'object' ? st : {})
}

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '')
}

function normalizarNomePossivel(texto) {
  let v = String(texto || '').trim()
  if (!v) return ''
  v = v.replace(/\s+/g, ' ')
  if (v.length > 80) return ''
  if (/[0-9]{2,}/.test(v)) return ''
  if (v.includes('@')) return ''
  return v
}

function pareceSaudacao(texto) {
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return false
  const curtas = new Set([
    'oi',
    'ola',
    'opa',
    'e ai',
    'eae',
    'bom dia',
    'boa tarde',
    'boa noite',
    'ok',
    'blz',
    'tudo bem'
  ])
  return curtas.has(t)
}

function extrairNome(texto) {
  const t = String(texto || '').trim()
  if (!t) return ''
  const p =
    t.match(/(?:meu\s+nome(?:\s+completo)?\s*(?:é|e)?\s*[:\-]?\s*)(.+)$/i) ||
    t.match(/(?:nome(?:\s+completo)?\s*(?:é|e)?\s*[:\-]?\s*)(.+)$/i)
  if (p && p[1]) return normalizarNomePossivel(p[1])
  if (pareceSaudacao(t)) return ''
  return normalizarNomePossivel(t)
}

function extrairNomeComSeparadores(texto) {
  const bruto = String(texto || '').trim()
  if (!bruto) return ''

  const partes = bruto
    .split(/[\n,;|]+/)
    .map(p =>
      String(p || '')
        .replace(/^(nome|name)\s*[:\-]\s*/i, '')
        .trim()
    )
    .filter(Boolean)

  for (const parte of partes) {
    if (extrairEmail(parte)) continue
    if (extrairTelefone(parte)) continue
    const nome = normalizarNomePossivel(parte)
    if (!nome) continue
    if (partes.length > 1 && nome.split(' ').length < 2) continue
    return nome
  }
  return ''
}

function extrairEmail(texto) {
  const m = String(texto || '')
    .toLowerCase()
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  return m ? m[0] : ''
}

function extrairTelefone(texto) {
  const base = String(texto || '')
  const matches = base.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []
  for (const m of matches) {
    const d = soDigitos(m)
    if (d.length >= 10 && d.length <= 13) return d
  }
  return ''
}

function resumoAte100Palavras(texto) {
  const words = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (!words.length) return ''
  return words.slice(0, MAX_RESUMO_PALAVRAS).join(' ')
}

function textoTemConfirmacaoSim(texto) {
  const t = String(texto || '').trim().toLowerCase()
  return /^(sim|s|isso|pode ser|ok|certo|correto|pode)$/.test(t)
}

function textoTemConfirmacaoNao(texto) {
  const t = String(texto || '').trim().toLowerCase()
  return /^(nao|não|n|prefiro completar|quero completar|completar)$/.test(t)
}

function formatarDadosLead(lead) {
  const partes = []
  if (lead.nome) partes.push(`nome: ${lead.nome}`)
  if (lead.whatsapp) partes.push(`whatsapp: ${lead.whatsapp}`)
  if (lead.email) partes.push(`email: ${lead.email}`)
  return partes.join(' | ')
}

function sanitizarNomeEmpresa(nome) {
  return String(nome || '')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim()
    .slice(0, 80)
}

function extrairNomeEmpresaDoPrompt(prompt) {
  const txt = String(prompt || '')
  if (!txt) return ''
  const patterns = [
    /(?:no|do)\s+escrit[óo]rio\s+([^\n.]{2,100})/i,
    /(?:na|da)\s+empresa\s+([^\n.]{2,100})/i,
    /(?:no|do)\s+consult[óo]rio\s+([^\n.]{2,100})/i
  ]
  for (const p of patterns) {
    const m = txt.match(p)
    if (m && m[1]) {
      const nome = sanitizarNomeEmpresa(m[1])
      if (nome) return nome
    }
  }
  return ''
}

function montarMensagemBoasVindasLead() {
  const cfg = lerAIConfig()
  const empresa = extrairNomeEmpresaDoPrompt(cfg.system_prompt)
  if (empresa) {
    return `Ola, senhor(a)! Voce esta falando com ${empresa}. Para iniciar, informe por favor seu nome completo.`
  }
  return 'Ola, senhor(a)! Seja bem-vindo(a). Para iniciar, informe por favor seu nome completo.'
}

function montarMensagemColetaLead() {
  const cfg = lerAIConfig()
  const empresa = extrairNomeEmpresaDoPrompt(cfg.system_prompt)
  if (empresa) {
    return `Ola, tudo bem? Aqui e ${empresa}. Para iniciar seu atendimento, qual seu nome completo?`
  }
  return 'Ola, tudo bem? Para iniciar seu atendimento, qual seu nome completo?'
}

function montarPerguntaAssuntoLead(nomeOpcional) {
  const cfg = lerAIConfig()
  const empresa = extrairNomeEmpresaDoPrompt(cfg.system_prompt)
  const nomeTxt = nomeOpcional ? `, ${nomeOpcional}` : ''
  if (empresa) {
    return `Perfeito${nomeTxt}. Em que ${empresa} poderia ajudar voce hoje?`
  }
  return `Perfeito${nomeTxt}. Em que podemos ajudar voce hoje?`
}

function textoQuerPularEmail(texto) {
  const t = String(texto || '').trim().toLowerCase()
  return /^(pular|nao tenho|não tenho|sem email|sem e-mail|prefiro nao informar|prefiro não informar|nao quero informar|não quero informar|nao|não)$/.test(
    t
  )
}

function montarMensagemFinalLead() {
  const cfg = lerAIConfig()
  const empresa = extrairNomeEmpresaDoPrompt(cfg.system_prompt)
  if (empresa) {
    return `Obrigado. Seu atendimento foi registrado e a equipe humana de ${empresa} entrara em contato em breve.`
  }
  return 'Obrigado. Seu atendimento foi registrado e nossa equipe humana entrara em contato em breve.'
}

function normalizarAIConfig(raw) {
  const cfg = Object.assign({}, IA_DEFAULTS, raw && typeof raw === 'object' ? raw : {})
  cfg.enabled = !!cfg.enabled
  cfg.internet_context = !!cfg.internet_context
  cfg.mode = ['legacy_only', 'fallback_ai', 'prefer_ai'].includes(cfg.mode) ? cfg.mode : IA_DEFAULTS.mode
  cfg.ollama_url = String(cfg.ollama_url || IA_DEFAULTS.ollama_url).trim().replace(/\/+$/, '')
  if (cfg.ollama_url.endsWith(':1434')) cfg.ollama_url = cfg.ollama_url.replace(':1434', ':11434')
  if (cfg.ollama_url.endsWith(':1143')) cfg.ollama_url = cfg.ollama_url.replace(':1143', ':11434')
  cfg.model = String(cfg.model || IA_DEFAULTS.model).trim()
  if (cfg.model.toLowerCase() === 'qwen2.57b') cfg.model = 'qwen2.5:7b'
  if (cfg.model.toLowerCase() === 'qwen2.5-7b') cfg.model = 'qwen2.5:7b'
  cfg.temperature = Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : IA_DEFAULTS.temperature
  cfg.max_tokens = Number.isFinite(Number(cfg.max_tokens)) ? Number(cfg.max_tokens) : IA_DEFAULTS.max_tokens
  cfg.reply_delay_ms = Number.isFinite(Number(cfg.reply_delay_ms)) ? Number(cfg.reply_delay_ms) : IA_DEFAULTS.reply_delay_ms
  cfg.temperature = Math.max(0, Math.min(1.2, cfg.temperature))
  cfg.max_tokens = Math.max(80, Math.min(1200, Math.round(cfg.max_tokens)))
  cfg.reply_delay_ms = Math.max(0, Math.min(5000, Math.round(cfg.reply_delay_ms)))
  cfg.system_prompt = String(cfg.system_prompt || IA_DEFAULTS.system_prompt).trim() || IA_DEFAULTS.system_prompt
  return cfg
}

function lerAIConfig() {
  return normalizarAIConfig(lerJSON('ia_config', IA_DEFAULTS))
}

function salvarAIConfig(cfg) {
  const normalizado = normalizarAIConfig(cfg)
  salvarJSON('ia_config', normalizado)
  return normalizado
}

function lerMemoriaIA() {
  return lerJSON('ia_memory', {})
}

function salvarMemoriaIA(memoria) {
  salvarJSON('ia_memory', memoria || {})
}

function appendMemoriaIA(numero, pergunta, resposta) {
  const key = String(numero || '').replace(/\D/g, '')
  if (!key) return
  const mem = lerMemoriaIA()
  const lista = Array.isArray(mem[key]) ? mem[key] : []
  const now = new Date().toISOString()
  lista.push({ role: 'user', content: String(pergunta || '').slice(0, 2000), at: now })
  lista.push({ role: 'assistant', content: String(resposta || '').slice(0, 3000), at: now })
  mem[key] = lista.slice(-MAX_MEMORY_PER_NUMBER * 2)
  salvarMemoriaIA(mem)
}

function memoriaParaMensagens(numero) {
  const key = String(numero || '').replace(/\D/g, '')
  if (!key) return []
  const mem = lerMemoriaIA()
  const lista = Array.isArray(mem[key]) ? mem[key] : []
  return lista
    .slice(-MAX_MEMORY_PER_NUMBER * 2)
    .map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content || '').slice(0, 3000)
    }))
}

function limparMemoriaIA() {
  salvarMemoriaIA({})
}

function addLog(tipo, texto, numero) {
  const entrada = {
    id: Date.now(),
    tipo,
    texto,
    numero: numero || '',
    hora: new Date().toLocaleTimeString('pt-BR')
  }
  logMsgs.unshift(entrada)
  if (logMsgs.length > MAX_LOGS) logMsgs = logMsgs.slice(0, MAX_LOGS)
  enviarParaFrame('bot:log', entrada)
}

function emitirStatus(status, extra) {
  botStatus = status
  enviarParaFrame('bot:status', { status, ...extra })
}

function enviarParaFrame(canal, dados) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(canal, dados)
  } catch (e) {}
}

const UPDATE_MANIFEST_URL = process.env.ZAPBOT_IA_UPDATE_MANIFEST_URL
  || 'https://raw.githubusercontent.com/GhuzzBeatz/ZAPBOT-COM-IA/main/update-manifest.json'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_ALERT_DAYS = 7

function parseVersion(ver) {
  return String(ver || '0.0.0').split('.').map(n => parseInt(n, 10) || 0)
}

function compareVersion(a, b) {
  const av = parseVersion(a)
  const bv = parseVersion(b)
  const len = Math.max(av.length, bv.length)
  for (let i = 0; i < len; i++) {
    const ai = av[i] || 0
    const bi = bv[i] || 0
    if (ai > bi) return 1
    if (ai < bi) return -1
  }
  return 0
}

function getDefaultUpdateState() {
  return {
    manifest_url: UPDATE_MANIFEST_URL,
    last_checked_at: null,
    update_available: false,
    pending_version: null,
    pending_download_url: null,
    pending_release_url: null,
    pending_notes: null,
    first_detected_at: null,
    last_error: null
  }
}

let updateState = { ...getDefaultUpdateState(), ...lerJSON('update_state', {}) }

function saveUpdateState() {
  updateState.manifest_url = UPDATE_MANIFEST_URL
  salvarJSON('update_state', updateState)
}

function isUpdateActuallyAvailable() {
  const pendingVersion = String(updateState.pending_version || '').trim()
  return !!updateState.update_available
    && !!pendingVersion
    && compareVersion(pendingVersion, app.getVersion()) > 0
}

function getPendingDays() {
  if (!isUpdateActuallyAvailable() || !updateState.first_detected_at) return 0
  const firstSeen = new Date(updateState.first_detected_at).getTime()
  if (!Number.isFinite(firstSeen)) return 0
  return Math.floor((Date.now() - firstSeen) / (24 * 60 * 60 * 1000))
}

function getUpdatePayload() {
  const updateAvailable = isUpdateActuallyAvailable()
  const pendingDays = getPendingDays()
  const overdue = updateAvailable && pendingDays >= PENDING_ALERT_DAYS
  return {
    manifest_url: UPDATE_MANIFEST_URL,
    current_version: app.getVersion(),
    last_checked_at: updateState.last_checked_at,
    update_available: updateAvailable,
    pending_version: updateAvailable ? updateState.pending_version : null,
    pending_download_url: updateAvailable ? updateState.pending_download_url : null,
    pending_release_url: updateAvailable ? updateState.pending_release_url : null,
    pending_notes: updateAvailable ? updateState.pending_notes : null,
    first_detected_at: updateAvailable ? updateState.first_detected_at : null,
    pending_days: pendingDays,
    overdue,
    last_error: updateState.last_error
  }
}

function httpGetUtf8(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'zapbot-ia-updater' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(httpGetUtf8(res.headers.location))
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`Manifest HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('Timeout ao baixar manifesto')))
  })
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'zapbot-ia-updater' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(downloadFile(res.headers.location, destination))
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`Download HTTP ${res.statusCode}`))
        return
      }
      const file = fs.createWriteStream(destination)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(destination)))
      file.on('error', err => {
        try { fs.rmSync(destination, { force: true }) } catch {}
        reject(err)
      })
    })
    req.on('error', reject)
    req.setTimeout(30 * 60 * 1000, () => req.destroy(new Error('Timeout ao baixar instalador')))
  })
}

async function verificarAtualizacao(origem = 'manual') {
  const checkedAt = new Date().toISOString()
  try {
    const manifestUrl = UPDATE_MANIFEST_URL + (UPDATE_MANIFEST_URL.includes('?') ? '&' : '?') + '_t=' + Date.now()
    const manifest = JSON.parse(await httpGetUtf8(manifestUrl))
    const remoteVersion = String(manifest.version || '').trim()
    if (!remoteVersion) throw new Error('Manifesto sem campo version')

    const hasUpdate = compareVersion(remoteVersion, app.getVersion()) > 0
    if (hasUpdate) {
      const samePendingVersion = updateState.pending_version === remoteVersion
      updateState.update_available = true
      updateState.pending_version = remoteVersion
      updateState.pending_download_url = manifest.url || manifest.download_url || null
      updateState.pending_release_url = manifest.release_url || null
      updateState.pending_notes = manifest.notes || null
      updateState.first_detected_at = samePendingVersion && updateState.first_detected_at
        ? updateState.first_detected_at
        : checkedAt
    } else {
      updateState = { ...getDefaultUpdateState(), last_checked_at: checkedAt }
    }
    updateState.last_checked_at = checkedAt
    updateState.last_error = null
    saveUpdateState()
    enviarParaFrame('update:state', getUpdatePayload())
    return { ok: true, origem, ...getUpdatePayload() }
  } catch (err) {
    updateState.last_checked_at = checkedAt
    updateState.last_error = err.message || String(err)
    saveUpdateState()
    enviarParaFrame('update:state', getUpdatePayload())
    return { ok: false, origem, erro: updateState.last_error, ...getUpdatePayload() }
  }
}

async function verificarAtualizacaoSemanalNoStartup() {
  const lastCheck = updateState.last_checked_at ? new Date(updateState.last_checked_at).getTime() : 0
  if (!lastCheck || Date.now() - lastCheck >= WEEK_MS) {
    await verificarAtualizacao('startup-weekly')
  } else {
    enviarParaFrame('update:state', getUpdatePayload())
  }
}

async function iniciarFluxoAtualizacao() {
  const check = await verificarAtualizacao('install-precheck')
  if (!check.ok) {
    return { ok: false, erro: `Nao foi possivel confirmar a nova versao: ${check.erro}`, ...getUpdatePayload() }
  }
  if (!isUpdateActuallyAvailable()) {
    return { ok: false, erro: 'O ZapBot IA ja esta atualizado.', ...getUpdatePayload() }
  }
  const target = updateState.pending_download_url || updateState.pending_release_url
  if (!target) return { ok: false, erro: 'Manifesto sem URL de download.', ...getUpdatePayload() }

  try {
    enviarParaFrame('update:progress', { text: 'Preservando o Ollama local antes da atualizacao...' })
    await preparePersistentOllamaForUpdate()
  } catch (err) {
    return { ok: false, erro: `Nao foi possivel preservar o Ollama: ${err.message}`, ...getUpdatePayload() }
  }

  const updatesDir = path.join(app.getPath('temp'), 'zapbot_ia_updates')
  if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true })
  const version = updateState.pending_version || 'latest'
  const installerPath = path.join(updatesDir, `ZapBot-IA-Update-${version}.exe`)
  enviarParaFrame('update:progress', { text: 'Baixando atualizacao do app, WhatsApp e Chromium...' })
  await downloadFile(target, installerPath)
  spawn(installerPath, [], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 700)
  return { ok: true, baixado_em: installerPath }
}

function pararTimers() {
  if (initTimer) {
    clearTimeout(initTimer)
    initTimer = null
  }
}

function encontrarChrome() {
  const asarUnpackedBase = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname)

  const puppeteerPaths = [
    path.join(asarUnpackedBase, 'node_modules', 'puppeteer', '.local-chromium'),
    path.join(asarUnpackedBase, 'node_modules', 'puppeteer-core', '.local-chromium'),
    path.join(asarUnpackedBase, 'node_modules', 'puppeteer', '.local-chrome')
  ]

  for (const base of puppeteerPaths) {
    try {
      if (!fs.existsSync(base)) continue
      const plataformas = fs.readdirSync(base)
      for (const plat of plataformas) {
        const platDir = path.join(base, plat)
        const candidatos = [
          path.join(platDir, 'chrome-win', 'chrome.exe'),
          path.join(platDir, 'chrome-win64', 'chrome.exe'),
          path.join(platDir, 'chrome-linux', 'chrome'),
          path.join(platDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
        ]
        for (const c of candidatos) if (fs.existsSync(c)) return c
      }
    } catch (e) {}
  }

  const sistema = [
    path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join('C:', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join('C:', 'Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join('C:', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ]
  for (const c of sistema) {
    try {
      if (fs.existsSync(c)) return c
    } catch (e) {}
  }
  return null
}

function createWindow() {
  garantirDataDir()

  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'ZapBot IA',
    backgroundColor: '#0d1a0d',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d1a0d',
      symbolColor: '#e8f0e8',
      height: 34
    },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      webSecurity: false
    }
  })

  win.loadFile('index.html')
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  setTimeout(() => {
    if (win && !win.isVisible()) win.show()
  }, 4000)
  win.on('page-title-updated', e => e.preventDefault())
  win.on('closed', () => {
    pararTimers()
    win = null
  })
}

function gerarIdMensagem(msg) {
  if (msg?.id?._serialized) return msg.id._serialized
  const base = [msg?.from, msg?.timestamp, msg?.type, msg?.body].filter(Boolean).join('|')
  return base || String(Date.now())
}

function getBundledOllamaSetupPath() {
  const candidatos = []
  if (app.isPackaged) {
    candidatos.push(path.join(process.resourcesPath, 'ollama', 'OllamaSetup.exe'))
    candidatos.push(path.join(path.dirname(process.execPath), 'OllamaSetup.exe'))
    candidatos.push(path.join(process.resourcesPath, '..', 'OllamaSetup.exe'))
  } else {
    candidatos.push(path.join(__dirname, 'vendor', 'ollama', 'OllamaSetup.exe'))
  }
  for (const p of candidatos) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {}
  }
  return candidatos[0]
}

function getBundledOllamaBinaryCandidates() {
  if (app.isPackaged) {
    return [
      path.join(app.getPath('userData'), 'ollama-runtime', 'ollama.exe'),
      path.join(process.resourcesPath, 'ollama-runtime', 'ollama.exe'),
      path.join(process.resourcesPath, 'ollama', 'runtime', 'ollama.exe'),
      path.join(path.dirname(process.execPath), 'runtime', 'ollama.exe')
    ]
  }
  return [
    path.join(__dirname, 'vendor', 'ollama', 'runtime', 'ollama.exe')
  ]
}

function getBundledModelsCandidates() {
  if (app.isPackaged) {
    return [
      path.join(app.getPath('userData'), 'ollama-models'),
      path.join(process.resourcesPath, 'ollama', 'models')
    ]
  }
  return [
    path.join(app.getPath('userData'), 'ollama-models'),
    path.join(__dirname, 'vendor', 'ollama', 'models')
  ]
}

function getBundledModelsPackCandidates() {
  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, 'ollama-models-pack'),
      path.join(process.resourcesPath, 'ollama', 'models-pack')
    ]
  }
  return [path.join(__dirname, 'vendor', 'ollama', 'models-pack')]
}

function resolveBundledModelsPackPath() {
  for (const p of getBundledModelsPackCandidates()) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {}
  }
  return null
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function statSize(file) {
  try {
    return fs.statSync(file).size
  } catch (e) {
    return -1
  }
}

async function copyFileStream(src, dst) {
  await new Promise((resolve, reject) => {
    ensureDirSync(path.dirname(dst))
    const read = fs.createReadStream(src)
    const write = fs.createWriteStream(dst)
    read.on('error', reject)
    write.on('error', reject)
    write.on('finish', resolve)
    read.pipe(write)
  })
}

async function concatParts(partPaths, dst) {
  ensureDirSync(path.dirname(dst))
  const tmp = `${dst}.tmp`
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true })

  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(tmp)
    let idx = 0

    const pipeNext = () => {
      if (idx >= partPaths.length) {
        write.end()
        return
      }
      const rs = fs.createReadStream(partPaths[idx])
      rs.on('error', reject)
      rs.on('end', () => {
        idx += 1
        pipeNext()
      })
      rs.pipe(write, { end: false })
    }

    write.on('error', reject)
    write.on('finish', resolve)
    pipeNext()
  })

  if (fs.existsSync(dst)) fs.rmSync(dst, { force: true })
  fs.renameSync(tmp, dst)
}

async function ensureBundledModelsReady() {
  if (modelsPreparedPath && fs.existsSync(modelsPreparedPath)) return modelsPreparedPath
  if (modelsPreparePromise) return modelsPreparePromise

  modelsPreparePromise = (async () => {
    const runtimeDir = path.join(app.getPath('userData'), 'ollama-models')

    const packDir = resolveBundledModelsPackPath()
    const manifestPath = packDir ? path.join(packDir, 'parts-manifest.json') : null

    if (!manifestPath || !fs.existsSync(manifestPath)) {
      for (const p of getBundledModelsCandidates()) {
        try {
          if (fs.existsSync(p)) {
            modelsPreparedPath = p
            return p
          }
        } catch (e) {}
      }
      modelsPreparedPath = null
      return null
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const files = Array.isArray(manifest?.files) ? manifest.files : []

    ensureDirSync(runtimeDir)

    for (const item of files) {
      const rel = String(item.path || '').replace(/\//g, path.sep)
      if (!rel) continue
      const dst = path.join(runtimeDir, rel)
      const expected = Number(item.size || 0)
      if (expected > 0 && statSize(dst) === expected) continue

      if (Array.isArray(item.parts) && item.parts.length) {
        const parts = item.parts.map(p =>
          path.join(packDir, String(p.file || '').replace(/\//g, path.sep))
        )
        const missing = parts.find(p => !fs.existsSync(p))
        if (missing) throw new Error(`Parte do modelo não encontrada: ${missing}`)
        await concatParts(parts, dst)
      } else {
        const src = path.join(packDir, rel)
        if (!fs.existsSync(src)) throw new Error(`Arquivo do modelo não encontrado: ${src}`)
        await copyFileStream(src, dst)
      }

      if (expected > 0 && statSize(dst) !== expected) {
        throw new Error(`Falha ao preparar modelo local em: ${item.path}`)
      }
    }

    modelsPreparedPath = runtimeDir
    return runtimeDir
  })()

  try {
    return await modelsPreparePromise
  } finally {
    modelsPreparePromise = null
  }
}

function resolveBundledModelsPath() {
  return modelsPreparedPath
}

async function copyDirectoryIncremental(srcDir, dstDir) {
  ensureDirSync(dstDir)
  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name)
    const dst = path.join(dstDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryIncremental(src, dst)
      continue
    }
    if (!entry.isFile()) continue
    const srcStat = await fs.promises.stat(src)
    if (statSize(dst) === srcStat.size) continue
    await copyFileStream(src, dst)
  }
}

async function ensurePersistentOllamaRuntime() {
  if (!app.isPackaged) return path.join(__dirname, 'vendor', 'ollama', 'runtime')
  if (runtimePreparePromise) return runtimePreparePromise

  runtimePreparePromise = (async () => {
    const destination = path.join(app.getPath('userData'), 'ollama-runtime')
    const destinationExe = path.join(destination, 'ollama.exe')
    const readyMarker = path.join(destination, '.zapbot-ia-runtime-ready')
    if (fs.existsSync(destinationExe) && fs.existsSync(readyMarker)) return destination

    const sources = [
      path.join(process.resourcesPath, 'ollama-runtime'),
      path.join(process.resourcesPath, 'ollama', 'runtime')
    ]
    const source = sources.find(candidate => fs.existsSync(path.join(candidate, 'ollama.exe')))
    if (!source) {
      if (fs.existsSync(destinationExe)) return destination
      throw new Error('runtime embutido nao encontrado')
    }

    await copyDirectoryIncremental(source, destination)
    if (!fs.existsSync(destinationExe)) throw new Error('copia do runtime ficou incompleta')
    fs.writeFileSync(readyMarker, new Date().toISOString(), 'utf8')
    return destination
  })()

  try {
    return await runtimePreparePromise
  } finally {
    runtimePreparePromise = null
  }
}

async function preparePersistentOllamaForUpdate() {
  await ensureBundledModelsReady()
  await ensurePersistentOllamaRuntime()
}

function getOllamaBinaryCandidates() {
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return [
    path.join(localApp, 'Programs', 'Ollama', 'ollama.exe'),
    path.join('C:', 'Program Files', 'Ollama', 'ollama.exe')
  ]
}

async function findOllamaBinary() {
  for (const p of getBundledOllamaBinaryCandidates()) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {}
  }

  const whereCmd = process.platform === 'win32' ? 'where' : 'which'
  const cli = await execCommand(whereCmd, ['ollama'], 5000)
  if (cli.ok && cli.stdout) {
    const p = cli.stdout.trim().split(/\r?\n/)[0].trim()
    if (p) return p
  }
  for (const p of getOllamaBinaryCandidates()) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {}
  }
  return null
}

async function isOllamaApiOnline(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base) return false
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    const r = await fetch(`${base}/api/tags`, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok
  } catch (e) {
    return false
  }
}

async function startOllamaServeIfNeeded(cfg) {
  const base = String(cfg?.ollama_url || IA_DEFAULTS.ollama_url).replace(/\/+$/, '')
  if (await isOllamaApiOnline(base)) return { ok: true, started: false }
  if (ollamaServeProcess) return { ok: true, started: false }
  const bin = await findOllamaBinary()
  if (!bin) return { ok: false, erro: 'Ollama runtime não encontrado.' }
  let modelsPath = null
  try {
    modelsPath = await ensureBundledModelsReady()
  } catch (e) {
    addLog('erro', `[IA] Falha ao preparar modelo local: ${e?.message || String(e)}`)
  }

  try {
    const env = Object.assign({}, process.env)
    if (modelsPath) env.OLLAMA_MODELS = modelsPath
    ollamaServeProcess = spawn(bin, ['serve'], { windowsHide: true, detached: false, env })
    ollamaServeProcess.on('exit', () => {
      ollamaServeProcess = null
    })
  } catch (e) {
    ollamaServeProcess = null
    return { ok: false, erro: e.message }
  }

  for (let i = 0; i < 20; i++) {
    await esperar(500)
    if (await isOllamaApiOnline(base)) return { ok: true, started: true }
  }
  return { ok: false, erro: 'Ollama não iniciou a API local.' }
}

async function installBundledOllamaRuntimeIfNeeded() {
  const bin = await findOllamaBinary()
  if (bin) return { ok: true, already: true, path: bin }

  for (const p of getBundledOllamaBinaryCandidates()) {
    try {
      if (fs.existsSync(p)) return { ok: true, already: true, path: p }
    } catch (e) {}
  }

  const setup = getBundledOllamaSetupPath()
  if (!fs.existsSync(setup)) {
    return {
      ok: false,
      erro: 'Instalador Ollama não encontrado. Deixe o arquivo OllamaSetup.exe na mesma pasta do ZapBot.'
    }
  }
  addLog('sistema', '[IA] Instalando runtime Ollama embutido (fallback)...')
  const argsTry = [
    ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
    ['/S']
  ]
  let last = null
  for (const args of argsTry) {
    const r = await execCommand(setup, args, 180000)
    last = r
    const found = await findOllamaBinary()
    if (found) return { ok: true, installed: true, path: found }
  }
  return { ok: false, erro: 'Falha ao instalar runtime do Ollama.', detalhe: last?.stderr || last?.error || '' }
}

function jaProcessada(id) {
  if (!id) return false
  if (processedMessageIds.has(id)) return true
  processedMessageIds.add(id)
  if (processedMessageIds.size > 5000) processedMessageIds.clear()
  return false
}

function enfileirar(chatId, fn) {
  const atual = filaPorChat.get(chatId) || Promise.resolve()
  const prox = atual
    .then(() => fn())
    .catch(err => addLog('erro', `[FILA] ${err?.message || String(err)}`))
    .finally(() => {
      if (filaPorChat.get(chatId) === prox) filaPorChat.delete(chatId)
    })
  filaPorChat.set(chatId, prox)
  return prox
}

async function esperar(ms) {
  if (!ms || ms <= 0) return
  await new Promise(r => setTimeout(r, ms))
}

async function responderMensagem(msg, texto, numero, origem) {
  const resposta = String(texto || '').trim()
  if (!resposta) return false
  await msg.reply(resposta.slice(0, 3500))
  addLog('enviado', `[${origem}] ${resposta}`, numero)
  return true
}

function limparAvisoFila(chatId) {
  filaAvisoChat.delete(String(chatId || ''))
}

async function responderAguardandoFila(msg, numero) {
  const chatId = String(msg?.from || '')
  if (!chatId) return
  const last = Number(filaAvisoChat.get(chatId) || 0)
  const now = Date.now()
  if (now - last < 45000) return
  filaAvisoChat.set(chatId, now)
  await responderMensagem(
    msg,
    'Recebi sua mensagem. Estou finalizando outro atendimento e já te respondo.',
    numero,
    'fila_espera'
  )
}

function atualizarStateComDados(state, texto, numeroOrigem) {
  const email = extrairEmail(texto)
  const nome = extrairNome(texto) || extrairNomeComSeparadores(texto)

  if (email && !state.lead.email) state.lead.email = email
  if (nome && !state.lead.nome) state.lead.nome = nome
  if (numeroOrigem) state.lead.whatsapp = soDigitos(numeroOrigem)
}

function salvarLeadConsolidado(numero, state) {
  const lista = lerLeads()
  const novo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    criado_em: new Date().toISOString(),
    numero_origem: numero,
    nome_completo: state.lead.nome || '',
    whatsapp: state.lead.whatsapp || '',
    email: state.lead.email || '',
    resumo_conversa: resumoAte100Palavras(state.resumo || ''),
    resumo_bruto: String(state.resumo || '').slice(0, 3000)
  }
  lista.unshift(novo)
  salvarLeads(lista.slice(0, 5000))
  addLog('sistema', `[LEAD] Registrado lead de ${numero}`)
  return novo
}

async function processarFluxoLead(msg, numero, texto) {
  const states = lerLeadStates()
  const key = String(numero || '')
  const atual = states[key] || {
    step: 'ask_name',
    lead: { nome: '', whatsapp: '', email: '' },
    resumo: '',
    apresentado: false,
    criado_em: new Date().toISOString()
  }

  const legacyStep = ['ask_data', 'confirm_data', 'ask_summary', 'collect_ident'].includes(atual.step)
  if (legacyStep) {
    atual.step = 'ask_name'
    atual.lead = { nome: '', whatsapp: '', email: '' }
    atual.resumo = ''
    atual.apresentado = false
    delete atual.chatNumero
  } else if (atual.step === 'ask_summary') {
    atual.step = 'ask_need'
  }

  if (!['ask_name', 'ask_email', 'ask_need'].includes(atual.step)) {
    if (atual.step === 'done') {
      const doneAt = Number(atual.doneAt || 0)
      const emMenosDe24h = doneAt > 0 && Date.now() - doneAt < 24 * 60 * 60 * 1000
      if (emMenosDe24h) {
        states[key] = atual
        salvarLeadStates(states)
        return { handled: false }
      }
    }
    atual.step = 'ask_name'
    atual.lead = { nome: '', whatsapp: '', email: '' }
    atual.resumo = ''
    atual.apresentado = false
  }

  if (atual.step === 'ask_name') {
    if (!atual.apresentado) {
      atual.apresentado = true
      states[key] = atual
      salvarLeadStates(states)
      await responderMensagem(msg, montarMensagemColetaLead(), numero, 'lead_boas_vindas')
      return { handled: true }
    }

    if (pareceSaudacao(texto) && !atual.lead.nome) {
      states[key] = atual
      salvarLeadStates(states)
      await responderMensagem(
        msg,
        'Perfeito. Para iniciar, me informe seu nome completo.',
        numero,
        'lead_pedir_nome'
      )
      return { handled: true }
    }

    const nome = extrairNome(texto) || extrairNomeComSeparadores(texto)
    if (!nome || nome.split(' ').length < 2) {
      states[key] = atual
      salvarLeadStates(states)
      await responderMensagem(
        msg,
        'Nao consegui identificar seu nome completo. Pode me informar nome e sobrenome?',
        numero,
        'lead_pedir_nome_novamente'
      )
      return { handled: true }
    }

    atual.lead.nome = nome
    atual.lead.whatsapp = soDigitos(numero)
    atual.step = 'ask_email'
    states[key] = atual
    salvarLeadStates(states)
    await responderMensagem(
      msg,
      'Obrigado. Qual seu e-mail? Se preferir nao informar, responda PULAR.',
      numero,
      'lead_pedir_email'
    )
    return { handled: true }
  }

  if (atual.step === 'ask_email') {
    const email = extrairEmail(texto)
    if (email) atual.lead.email = email
    if (!email && !textoQuerPularEmail(texto)) {
      states[key] = atual
      salvarLeadStates(states)
      await responderMensagem(
        msg,
        'Nao consegui identificar o e-mail. Envie um e-mail valido ou responda PULAR.',
        numero,
        'lead_email_invalido'
      )
      return { handled: true }
    }
    atual.step = 'ask_need'
    states[key] = atual
    salvarLeadStates(states)
    await responderMensagem(msg, montarPerguntaAssuntoLead(atual.lead.nome || ''), numero, 'lead_pergunta_assunto')
    return { handled: true }
  }

  if (atual.step === 'ask_need') {
    const resumo = resumoAte100Palavras(texto)
    atual.resumo = resumo || String(texto || '')
    salvarLeadConsolidado(numero, atual)
    states[key] = {
      step: 'done',
      doneAt: Date.now(),
      lead: atual.lead,
      resumo: atual.resumo
    }
    salvarLeadStates(states)
    await responderMensagem(
      msg,
      montarMensagemFinalLead(),
      numero,
      'lead_finalizado'
    )
    return { handled: true, concluido: true }
  }

  states[key] = atual
  salvarLeadStates(states)
  return { handled: false }
}

function avaliarHorario(config) {
  if (!config?.horario_ativo) return { ok: true }
  const agora = new Date()
  const hora = agora.getHours() * 60 + agora.getMinutes()
  const [hI, mI] = String(config.horario_inicio || '08:00').split(':').map(Number)
  const [hF, mF] = String(config.horario_fim || '18:00').split(':').map(Number)
  const dias = Array.isArray(config.dias_ativos) ? config.dias_ativos : [1, 2, 3, 4, 5]
  const dentro = dias.includes(agora.getDay()) && hora >= hI * 60 + mI && hora < hF * 60 + mF
  return { ok: dentro }
}

function acharRespostaRegras(texto, numero, isGrupo) {
  const config = lerJSON('config', {})
  const iaCfg = lerAIConfig()
  const grupoBloqueado = isGrupo && config.responder_grupos === false
  if (grupoBloqueado && (!iaCfg.enabled || iaCfg.mode === 'legacy_only')) {
    return { bloqueado: true, motivo: 'grupo_bloqueado' }
  }

  const blacklist = lerJSON('blacklist', [])
  if (blacklist.some(b => numero.endsWith(String(b.numero || '').replace(/\D/g, '')))) {
    return { bloqueado: true, motivo: 'blacklist' }
  }

  const horario = avaliarHorario(config)
  if (!horario.ok) {
    return {
      resposta: String(config.msg_fora_horario || 'Olá! Estamos fora do horário. Retornamos em breve!'),
      origem: 'fora_horario'
    }
  }

  const respostas = lerJSON('respostas', [])
  const textoLow = texto.toLowerCase()
  for (const r of respostas.filter(r => r && r.ativo)) {
    const gatilho = String(r.gatilho || '').toLowerCase()
    if (!gatilho) continue
    const palavras = gatilho.split(',').map(p => p.trim()).filter(Boolean)
    const match = r.exato
      ? palavras.some(p => textoLow === p)
      : palavras.some(p => textoLow.includes(p))
    if (match) return { resposta: String(r.resposta || ''), origem: 'regra' }
  }

  const menus = lerJSON('menus', [])
  const menuAtivo = menus.find(m => m && m.ativo)
  if (!menuAtivo) return { resposta: null, origem: null }

  const opcao = parseInt(texto, 10)
  if (!Number.isNaN(opcao) && opcao >= 1) {
    const op = (menuAtivo.opcoes || []).find(o => Number(o.numero) === opcao)
    if (op?.resposta) return { resposta: String(op.resposta), origem: `menu_${opcao}` }
  }

  if (!menuAtivo.mensagem_boas_vindas) return { resposta: null, origem: null }

  let txt = String(menuAtivo.mensagem_boas_vindas || '') + '\n\n'
  for (const op of menuAtivo.opcoes || []) txt += `*${op.numero}* - ${op.titulo}\n`
  if (menuAtivo.rodape) txt += '\n' + String(menuAtivo.rodape)
  return { resposta: txt, origem: 'menu_principal' }
}

async function buscarContextoInternet(pergunta) {
  const q = String(pergunta || '').trim()
  if (!q || q.length < 4) return ''
  try {
    const u = new URL(DDG_ENDPOINT)
    u.searchParams.set('q', q)
    u.searchParams.set('format', 'json')
    u.searchParams.set('no_redirect', '1')
    u.searchParams.set('no_html', '1')
    u.searchParams.set('skip_disambig', '1')
    u.searchParams.set('kl', 'br-pt')
    const ctl = new AbortController()
    const timeout = setTimeout(() => ctl.abort(), 7000)
    const r = await fetch(u.toString(), { signal: ctl.signal })
    clearTimeout(timeout)
    if (!r.ok) return ''
    const j = await r.json()
    const linhas = []
    if (j.AbstractText) linhas.push(j.AbstractText)
    if (Array.isArray(j.RelatedTopics)) {
      for (const item of j.RelatedTopics) {
        if (linhas.length >= 3) break
        if (item?.Text) linhas.push(item.Text)
        if (Array.isArray(item?.Topics)) {
          for (const sub of item.Topics) {
            if (linhas.length >= 3) break
            if (sub?.Text) linhas.push(sub.Text)
          }
        }
      }
    }
    return linhas.slice(0, 3).join('\n')
  } catch (e) {
    return ''
  }
}

async function chamarOllama(messages, cfg) {
  const base = String(cfg.ollama_url || IA_DEFAULTS.ollama_url).replace(/\/+$/, '')
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 65000)
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages,
        options: {
          temperature: cfg.temperature,
          num_predict: cfg.max_tokens
        }
      })
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      throw new Error(`HTTP ${r.status}${txt ? `: ${txt.slice(0, 160)}` : ''}`)
    }
    const j = await r.json()
    const content = String(j?.message?.content || j?.response || '').trim()
    return content
  } finally {
    clearTimeout(timeout)
  }
}

async function executarNaFilaIA(fn) {
  iaFilaPendentes += 1
  const anterior = iaFilaGlobal
  let liberar
  iaFilaGlobal = new Promise(resolve => {
    liberar = resolve
  })
  try {
    await anterior
    return await fn()
  } finally {
    iaFilaPendentes = Math.max(0, iaFilaPendentes - 1)
    liberar()
  }
}

async function gerarRespostaIA(numero, pergunta) {
  const cfg = lerAIConfig()
  if (!cfg.enabled || cfg.mode === 'legacy_only') return null
  let start = await startOllamaServeIfNeeded(cfg)
  if (!start.ok) {
    const install = await installBundledOllamaRuntimeIfNeeded()
    if (install.ok) {
      addLog('sistema', '[IA] Runtime instalado automaticamente.')
      start = await startOllamaServeIfNeeded(cfg)
    }
  }
  if (!start.ok) throw new Error(start.erro || 'IA local indisponível')

  const mensagens = [{ role: 'system', content: cfg.system_prompt }]

  const regrasResumo =
    'Contexto operacional: responda como atendimento de empresa. ' +
    'Se o usuário pedir humano, diga que vai encaminhar para o time.'
  mensagens.push({ role: 'system', content: regrasResumo })

  const memoria = memoriaParaMensagens(numero)
  mensagens.push(...memoria)

  if (cfg.internet_context) {
    const web = await buscarContextoInternet(pergunta)
    if (web) {
      mensagens.push({
        role: 'system',
        content:
          'Contexto complementar da internet (pode estar resumido):\n' +
          web +
          '\nUse apenas se fizer sentido para a pergunta atual.'
      })
    }
  }

  mensagens.push({ role: 'user', content: String(pergunta || '').slice(0, 3000) })
  const resposta = await executarNaFilaIA(() => chamarOllama(mensagens, cfg))
  if (!resposta) return null
  appendMemoriaIA(numero, pergunta, resposta)
  return resposta
}

function gerarFallbackUtil(pergunta) {
  const t = String(pergunta || '').toLowerCase()
  if (t.includes('agendar') || t.includes('horário') || t.includes('marcar')) {
    return 'Perfeito. Para agendar, me envie seu nome completo e dois horários que você prefere.'
  }
  if (t.includes('preço') || t.includes('valor') || t.includes('quanto')) {
    return 'Posso te ajudar com valores. Me diga qual serviço você precisa e já te passo as opções.'
  }
  if (t.includes('endereço') || t.includes('local') || t.includes('onde')) {
    return 'Posso te passar o local certinho. Me confirme sua cidade ou região para eu te orientar melhor.'
  }
  return 'Entendi sua mensagem. Me envie seu nome e o que você precisa para eu te ajudar da forma mais rápida.'
}

async function processarMensagem(msg) {
  if (botStatus !== 'conectado') return
  if (!msg || msg.fromMe || msg.isStatus) return
  if (String(msg.from || '').includes('@g.us')) return
  if (msg.from === 'status@broadcast' || String(msg.from || '').includes('broadcast')) return
  if (msg.type === 'newsletter') return
  if (msg.id?.remote?.includes('newsletter')) return

  const idMsg = gerarIdMensagem(msg)
  if (jaProcessada(idMsg)) return

  const numero = String(msg.from || '').replace('@c.us', '').replace(/\D/g, '')
  const texto = String(msg.body || '').trim()
  const isGrupo = String(msg.from || '').includes('@g.us')
  if (!texto) return

  addLog('recebido', texto, numero)

  const regras = acharRespostaRegras(texto, numero, isGrupo)
  if (regras.bloqueado) {
    addLog('bloqueado', `Mensagem ignorada (${regras.motivo}).`, numero)
    return
  }

  const leadFluxo = await processarFluxoLead(msg, numero, texto)
  if (leadFluxo?.handled) return

  const iaCfg = lerAIConfig()
  const modo = iaCfg.mode
  let respondeu = false

  if (iaCfg.enabled && iaFilaPendentes > 0) {
    await responderAguardandoFila(msg, numero)
  }

  if (modo === 'prefer_ai' && iaCfg.enabled) {
    try {
      const respostaIA = await gerarRespostaIA(numero, texto)
      if (respostaIA) {
        await esperar(iaCfg.reply_delay_ms)
        respondeu = await responderMensagem(msg, respostaIA, numero, 'ia')
      }
    } catch (err) {
      addLog('erro', `[IA] ${err?.message || String(err)}`, numero)
    }
    if (respondeu) return
  }

  if (regras.resposta) {
    await responderMensagem(msg, regras.resposta, numero, regras.origem || 'regra')
    return
  }

  if (modo !== 'legacy_only' && iaCfg.enabled) {
    try {
      const respostaIA = await gerarRespostaIA(numero, texto)
      if (respostaIA) {
        await esperar(iaCfg.reply_delay_ms)
        respondeu = await responderMensagem(msg, respostaIA, numero, 'ia')
      }
    } catch (err) {
      addLog('erro', `[IA] ${err?.message || String(err)}`, numero)
    }
  }

  if (!respondeu && modo !== 'legacy_only') {
    const fallback = gerarFallbackUtil(texto)
    await responderMensagem(msg, fallback, numero, 'fallback')
  }

  limparAvisoFila(msg.from)
}

async function iniciarBot() {
  if (cliente) {
    try {
      await cliente.destroy()
    } catch (e) {}
    cliente = null
    await new Promise(r => setTimeout(r, 1200))
  }

  pararTimers()
  tentativas++
  emitirStatus('conectando')
  addLog('sistema', '[START] Iniciando bot...')

  initTimer = setTimeout(() => {
    if (botStatus === 'conectando') {
      addLog('erro', '[TIMEOUT] Conexão demorou demais. Tente limpar sessão.')
      emitirStatus('desconectado')
      if (cliente) {
        try {
          cliente.destroy()
        } catch (e) {}
        cliente = null
      }
    }
  }, 180000)

  try {
    const { Client, LocalAuth } = require('whatsapp-web.js')
    const qrcode = require('qrcode')
    const sessionPath = path.join(garantirDataDir(), 'wwebjs_auth')
    const chromePath = encontrarChrome()

    addLog('sistema', chromePath ? `[BROWSER] ${chromePath}` : '[BROWSER] Chrome não detectado, tentando auto.')

    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--safebrowsing-disable-auto-update',
      '--disable-web-security',
      '--allow-running-insecure-content'
    ]

    const puppeteerOpts = { headless: true, handleSIGINT: false, args: puppeteerArgs }
    if (chromePath) puppeteerOpts.executablePath = chromePath

    cliente = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionPath, clientId: 'zapbot-ghz' }),
      puppeteer: puppeteerOpts,
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
      }
    })

    cliente.on('loading_screen', percent => {
      addLog('sistema', `[LOADING] WhatsApp ${percent}%`)
      emitirStatus('conectando', { progresso: percent })
    })

    cliente.on('qr', async qr => {
      pararTimers()
      addLog('sistema', '[QR] Código QR gerado.')
      emitirStatus('aguardando_qr')
      try {
        const qrImagem = await qrcode.toDataURL(qr, { width: 280, margin: 2 })
        enviarParaFrame('bot:qr', { qr: qrImagem })
      } catch (e) {
        enviarParaFrame('bot:qr', { qrText: qr })
      }
    })

    cliente.on('authenticated', () => {
      addLog('sistema', '[AUTH] Autenticado.')
      emitirStatus('autenticado')
    })

    cliente.on('ready', () => {
      pararTimers()
      tentativas = 0
      const info = cliente.info
      const numero = info?.wid?.user || ''
      const nome = info?.pushname || ''
      addLog('sistema', `[OK] Bot conectado no número +${numero}`)
      emitirStatus('conectado', { numero, nome })
      salvarJSON('ultimo_numero', { numero, nome, conectado_em: new Date().toISOString() })
    })

    cliente.on('disconnected', reason => {
      pararTimers()
      addLog('sistema', `[DISCONNECT] ${reason}`)
      emitirStatus('desconectado')
      cliente = null
      if (reason !== 'LOGOUT' && tentativas < 3) {
        addLog('sistema', `[RETRY] Reconectando automaticamente (${tentativas}/3)...`)
        setTimeout(() => iniciarBot(), 5000)
      } else if (tentativas >= 3) {
        addLog('erro', 'Muitas tentativas de reconexão. Limpe a sessão.')
        tentativas = 0
      }
    })

    cliente.on('auth_failure', () => {
      pararTimers()
      addLog('erro', 'Falha na autenticação. Limpe a sessão e tente novamente.')
      emitirStatus('desconectado')
      cliente = null
    })

    cliente.on('message', msg => {
      const from = String(msg?.from || '')
      if (from.includes('@g.us')) return
      const chatId = from || 'desconhecido'
      enfileirar(chatId, async () => {
        await processarMensagem(msg)
      })
    })

    addLog('sistema', '[INIT] Inicializando conexão...')
    await cliente.initialize()
  } catch (err) {
    pararTimers()
    const mensagem = err?.message || String(err)
    addLog('erro', `[START FAIL] ${mensagem}`)
    if (
      mensagem.toLowerCase().includes('chrome') ||
      mensagem.toLowerCase().includes('chromium') ||
      mensagem.toLowerCase().includes('executable') ||
      mensagem.toLowerCase().includes('spawn')
    ) {
      addLog('erro', 'Instale o Google Chrome: https://www.google.com/chrome/')
    }
    emitirStatus('desconectado')
    cliente = null
  }
}

async function desconectarBot() {
  pararTimers()
  tentativas = 99
  if (cliente) {
    try {
      await cliente.destroy()
    } catch (e) {}
    cliente = null
  }
  emitirStatus('desconectado')
  addLog('sistema', '[STOP] Bot desconectado.')
  tentativas = 0
}

async function limparSessao() {
  await desconectarBot()
  const sessionPath = path.join(garantirDataDir(), 'wwebjs_auth')
  try {
    if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true })
  } catch (e) {}
  addLog('sistema', 'Sessão limpa. Gere novo QR para conectar.')
}

function execCommand(cmd, args, timeoutMs = 20000) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { shell: false, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch (e) {}
      resolve({ ok: false, error: 'timeout', stdout: out, stderr: err })
    }, timeoutMs)
    proc.stdout.on('data', d => {
      out += d.toString()
    })
    proc.stderr.on('data', d => {
      err += d.toString()
    })
    proc.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, error: e.message, stdout: out, stderr: err })
    })
    proc.on('close', code => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout: out, stderr: err })
    })
  })
}

async function diagnosticoIA() {
  const cfg = lerAIConfig()
  const url = `${cfg.ollama_url.replace(/\/+$/, '')}/api/tags`
  const bin = await findOllamaBinary()
  const setupPath = getBundledOllamaSetupPath()
  const packPath = resolveBundledModelsPackPath()
  const bundledRuntimeCandidates = getBundledOllamaBinaryCandidates()
  const bundledRuntimePath = bundledRuntimeCandidates.find(p => {
    try {
      return fs.existsSync(p)
    } catch (e) {
      return false
    }
  }) || bundledRuntimeCandidates[0]
  let modelsPath = resolveBundledModelsPath()
  if (!modelsPath) {
    try {
      modelsPath = await ensureBundledModelsReady()
    } catch (e) {}
  }
  let modelsBytes = 0
  if (modelsPath && fs.existsSync(modelsPath)) {
    try {
      const files = fs.readdirSync(modelsPath, { withFileTypes: true })
      if (files.length) {
        const stack = [modelsPath]
        while (stack.length) {
          const cur = stack.pop()
          const items = fs.readdirSync(cur, { withFileTypes: true })
          for (const it of items) {
            const full = path.join(cur, it.name)
            if (it.isDirectory()) stack.push(full)
            else {
              try {
                modelsBytes += fs.statSync(full).size
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}
  }

  let apiOnline = false
  let models = []
  let erroApi = ''
  try {
    const ctl = new AbortController()
    const timeout = setTimeout(() => ctl.abort(), 9000)
    const r = await fetch(url, { signal: ctl.signal })
    clearTimeout(timeout)
    if (r.ok) {
      const j = await r.json()
      apiOnline = true
      models = Array.isArray(j.models) ? j.models.map(m => m.name) : []
    } else {
      erroApi = `HTTP ${r.status}`
    }
  } catch (e) {
    erroApi = e?.message || String(e)
  }

  return {
    config: cfg,
    ollama_cli_ok: !!bin,
    ollama_cli_path: bin || '',
    bundled_runtime_ok: !!(bundledRuntimePath && fs.existsSync(bundledRuntimePath)),
    bundled_runtime_path: bundledRuntimePath || '',
    bundled_models_ok: !!(modelsPath && fs.existsSync(modelsPath)),
    bundled_models_path: modelsPath || '',
    bundled_models_bytes: modelsBytes,
    bundled_models_pack_ok: !!(packPath && fs.existsSync(packPath)),
    bundled_models_pack_path: packPath || '',
    bundled_setup_ok: !!(setupPath && fs.existsSync(setupPath)),
    bundled_setup_path: setupPath || '',
    api_online: apiOnline,
    models,
    api_error: erroApi
  }
}

async function instalarModeloPesado(modeloEscolhido) {
  if (installProcess) return { ok: false, erro: 'Já existe uma instalação em andamento.' }
  const model = String(modeloEscolhido || IA_HEAVY_MODEL_DEFAULT).trim()
  if (!model) return { ok: false, erro: 'Modelo inválido.' }

  const installRuntime = await installBundledOllamaRuntimeIfNeeded()
  if (!installRuntime.ok) return { ok: false, erro: installRuntime.erro || 'Runtime Ollama indisponível.' }
  const bin = await findOllamaBinary()
  if (!bin) return { ok: false, erro: 'Ollama não encontrado no sistema.' }

  const cfg = lerAIConfig()
  try {
    await ensureBundledModelsReady()
  } catch (e) {
    return { ok: false, erro: `Falha ao preparar pasta de modelos: ${e?.message || String(e)}` }
  }
  const start = await startOllamaServeIfNeeded(cfg)
  if (!start.ok) return { ok: false, erro: start.erro || 'Ollama não inicializou.' }

  addLog('sistema', `[IA] Iniciando download do modelo pesado: ${model}`)
  enviarParaFrame('ia:progresso', { etapa: 'inicio', texto: `Iniciando: ${model}` })

  return await new Promise(resolve => {
    const env = Object.assign({}, process.env)
    const modelsPath = resolveBundledModelsPath()
    if (modelsPath) env.OLLAMA_MODELS = modelsPath
    installProcess = spawn(bin, ['pull', model], {
      shell: false,
      windowsHide: true,
      env
    })
    let all = ''
    const onData = chunk => {
      const txt = chunk.toString()
      all += txt
      const linhas = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      for (const l of linhas.slice(-3)) {
        enviarParaFrame('ia:progresso', { etapa: 'andamento', texto: l })
      }
    }
    installProcess.stdout.on('data', onData)
    installProcess.stderr.on('data', onData)
    installProcess.on('error', e => {
      installProcess = null
      addLog('erro', `[IA] Falha ao instalar modelo: ${e.message}`)
      resolve({ ok: false, erro: e.message })
    })
    installProcess.on('close', code => {
      installProcess = null
      if (code === 0) {
        addLog('sistema', `[IA] Modelo ${model} instalado com sucesso.`)
        enviarParaFrame('ia:progresso', { etapa: 'fim', texto: 'Modelo instalado com sucesso.' })
        resolve({ ok: true, model })
      } else {
        const msg = `Instalação falhou com código ${code}`
        addLog('erro', `[IA] ${msg}`)
        resolve({ ok: false, erro: msg, detalhe: all.slice(-1500) })
      }
    })
  })
}

ipcMain.handle('bot:iniciar', async () => {
  await iniciarBot()
  return { ok: true }
})

ipcMain.handle('bot:desconectar', async () => {
  await desconectarBot()
  return { ok: true }
})

ipcMain.handle('bot:pausar', async () => {
  botStatus = 'pausado'
  emitirStatus('pausado')
  addLog('sistema', '[PAUSE] Bot pausado.')
  return { ok: true }
})

ipcMain.handle('bot:retomar', async () => {
  botStatus = 'conectado'
  emitirStatus('conectado')
  addLog('sistema', '[RESUME] Bot retomado.')
  return { ok: true }
})

ipcMain.handle('bot:status', async () => ({ status: botStatus }))
ipcMain.handle('bot:limpar_sessao', async () => {
  await limparSessao()
  return { ok: true }
})
ipcMain.handle('bot:logs', async () => logMsgs)

ipcMain.handle('bot:enviar_teste', async (event, { numero, mensagem }) => {
  if (!cliente || botStatus !== 'conectado') return { ok: false, erro: 'Bot não conectado.' }
  try {
    await cliente.sendMessage(String(numero || '').replace(/\D/g, '') + '@c.us', String(mensagem || ''))
    addLog('enviado', `[TESTE] ${mensagem}`, numero)
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: e.message }
  }
})

ipcMain.handle('bot:diagnostico', async () => ({
  chrome_path: encontrarChrome() || 'Não encontrado (instale o Google Chrome)',
  chrome_ok: !!encontrarChrome(),
  data_dir: getDataDir(),
  status: botStatus,
  tentativas,
  ia: await diagnosticoIA(),
  wwjs_version: (() => {
    try {
      return require('whatsapp-web.js/package.json').version
    } catch (e) {
      return 'não instalado'
    }
  })()
}))

ipcMain.handle('dados:ler', async (event, nome) => {
  return lerJSON(nome, ['menus', 'respostas', 'blacklist'].includes(nome) ? [] : {})
})

ipcMain.handle('dados:salvar', async (event, nome, dados) => {
  salvarJSON(nome, dados)
  return { ok: true }
})

ipcMain.handle('leads:listar', async () => {
  return lerLeads()
})

ipcMain.handle('leads:remover', async (event, id) => {
  const lista = lerLeads().filter(l => String(l.id) !== String(id))
  salvarLeads(lista)
  return { ok: true }
})

ipcMain.handle('leads:limpar', async () => {
  salvarLeads([])
  return { ok: true }
})

ipcMain.handle('ia:ler_config', async () => lerAIConfig())

ipcMain.handle('ia:salvar_config', async (event, cfg) => {
  const saved = salvarAIConfig(cfg || {})
  addLog('sistema', '[IA] Configurações salvas.')
  return { ok: true, config: saved }
})

ipcMain.handle('ia:diagnostico', async () => {
  return await diagnosticoIA()
})

ipcMain.handle('ia:testar', async (event, payload) => {
  const pergunta = String(payload?.pergunta || '').trim()
  if (!pergunta) return { ok: false, erro: 'Digite uma pergunta para testar.' }
  try {
    const numero = String(payload?.numero || '00000000000')
    const resposta = await gerarRespostaIA(numero, pergunta)
    if (!resposta) return { ok: false, erro: 'Modelo não retornou resposta.' }
    return { ok: true, resposta }
  } catch (e) {
    return { ok: false, erro: e?.message || String(e) }
  }
})

ipcMain.handle('ia:instalar_modelo_pesado', async (event, model) => {
  return await instalarModeloPesado(model)
})

ipcMain.handle('ia:limpar_memoria', async () => {
  limparMemoriaIA()
  addLog('sistema', '[IA] Memória de conversa limpa.')
  return { ok: true }
})

ipcMain.handle('ia:gerar_resposta_manual', async (event, payload) => {
  const pergunta = String(payload?.pergunta || '').trim()
  const numero = String(payload?.numero || '').trim() || '00000000000'
  if (!pergunta) return { ok: false, erro: 'Pergunta vazia.' }
  try {
    const resposta = await gerarRespostaIA(numero, pergunta)
    if (!resposta) return { ok: false, erro: 'Sem resposta do modelo.' }
    return { ok: true, resposta }
  } catch (e) {
    return { ok: false, erro: e?.message || String(e) }
  }
})

// ── SUPABASE LICENSE SYSTEM ──────────────────────────────
const SUPABASE_URL = 'https://wpkaaxarresldcstaatj.supabase.co'
const SUPABASE_KEY = 'sb_publishable_G3I0XMI3dPG1Skkw9iFm9Q_1Ng6MVG0'
const LICENSE_CACHE_MAX_MS = 48 * 60 * 60 * 1000

function supabaseRpc(fn, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/rest/v1/rpc/${fn}`, SUPABASE_URL)
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    const client = url.protocol === 'http:' ? http : https
    const req = client.request(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
        'content-type': 'application/json',
        'content-length': body.length
      }
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = raw ? JSON.parse(raw) : null } catch (e) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(json?.message || json?.error || raw || `HTTP ${res.statusCode}`))
          return
        }
        resolve(json)
      })
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('Tempo limite ao validar licenca.')))
    req.write(body)
    req.end()
  })
}

function machineGuid() {
  if (process.platform !== 'win32') return ''
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    const m = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)
    return m ? m[1].trim() : ''
  } catch (e) { return '' }
}

function getLicenseDeviceInfo() {
  const base = [machineGuid(), os.hostname(), os.userInfo().username, os.platform(), os.arch()].join('|')
  return {
    device_hash: crypto.createHash('sha256').update(`ghz-license-v1|${base}`).digest('hex'),
    device_name: os.hostname(),
    device_os: `${os.type()} ${os.release()} ${os.arch()}`,
    app_version: app.getVersion()
  }
}

function licenseStatePath() { return path.join(getDataDir(), 'license-state.json') }

function readLicenseState() {
  try { return JSON.parse(fs.readFileSync(licenseStatePath(), 'utf8') || '{}') } catch (e) { return {} }
}

function saveLicenseState(patch = {}) {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const s = { active: false, license_key: '', customer_name: '', activated_at: '', last_validated_at: '', last_error: '', ...readLicenseState(), ...patch }
  fs.writeFileSync(licenseStatePath(), JSON.stringify(s, null, 2), 'utf8')
  return s
}

function licenseCacheValid(s) {
  if (!s) s = readLicenseState()
  if (!s.active || !s.license_key) return false
  const t = Date.parse(s.last_validated_at || s.activated_at || '')
  return Number.isFinite(t) && Date.now() - t <= LICENSE_CACHE_MAX_MS
}

async function activateLicense(key, phone) {
  const k = String(key || '').trim().toUpperCase()
  const d = getLicenseDeviceInfo()
  const r = await supabaseRpc('ghz_activate_license', { p_license_key: k, p_device_hash: d.device_hash, p_device_name: d.device_name, p_device_os: d.device_os, p_app_version: d.app_version, p_customer_phone: String(phone || '') })
  if (!r?.ok) { saveLicenseState({ active: false, license_key: k, last_error: r?.message || 'Licenca invalida.' }); return r || { ok: false, message: 'Licenca invalida.' } }
  saveLicenseState({ active: true, license_key: k, customer_name: r.customer_name || '', activated_at: r.activated_at || new Date().toISOString(), last_validated_at: new Date().toISOString(), last_error: '' })
  return r
}

async function validateLicense() {
  const s = readLicenseState()
  if (!s.license_key) return { ok: false, code: 'missing_license', message: 'Licenca nao ativada.' }
  const d = getLicenseDeviceInfo()
  const r = await supabaseRpc('ghz_validate_license', { p_license_key: s.license_key, p_device_hash: d.device_hash, p_device_name: d.device_name, p_device_os: d.device_os, p_app_version: d.app_version })
  if (!r?.ok) { saveLicenseState({ active: false, last_error: r?.message || 'Licenca invalida.' }); return r || { ok: false, message: 'Licenca invalida.' } }
  saveLicenseState({ active: true, customer_name: r.customer_name || s.customer_name || '', last_validated_at: new Date().toISOString(), last_error: '' })
  return r
}
// ── END SUPABASE LICENSE SYSTEM ──────────────────────────

// ── LICENSE IPC HANDLERS ──────────────────────────────────
ipcMain.handle('license:get-state', async () => ({ ...readLicenseState(), cache_valid: licenseCacheValid() }))
ipcMain.handle('license:device-info', async () => {
  const i = getLicenseDeviceInfo()
  return { device_hash_preview: i.device_hash.slice(0, 12), device_name: i.device_name, device_os: i.device_os }
})
ipcMain.handle('license:activate', async (e, { license_key, phone }) => activateLicense(license_key, phone))
ipcMain.handle('license:validate', async () => validateLicense())

// ── UPDATE IPC HANDLERS ──────────────────────────────────
ipcMain.handle('update:get-state', async () => getUpdatePayload())
ipcMain.handle('update:check', async () => verificarAtualizacao('manual'))
ipcMain.handle('update:start-install', async () => iniciarFluxoAtualizacao())

app.whenReady().then(async () => {
  createWindow()
  await verificarAtualizacaoSemanalNoStartup()
})

app.on('window-all-closed', async () => {
  pararTimers()
  await desconectarBot()
  if (process.platform !== 'darwin') app.quit()
})
