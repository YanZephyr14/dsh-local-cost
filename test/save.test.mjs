import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = new URL('../lib/', import.meta.url).pathname

/** 把 lib/ 复制到临时目录，插件的 dir 就落在那里，不会碰仓库里的 price.json。 */
async function loadPlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-save-'))
  fs.mkdirSync(path.join(dir, 'lib'))
  for (const name of fs.readdirSync(LIB)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(LIB, name), path.join(dir, 'lib', name))
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'local-cost', version: '0.0.0', type: 'module', main: 'lib/index.js' }))
  const mod = await import(pathToFileURL(path.join(dir, 'lib', 'index.js')).href)
  const panels = {}
  mod.apply({
    inject(_deps, fn) {
      fn({ dshGo: { panel: (id, def) => { panels[id] = def }, strip: () => {}, on: () => {} } })
    },
  })
  return { dir, panels }
}

const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'price.json'), 'utf8'))

test('保存单价：data.* 前缀的 payload 也能落盘', async () => {
  const { dir, panels } = await loadPlugin()
  const res = panels.prices.actions.saveModels({}, {
    value: { 'data.P0_in': 6, 'data.P0_cr': 0.6, 'data.P0_out': 18, 'data.p0_in': 3 },
    locale: 'zh-CN',
  })
  assert.equal(res.toast, '已保存')
  assert.equal(res.refresh, true)
  const cfg = read(dir)
  const key = Object.keys(cfg.models)[0]
  assert.equal(cfg.models[key].peak.input, 6)
  assert.equal(cfg.models[key].peak.cacheRead, 0.6)
  assert.equal(cfg.models[key].peak.output, 18)
  assert.equal(cfg.models[key].offPeak.input, 3)
})

test('保存单价：键值对数组形状也能落盘', async () => {
  const { dir, panels } = await loadPlugin()
  const res = panels.prices.actions.saveModels({}, {
    value: [{ bind: 'data.P0_out', value: 9 }],
    locale: 'zh-CN',
  })
  assert.equal(res.toast, '已保存')
  const cfg = read(dir)
  const key = Object.keys(cfg.models)[0]
  assert.equal(cfg.models[key].peak.output, 9)
})

test('空 payload：给出提示且不写盘', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.actions.savePeak({}, { value: { 'data.g_windows': '08:00-22:00' }, locale: 'zh-CN' })
  const before = read(dir)
  const res = panels.prices.actions.saveModels({}, { value: { something: 1 }, locale: 'zh-CN' })
  assert.equal(res.toast, '没收到新的价格，请重试')
  assert.equal(res.refresh, undefined)
  assert.deepEqual(read(dir), before)
})

test('时段与新增模型走同一个归一化', async () => {
  const { dir, panels } = await loadPlugin()
  assert.equal(panels.prices.actions.savePeak({}, { value: { 'data.g_windows': '08:00-22:00' }, locale: 'zh-CN' }).toast, '已保存')
  assert.deepEqual(read(dir).peak.windows, [{ start: '08:00', end: '22:00' }])
  assert.equal(panels.more.actions.addModel({}, { value: { 'data.n_key': 'bailian:ds', 'data.n_in': 1 }, locale: 'zh-CN' }).toast, '已保存')
  assert.equal(read(dir).models['bailian:ds'].offPeak.input, 1)
})
