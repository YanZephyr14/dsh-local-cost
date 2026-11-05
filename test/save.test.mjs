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
    value: { 'data.M_in': 6, 'data.M_cr': 0.6, 'data.M_out': 18, 'data.m_in': 3 },
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
    value: [{ bind: 'data.M_out', value: 9 }],
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

test('点未定价模型：建条目并跳到价格面板', async () => {
  const { dir, panels } = await loadPlugin()
  const res = panels.cost.actions.editModel({}, { value: { model: 'qwen3.8-flash' }, locale: 'zh-CN' })
  assert.ok(Array.isArray(res), '应返回多个效果')
  assert.equal(res[0].open, 'panel:prices')
  assert.equal(res[1].toast, '已建条目，填个价格')
  const cfg = read(dir)
  assert.ok(cfg.models['qwen3.8-flash']?.offPeak, '条目已写入')
  // 再进一次：已存在则不重复建、不重复提示
  const again = panels.cost.actions.editModel({}, { value: { model: 'qwen3.8-flash' }, locale: 'zh-CN' })
  assert.deepEqual(again, { open: 'panel:prices' })
  // 价格面板数据应选中该模型
  let data = {}
  panels.prices.data({}, (v) => { data = v })
  assert.equal(data.m_sel, 'qwen3.8-flash')
})

test('下拉切换模型：refresh 且视图跟着换', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' }) // 先生成默认 price.json
  const cfg = read(dir)
  const first = Object.keys(cfg.models)[0]
  cfg.models.another = { offPeak: { input: 5, cacheRead: 0.1, output: 20 }, peak: { input: 5, cacheRead: 0.1, output: 20 } }
  const { saveConfig } = await import(path.join(dir, 'lib', 'config.js'))
  saveConfig(dir, cfg)
  const res = panels.prices.actions.pickModel({}, { value: { value: 'another' }, locale: 'zh-CN' })
  assert.equal(res.refresh, true)
  let data = {}
  panels.prices.data({}, (v) => { data = v })
  assert.equal(data.m_sel, 'another')
  assert.equal(data.m_in, 5)
})
