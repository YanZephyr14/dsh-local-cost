// 回合脚注：文本预算 16 字、金额自适应、无 turnId 时安静不推。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = new URL('../lib/', import.meta.url).pathname

async function loadPlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-note-'))
  fs.mkdirSync(path.join(dir, 'lib'))
  for (const name of fs.readdirSync(LIB)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(LIB, name), path.join(dir, 'lib', name))
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'local-cost', version: '0.0.0', type: 'module', main: 'lib/index.js' }))
  const mod = await import(pathToFileURL(path.join(dir, 'lib', 'index.js')).href)
  const panels = {}
  const notes = {}
  mod.apply({
    inject(_deps, fn) {
      fn({ dshGo: { panel: (id, def) => { panels[id] = def }, strip: () => {}, turnNote: (id, def) => { notes[id] = def }, on: () => {} } })
    },
  })
  return { dir, panels, notes }
}

test('脚注：有 turnId 就推 ≤16 字的今日文本', async () => {
  const { notes, dir } = await loadPlugin()
  // 先渲染一次面板让 price.json 落盘，再塞一个已知金额
  panels_cost_seed(dir)
  fs.writeFileSync(path.join(dir, 'price.json'), JSON.stringify({
    v: 1,
    currency: { symbol: '¥', perTokens: 1000000, decimals: 3 },
    peak: { enabled: true, tz: 'Asia/Shanghai', windows: [{ start: '00:00', end: '23:59' }], weekend: 'offPeak', holidays: [] },
    models: { 'custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017': { offPeak: { input: 1, cacheRead: 0.1, output: 4 } } },
  }))
  const data = notes.costnote
  const fn = typeof data === 'function' ? data : data.data
  const emitted = []
  const cancel = fn({ sessionId: 'session-x', turnId: 7 }, (v) => emitted.push(v))
  try {
    assert.equal(emitted.length, 1, '注册即推一次')
    const note = emitted[0][7]
    assert.ok(note, '按回合号键控')
    assert.ok(note.text.startsWith('今日'), note.text)
    assert.ok([...note.text].length <= 16, `超预算: ${note.text}`)
  } finally {
    cancel()
  }
})

test('脚注：没有 turnId 时不推任何东西也不报错', async () => {
  const { notes } = await loadPlugin()
  const data = notes.costnote
  const fn = typeof data === 'function' ? data : data.data
  const emitted = []
  const cancel = fn({ sessionId: 'session-x' }, (v) => emitted.push(v))
  assert.equal(emitted.length, 0)
  cancel()
})

test('脚注：大金额自动降小数位，保持 ≤16 字', async () => {
  const { notes, dir } = await loadPlugin()
  fs.writeFileSync(path.join(dir, 'price.json'), JSON.stringify({
    v: 1,
    currency: { symbol: '¥', perTokens: 1000, decimals: 3 },
    peak: { enabled: false, tz: 'Asia/Shanghai', windows: [], weekend: 'offPeak', holidays: [] },
    models: { 'custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017': { offPeak: { input: 1000, cacheRead: 0, output: 1000 } } },
  }))
  const data = notes.costnote
  const fn = typeof data === 'function' ? data : data.data
  const emitted = []
  const cancel = fn({ sessionId: 'session-x', turnId: 1 }, (v) => emitted.push(v))
  try {
    const note = emitted[0][1]
    assert.ok([...note.text].length <= 16, `超预算: ${note.text}`)
    assert.ok(!note.text.includes('·'), `大金额时不带峰谷尾巴: ${note.text}`)
  } finally {
    cancel()
  }
})

function panels_cost_seed(dir) {
  // 占位：确保目录存在
  fs.mkdirSync(dir, { recursive: true })
}
