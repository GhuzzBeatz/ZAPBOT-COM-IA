const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC_MODELS = path.join(ROOT, 'vendor', 'ollama', 'models')
const OUT_PACK = path.join(ROOT, 'vendor', 'ollama', 'models-pack')
const CHUNK_SIZE = 700 * 1024 * 1024 // 700MB (evita limite interno do NSIS)

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function removeDirIfExists(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

function listFilesRecursive(baseDir) {
  const out = []
  const stack = [baseDir]
  while (stack.length) {
    const current = stack.pop()
    const items = fs.readdirSync(current, { withFileTypes: true })
    for (const item of items) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) {
        stack.push(full)
      } else if (item.isFile()) {
        out.push(full)
      }
    }
  }
  return out
}

function copyFileBuffered(src, dst) {
  ensureDir(path.dirname(dst))
  fs.copyFileSync(src, dst)
}

function splitLargeFile(src, relPath) {
  const size = fs.statSync(src).size
  const parts = []
  let offset = 0
  let index = 0
  const fd = fs.openSync(src, 'r')
  const buffer = Buffer.allocUnsafe(16 * 1024 * 1024)

  try {
    while (offset < size) {
      const partName = `${relPath}.part${String(index).padStart(3, '0')}`
      const partFull = path.join(OUT_PACK, partName)
      ensureDir(path.dirname(partFull))
      const outFd = fs.openSync(partFull, 'w')
      let remaining = Math.min(CHUNK_SIZE, size - offset)
      let partWritten = 0

      try {
        while (remaining > 0) {
          const toRead = Math.min(buffer.length, remaining)
          const read = fs.readSync(fd, buffer, 0, toRead, offset)
          if (!read) break
          fs.writeSync(outFd, buffer, 0, read)
          offset += read
          remaining -= read
          partWritten += read
        }
      } finally {
        fs.closeSync(outFd)
      }

      parts.push({
        file: partName.replace(/\\/g, '/'),
        size: partWritten
      })
      index += 1
    }
  } finally {
    fs.closeSync(fd)
  }

  return {
    path: relPath.replace(/\\/g, '/'),
    size,
    parts
  }
}

function main() {
  if (!fs.existsSync(SRC_MODELS)) {
    throw new Error(`Pasta de modelos não encontrada: ${SRC_MODELS}`)
  }

  console.log('[prepare-heavy-model] limpando models-pack...')
  removeDirIfExists(OUT_PACK)
  ensureDir(OUT_PACK)

  const files = listFilesRecursive(SRC_MODELS)
  const manifest = {
    generatedAt: new Date().toISOString(),
    chunkSize: CHUNK_SIZE,
    files: []
  }

  for (const full of files) {
    const rel = path.relative(SRC_MODELS, full)
    const size = fs.statSync(full).size
    if (size > CHUNK_SIZE) {
      console.log(`[prepare-heavy-model] split: ${rel} (${size} bytes)`)
      manifest.files.push(splitLargeFile(full, rel))
    } else {
      const dst = path.join(OUT_PACK, rel)
      copyFileBuffered(full, dst)
      manifest.files.push({
        path: rel.replace(/\\/g, '/'),
        size,
        parts: null
      })
    }
  }

  fs.writeFileSync(
    path.join(OUT_PACK, 'parts-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  )
  console.log(`[prepare-heavy-model] pronto. Arquivos: ${manifest.files.length}`)
}

main()
