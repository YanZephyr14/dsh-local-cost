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

test('保存模型设置：data.* 前缀 payload 端到端落盘且隔离', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const key = Object.keys(read(dir).models)[0]
  const res = panels.prices.actions.saveModel({}, {
    value: { data: { s_mode: 'peak', s_windows: '08:00-22:00', s_weekend: 'ignore', m_in: 3, m_cr: 0.3, m_out: 9, M_in: 6, M_cr: 0.6, M_out: 18 } },
    locale: 'zh-CN',
  })
  assert.equal(res.toast, '已保存，只改了这个模型')
  const cfg = read(dir)
  const e = cfg.models[key]
  assert.deepEqual(e.peak, { input: 6, cacheRead: 0.6, output: 18 })
  assert.deepEqual(e.schedule.windows, [{ start: '08:00', end: '22:00' }])
  assert.equal(e.schedule.weekend, 'ignore')
  assert.deepEqual(cfg.peak.windows, [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], '全局时段原样')
})

test('保存模型设置：键值对数组形状同样可用', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const key = Object.keys(read(dir).models)[0]
  const res = panels.prices.actions.saveModel({}, {
    value: [{ bind: 'data.M_out', value: 9 }],
    locale: 'zh-CN',
  })
  assert.equal(res.toast, '已保存，只改了这个模型')
  assert.equal(read(dir).models[key].peak.output, 9)
})

test('空 payload：给出提示且不写盘', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const before = read(dir)
  const res = panels.prices.actions.saveModel({}, { value: { something: 1 }, locale: 'zh-CN' })
  assert.equal(res.toast, '没收到新的价格，请重试')
  assert.deepEqual(read(dir), before)
})

test('画面导航：列表→编辑→返回，删除此模型回列表', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const key = Object.keys(read(dir).models)[0]
  panels.prices.actions.editModelSettings({}, { value: { model: key }, locale: 'zh-CN' })
  assert.ok(JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' })).includes('saveModel'), '编辑画面')
  panels.prices.actions.backToList({}, { locale: 'zh-CN' })
  assert.ok(!JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' })).includes('data.s_windows'), '列表画面')
  // flat 保存后编辑页不再显示时段字段
  panels.prices.actions.editModelSettings({}, { value: { model: key }, locale: 'zh-CN' })
  panels.prices.actions.saveModel({}, { value: { s_mode: 'flat', m_in: 2 }, locale: 'zh-CN' })
  assert.equal(read(dir).models[key].schedule.enabled, false)
  assert.ok(!JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' })).includes('data.s_windows'), 'flat 编辑页无时段字段')
  // 删除此模型 → 回列表
  const del = panels.prices.actions.deleteThis({}, { locale: 'zh-CN' })
  assert.equal(del.toast, `已删除 ${key}`)
  assert.equal(read(dir).models[key], undefined)
  assert.ok(!JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' })).includes('saveModel'))
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

test('点费用行编辑的是生效条目，不再产生裸名影子条目', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const cfg = read(dir)
  const providerKey = Object.keys(cfg.models)[0] // custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017
  const model = providerKey.split(':')[1]
  const res = panels.cost.actions.editModel({}, { value: { model, provider: 'custom-dashscope-aliyuncs' }, locale: 'zh-CN' })
  assert.deepEqual(res, { open: 'panel:prices' }, '已存在生效条目 → 不新建、不提示建条目')
  const after = read(dir)
  assert.equal(Object.keys(after.models).length, Object.keys(cfg.models).length, '不应新增条目')
  let data = {}
  panels.prices.data({}, (v) => { data = v })
  assert.equal(data.m_sel, providerKey, '编辑页选中 provider:model 条目')
})

test('模板按钮 args 三种形状都能识别', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const key = Object.keys(read(dir).models)[0]
  const before = read(dir).models[key].offPeak.input
  for (const value of [{ tpl: 'peak2x' }, { args: { tpl: 'peak2x' } }, 'peak2x']) {
    const res = panels.prices.actions.modelTemplate({}, { value, locale: 'zh-CN' })
    assert.equal(res.toast, '已套用模板', JSON.stringify(value))
    assert.equal(read(dir).models[key].peak.input, before * 2)
    // 还原再测下一种形状
    const cfg = read(dir)
    cfg.models[key].peak.input = before
    const { saveConfig } = await import(path.join(dir, 'lib', 'config.js'))
    saveConfig(dir, cfg)
  }
  const bad = panels.prices.actions.modelTemplate({}, { value: { unrelated: 1 }, locale: 'zh-CN' })
  assert.equal(bad.toast, '这个模板不可用')
})

test('选「全天一个价」即时隐藏峰谷字段（不落盘）', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const before = JSON.stringify(read(dir))
  panels.prices.actions.editModelSettings({}, { value: { model: Object.keys(JSON.parse(before).models)[0] }, locale: 'zh-CN' })
  const peakView = JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' }))
  assert.ok(peakView.includes('s_windows'), '默认应显示峰谷字段')
  const res = panels.prices.actions.setModelMode({}, { value: { s_mode: 'flat' }, locale: 'zh-CN' })
  assert.equal(res.refresh, true)
  const flatView = JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' }))
  assert.ok(!flatView.includes('s_windows'), 'flat 后峰时段消失')
  assert.ok(!flatView.includes('M_in'), 'flat 后峰价消失')
  assert.ok(flatView.includes('data.s_mode'), '选项还在')
  let data = {}
  panels.prices.data({}, (v) => { data = v })
  assert.equal(data.s_mode, 'flat', '数据层同步')
  assert.equal(JSON.stringify(read(dir)), before, '只改界面，不写盘')
  // 切回峰谷
  panels.prices.actions.setModelMode({}, { value: { value: 'peak' }, locale: 'zh-CN' })
  assert.ok(JSON.stringify(panels.prices.view({}, { locale: 'zh-CN' })).includes('s_windows'))
  // 保存后覆盖清除、真正落盘
  panels.prices.actions.setModelMode({}, { value: { s_mode: 'flat' }, locale: 'zh-CN' })
  panels.prices.actions.saveModel({}, { value: { s_mode: 'flat', m_in: 2 }, locale: 'zh-CN' })
  assert.equal(read(dir).models[Object.keys(JSON.parse(before).models)[0]].schedule.enabled, false)
})

test('切换模型：动作把新模型的数据一起推下去（不再停在旧值）', async () => {
  const { dir, panels } = await loadPlugin()
  panels.prices.view({}, { locale: 'zh-CN' })
  const cfg = read(dir)
  const configured = Object.keys(cfg.models)[0]
  cfg.models['zero-model'] = { offPeak: { input: 0, cacheRead: 0, output: 0 }, peak: { input: 0, cacheRead: 0, output: 0 } }
  const { saveConfig } = await import(path.join(dir, 'lib', 'config.js'))
  saveConfig(dir, cfg)
  // 先进全 0 模型
  panels.prices.actions.editModelSettings({}, { value: { model: 'zero-model' }, locale: 'zh-CN' })
  // 再进配置好的模型：动作返回值必须带它的价格
  const res = panels.prices.actions.editModelSettings({}, { value: { model: configured }, locale: 'zh-CN' })
  assert.equal(res.patch.m_sel, configured)
  assert.equal(res.patch.m_in, cfg.models[configured].offPeak.input)
  assert.equal(res.patch.M_out, cfg.models[configured].peak.output)
  assert.notEqual(res.patch.m_in, 0)
})
