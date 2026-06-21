const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const TARGET_EXT = new Set(['.html', '.js', '.css', '.md', '.txt'])

function listFiles(dir, out = []) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      if (['node_modules', 'dist_installer', '.git'].includes(it.name)) continue
      listFiles(full, out)
    } else if (TARGET_EXT.has(path.extname(it.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

function mojibakeScore(text) {
  const m = text.match(/Ã.|Â.|â.|ðŸ|�/g)
  return m ? m.length : 0
}

function maybeFix(text) {
  const scoreA = mojibakeScore(text)
  if (!scoreA) return { changed: false, text }
  const converted = Buffer.from(text, 'latin1').toString('utf8')
  const scoreB = mojibakeScore(converted)
  if (scoreB < scoreA) return { changed: true, text: converted }
  return { changed: false, text }
}

function run() {
  const files = listFiles(ROOT)
  let changedCount = 0
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    const fixed = maybeFix(raw)
    if (!fixed.changed) continue
    fs.writeFileSync(file, fixed.text, 'utf8')
    changedCount += 1
    console.log(`[fix] ${path.relative(ROOT, file)}`)
  }
  console.log(`[fix] arquivos corrigidos: ${changedCount}`)
}

run()
