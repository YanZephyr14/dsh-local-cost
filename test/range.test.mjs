// 时间范围选择：日期窗口、区间聚合、费用面板动作与视图。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dayStartMs, localDate } from '../lib/pricing.js'
import { summarize } from '../lib/summary.js'
import { costView } from '../lib/views.js'

const TZ = 'Asia/Shanghai'
const LIB = new URL('../lib/', import.meta.url).pathname

function baseConfig() {
  return {
    currency: { symbol: '¥', perTokens: 1_000_000, decimals: 3 },
    peak: { enabled: false, tz: TZ, windows: [], weekend: 'offPeak', holidays: [] },
    models: { default: { offPeak: { input: 1, cacheRead: 0, output: 4 } } },
  }
}

test('dayStartMs：上海 00:00 = 前一日 16:00 UTC，往返一致', () => {
  const start = dayStartMs('2026-11-05', TZ)
  assert.equal(start, Date.UTC(2026, 10, 4, 16))
  assert.equal(localDate(start, TZ), '2026-11-05')
  assert.equal(localDate(start + 86_400_000 - 1, TZ), '2026-11-05')
})

test('dayStartMs：非法输入返回 null', () => {
  for (const bad of [null, undefined, '', '2026-11-5', '2026-13-01', '2026-02-30x', '11-05']) {
    assert.equal(dayStartMs(bad, TZ), null, String(bad))
  }
})

test('summarize：range 只收窗口内的调用，rangeModels 同步过滤', () => {
  const now = dayStartMs('2026-11-05', TZ) + 10 * 3_600_000
  const yesterday = dayStartMs('2026-11-04', TZ) + 9 * 3_600_000
  const calls = [
    { t: yesterday, provider: 'p', model: 'a', input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, session: 's1' },
    { t: now, provider: 'p', model: 'b', input: 2_000_000, cacheRead: 0, cacheWrite: 0, output: 0, session: 's1' },
  ]
  const win = { from: dayStartMs('2026-11-04', TZ), to: dayStartMs('2026-11-05', TZ) }
  const state = summarize(calls, baseConfig(), { now, range: win })
  assert.equal(state.range.calls, 1)
  assert.ok(Math.abs(state.range.amount - 1) < 1e-9)
  assert.equal(state.rangeModels.length, 1)
  assert.equal(state.rangeModels[0].model, 'a')
  assert.equal(state.models.length, 2, '全时段模型表不受影响')
  assert.equal(state.today.calls, 1)
})

test('summarize：不传 range 时 range 为 null，视图回落今日', () => {
  const state = summarize([], baseConfig(), { now: Date.now() })
  assert.equal(state.range, null)
  assert.deepEqual(state.rangeModels, [])
  const view = costView(baseConfig(), { ...state, rangeMode: 'today', rangeWindow: null, hasSession: false, isPeak: false, nextSwitch: null, unreadable: 0 }, { locale: 'zh-CN' })
  assert.ok(JSON.stringify(view).includes('"今日"'))
})

/** 把 lib/ 复制到临时目录跑宿主面板，逻辑同 save.test.mjs。 */
async function loadPlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-range-'))
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

test('费用面板：分段选择器在，自定义日期表单默认不出现', async () => {
  const { panels } = await loadPlugin()
  const view = panels.cost.view({}, { locale: 'zh-CN' })
  const text = JSON.stringify(view)
  assert.ok(text.includes('"segmented"'))
  assert.ok(text.includes('data.r_mode'))
  assert.ok(!text.includes('"date"'), '今日模式不显示日期框')
})

test('setRange：切到昨日，patch 带 r_mode', async () => {
  const { panels } = await loadPlugin()
  panels.cost.view({}, { locale: 'zh-CN' })
  const res = panels.cost.actions.setRange({}, { value: { data: { r_mode: 'yesterday' } }, locale: 'zh-CN' })
  assert.equal(res.refresh, true)
  assert.equal(res.patch.r_mode, 'yesterday')
  const view = JSON.stringify(panels.cost.view({}, { locale: 'zh-CN' }))
  assert.ok(view.includes('昨日'))
})

test('setRange：切自定义时自动预填近 7 天日期', async () => {
  const { panels } = await loadPlugin()
  panels.cost.view({}, { locale: 'zh-CN' })
  const res = panels.cost.actions.setRange({}, { value: { r_mode: 'custom' }, locale: 'zh-CN' })
  assert.match(res.patch.r_from, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(res.patch.r_to, /^\d{4}-\d{2}-\d{2}$/)
  const view = JSON.stringify(panels.cost.view({}, { locale: 'zh-CN' }))
  assert.ok(view.includes('"date"'), '自定义模式出现日期框')
})

test('applyRange：合法日期生效，视图标题变成区间', async () => {
  const { panels } = await loadPlugin()
  panels.cost.view({}, { locale: 'zh-CN' })
  const res = panels.cost.actions.applyRange({}, {
    value: { data: { r_from: '2026-11-01', r_to: '2026-11-03' } },
    locale: 'zh-CN',
  })
  assert.equal(res.toast, '已按所选区间统计')
  assert.equal(res.patch.r_mode, 'custom')
  assert.equal(res.patch.r_from, '2026-11-01')
  const view = JSON.stringify(panels.cost.view({}, { locale: 'zh-CN' }))
  assert.ok(view.includes('11-01~11-03'))
})

test('applyRange：开始晚于结束或乱填 → 提示且不改变模式', async () => {
  const { panels } = await loadPlugin()
  panels.cost.view({}, { locale: 'zh-CN' })
  const bad = panels.cost.actions.applyRange({}, { value: { r_from: '2026-11-09', r_to: '2026-11-02' }, locale: 'zh-CN' })
  assert.equal(bad.toast, '日期没填对：要形如 2026-11-01，且开始不晚于结束')
  const res = panels.cost.actions.setRange({}, { value: { r_mode: 'week' }, locale: 'zh-CN' })
  assert.equal(res.patch.r_mode, 'week')
})

test('费用面板视图预算：节点与体积不超协议上限', async () => {
  const { panels } = await loadPlugin()
  panels.cost.actions.setRange({}, { value: { r_mode: 'custom' }, locale: 'zh-CN' })
  const view = panels.cost.view({}, { locale: 'zh-CN' })
  const text = JSON.stringify(view)
  assert.ok(text.length < 32 * 1024, `视图 ${text.length}B 超 32KiB`)
  let nodes = 0
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if ('type' in n) nodes += 1
    for (const v of Object.values(n)) Array.isArray(v) ? v.forEach(walk) : walk(v)
  }
  walk(view)
  assert.ok(nodes <= 120, `节点 ${nodes} 超 120`)
})

test('setRange：全部区间可用，视图标题为「全部」', async () => {
  const { panels } = await loadPlugin()
  panels.cost.view({}, { locale: 'zh-CN' })
  const res = panels.cost.actions.setRange({}, { value: { r_mode: 'all' }, locale: 'zh-CN' })
  assert.equal(res.patch.r_mode, 'all')
  const view = JSON.stringify(panels.cost.view({}, { locale: 'zh-CN' }))
  assert.ok(view.includes('全部'))
})
