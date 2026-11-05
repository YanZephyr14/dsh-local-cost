// 会话日志扫描：从 assistant/message 记录里取出每次调用的 token 与模型。
// 只读，不改任何会话文件；按 path+size+mtime 缓存，未变化的文件不重复解压。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const LOG_RE = /^session\.v(\d+)\.jsonl(\.zstd)?$/

export function sessionsRoot(env = process.env) {
  const home = env.DSH_HOME || path.join(env.HOME || '/root', '.dsh')
  return path.join(home, 'sessions')
}

export function decodeLog(file) {
  const buffer = fs.readFileSync(file)
  if (!file.endsWith('.zstd')) return buffer.toString('utf8')
  return zlib.zstdDecompressSync(buffer).toString('utf8')
}

/** 一行一条记录；只认 assistant/message 且带 usage 的。 */
export function parseLogText(text) {
  const calls = []
  for (const line of text.split('\n')) {
    if (line.length < 20 || !line.includes('assistant/message')) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record?.type !== 'assistant/message') continue
    const usage = record.data?.usage
    if (!usage || typeof usage !== 'object') continue
    const source = record.data?.message?.source
    const time = Number(record.time)
    if (!Number.isFinite(time)) continue
    calls.push({
      t: time,
      provider: typeof source?.provider === 'string' ? source.provider : '',
      model: typeof source?.model === 'string' ? source.model : '',
      input: Math.max(0, Number(usage.inputTokens) || 0),
      cacheRead: Math.max(0, Number(usage.cacheReadTokens) || 0),
      cacheWrite: Math.max(0, Number(usage.cacheWriteTokens) || 0),
      output: Math.max(0, Number(usage.outputTokens) || 0),
    })
  }
  return calls
}

function listLogFiles(root) {
  const files = []
  let workspaces
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return files
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory() || ws.name.startsWith('.')) continue
    const wsPath = path.join(root, ws.name)
    let sessions
    try {
      sessions = fs.readdirSync(wsPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const sessionPath = path.join(wsPath, session.name)
      let entries
      try {
        entries = fs.readdirSync(sessionPath)
      } catch {
        continue
      }
      for (const name of entries) {
        if (LOG_RE.test(name)) files.push({ file: path.join(sessionPath, name), dir: session.name })
      }
    }
  }
  return files
}

/** 扫描器带缓存：同一份日志没变就不再解压。日志正在追加导致的解压失败会保留上一次结果。 */
export function createScanner() {
  const cache = new Map()
  return {
    clear() {
      cache.clear()
    },
    scan(root = sessionsRoot()) {
      const calls = []
      let files = 0
      let unreadable = 0
      let present = false
      for (const { file, dir } of listLogFiles(root)) {
        present = true
        files += 1
        let stat
        try {
          stat = fs.statSync(file)
        } catch {
          unreadable += 1
          continue
        }
        const key = `${stat.size}:${Math.round(stat.mtimeMs)}`
        const hit = cache.get(file)
        if (hit && hit.key === key) {
          for (const call of hit.calls) calls.push({ ...call, session: dir })
          continue
        }
        try {
          const parsed = parseLogText(decodeLog(file))
          cache.set(file, { key, calls: parsed })
          for (const call of parsed) calls.push({ ...call, session: dir })
        } catch {
          unreadable += 1
          if (hit) for (const call of hit.calls) calls.push({ ...call, session: dir })
        }
      }
      return { calls, files, unreadable, empty: !present }
    },
  }
}