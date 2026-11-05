import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createScanner, parseLogText } from '../lib/usage.js'

const assistant = (time, model, usage) =>
  JSON.stringify({
    type: 'assistant/message',
    time,
    data: { message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model } }, usage },
  })

function fixtureDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-'))
  const session = path.join(root, '--ws--', 'session-abc')
  fs.mkdirSync(session, { recursive: true })
  return { root, session }
}

test('解析平文本日志：只收 assistant/message 的 usage', () => {
  const text = [
    JSON.stringify({ type: 'session', id: 'x' }),
    assistant(1000, 'm1', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7 }),
    JSON.stringify({ type: 'user/message', time: 1500, data: {} }),
    'not json at all',
  ].join('\n')
  const calls = parseLogText(text)
  assert.equal(calls.length, 1)
  assert.deepEqual(
    { input: calls[0].input, cacheRead: calls[0].cacheRead, output: calls[0].output, model: calls[0].model, provider: calls[0].provider },
    { input: 10, cacheRead: 7, output: 5, model: 'm1', provider: 'p' },
  )
})

test('扫描 zstd 日志并按 mtime 缓存', () => {
  const { root, session } = fixtureDir()
  const file = path.join(session, 'session.v4.jsonl.zstd')
  const body = [assistant(2000, 'm1', { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 })].join('\n')
  fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(body, 'utf8')))

  const scanner = createScanner()
  const first = scanner.scan(root)
  assert.equal(first.calls.length, 1)
  assert.equal(first.calls[0].session, 'session-abc')
  assert.equal(first.files, 1)
  assert.equal(first.unreadable, 0)

  // 内容不变：命中缓存，结果一致
  const second = scanner.scan(root)
  assert.equal(second.calls.length, 1)

  // 追加一次调用：重新解析，得到两条
  const more = `${body}\n${assistant(3000, 'm1', { inputTokens: 4, outputTokens: 1 })}`
  fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(more, 'utf8')))
  const third = scanner.scan(root)
  assert.equal(third.calls.length, 2)
})

test('截断日志：上一次结果保留，并计入 unreadable', () => {
  const { root, session } = fixtureDir()
  const file = path.join(session, 'session.v4.jsonl.zstd')
  const body = [assistant(2000, 'm1', { inputTokens: 3, outputTokens: 2 })].join('\n')
  const packed = zlib.zstdCompressSync(Buffer.from(body, 'utf8'))
  fs.writeFileSync(file, packed)

  const scanner = createScanner()
  assert.equal(scanner.scan(root).calls.length, 1)

  fs.writeFileSync(file, packed.subarray(0, Math.max(4, Math.floor(packed.length / 2))))
  const broken = scanner.scan(root)
  assert.equal(broken.unreadable, 1)
  assert.equal(broken.calls.length, 1, '保留上一次成功解析的结果')
})

test('目录不存在时安静返回空', () => {
  const scanner = createScanner()
  const result = scanner.scan(path.join(os.tmpdir(), 'local-cost-does-not-exist'))
  assert.deepEqual(result, { calls: [], files: 0, unreadable: 0, empty: true })
})

const forked = (time, respId, usage) =>
  JSON.stringify({
    type: 'assistant/message',
    time,
    data: {
      message: { role: 'assistant', id: `msg-${respId}`, content: [], source: { kind: 'model', provider: 'p', model: 'm1', replayState: { response: { responseId: respId } } } },
      usage,
    },
  })

test('会话分叉：复制的历史记录只算一次，归属更新的日志', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-fork-'))
  const oldDir = path.join(root, '--ws--', 'session-old')
  const newDir = path.join(root, '--ws--', 'session-new')
  fs.mkdirSync(oldDir, { recursive: true })
  fs.mkdirSync(newDir, { recursive: true })
  const oldBody = [forked(1000, 'r1', { inputTokens: 100, outputTokens: 10 }), forked(2000, 'r2', { inputTokens: 200, outputTokens: 20 })]
  const newBody = [...oldBody, forked(3000, 'r3', { inputTokens: 300, outputTokens: 30 })]
  const oldFile = path.join(oldDir, 'session.v4.jsonl.zstd')
  const newFile = path.join(newDir, 'session.v4.jsonl.zstd')
  fs.writeFileSync(oldFile, zlib.zstdCompressSync(Buffer.from(oldBody.join('\n'), 'utf8')))
  fs.writeFileSync(newFile, zlib.zstdCompressSync(Buffer.from(newBody.join('\n'), 'utf8')))
  fs.utimesSync(oldFile, new Date(1000), new Date(1000))
  fs.utimesSync(newFile, new Date(9000), new Date(9000))

  const scan = createScanner().scan(root)
  assert.equal(scan.calls.length, 3, '重复的 r1/r2 只算一次')
  const sum = scan.calls.reduce((a, c) => a + c.input, 0)
  assert.equal(sum, 600)
  assert.equal(scan.calls.filter((c) => c.session === 'session-new').length, 3, '复制副本归属新会话')
})