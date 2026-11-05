// v0.7 打磨项：日期兼容、kind 过滤、备份回退、缓存写入价、提示文案、标记与趋势图。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { coerceDate, dayStartMs } from '../lib/pricing.js'
import { loadConfig, saveConfig, writeAtomic, CONFIG_FILE } from '../lib/config.js'
import { parseLogText } from '../lib/usage.js'
import { costView, pricesView } from '../lib/views.js'
import { applyModelSettings, pricesData, isZeroEntry } from '../lib/editor.js'

test('coerceDate：ISO/斜杠/补位/秒/毫秒时间戳都归一，乱码拒绝', () => {
  const tz = 'Asia/Shanghai'
  assert.equal(coerceDate('2026-11-01', tz), '2026-11-01')
  assert.equal(coerceDate('2026-11-1', tz), '2026-11-01')
  assert.equal(coerceDate('2026/11/1', tz), '2026-11-01')
  assert.equal(coerceDate(dayStartMs('2026-11-01', tz), tz), '2026-11-01')
  assert.equal(coerceDate(dayStartMs('2026-11-01', tz) / 1000, tz), '2026-11-01')
  assert.equal(coerceDate('hello', tz), null)
  assert.equal(coerceDate('', tz), null)
  assert.equal(coerceDate(null, tz), null)
})

test('kind 过滤：标题/摘要类辅助调用不计用量，无 kind 的旧日志保留', () => {
  const rec = (kind) => JSON.stringify({
    type: 'assistant/message',
    time: 1000,
    data: { message: { role: 'assistant', id: 'm1', source: { kind, provider: 'p', model: 'm' } }, usage: { inputTokens: 5, outputTokens: 1 } },
  })
  const withKind = [rec('model'), rec('title'), rec('compaction')].join('\n')
  assert.equal(parseLogText(withKind).length, 1)
  const legacy = JSON.stringify({
    type: 'assistant/message',
    time: 1000,
    data: { message: { source: { provider: 'p', model: 'm' } }, usage: { inputTokens: 5, outputTokens: 1 } },
  })
  assert.equal(parseLogText(legacy).length, 1)
})

test('配置备份：坏主文件自动回退 .bak，并给出提示', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-bak-'))
  const file = path.join(dir, CONFIG_FILE)
  saveConfig(dir, { currency: { symbol: '¥' }, models: { 'a:b': { offPeak: { input: 3, cacheRead: 0.3, output: 12 } } } })
  saveConfig(dir, { currency: { symbol: '$' }, models: { 'a:b': { offPeak: { input: 9, cacheRead: 1, output: 9 } } } })
  fs.writeFileSync(file, '{ broken json !!!', 'utf8')
  const { config, error } = loadConfig(dir)
  assert.equal(error, '价格配置损坏，已自动恢复到上一版备份')
  assert.equal(config.currency.symbol, '¥')
  assert.equal(config.models['a:b'].offPeak.input, 3)
})

test('缓存写入价：m_cw/M_cw 落盘且不影响其他模型', () => {
  const base = {
    currency: { perTokens: 1_000_000 },
    peak: { enabled: true, windows: [], weekend: 'offPeak', holidays: [], tz: 'Asia/Shanghai' },
    models: {
      'a:b': { offPeak: { input: 1, cacheRead: 0.1, output: 4 } },
      'c:d': { offPeak: { input: 2, cacheRead: 0.2, output: 8 } },
    },
  }
  const r = applyModelSettings(base, { m_sel: 'a:b', m_in: 1, m_cr: 0.1, m_cw: 1.25, m_out: 4, M_cw: 2.5 }, {}, 'a:b')
  assert.equal(r.error, undefined)
  assert.equal(r.config.models['a:b'].offPeak.cacheWrite, 1.25)
  assert.equal(r.config.models['a:b'].peak.cacheWrite, 2.5)
  assert.equal(r.config.models['c:d'].offPeak.cacheWrite, undefined)
  const r2 = applyModelSettings(base, { m_sel: 'a:b', m_in: 1 }, {}, 'a:b')
  assert.equal('cacheWrite' in r2.config.models['a:b'].offPeak, false, '没提交就不新增键')
})

test('isZeroEntry：全 0 与空条目算未填价，任一非 0 即已填', () => {
  assert.equal(isZeroEntry({ offPeak: { input: 0, cacheRead: 0, output: 0 } }), true)
  assert.equal(isZeroEntry({}), true)
  assert.equal(isZeroEntry({ offPeak: { input: 0.01 } }), false)
})

const fakeState = (over = {}) => ({
  today: { amount: 1, calls: 10, tokens: { input: 1, cacheRead: 2, cacheWrite: 0, output: 3 }, parts: { input: 0.4, cacheRead: 0.4, cacheWrite: 0, output: 0.2 }, peak: { amount: 0, calls: 0, tokens: 0 }, offPeak: { amount: 1, calls: 10, tokens: 6 }, unpriced: { calls: 0, tokens: 0 } },
  session: { amount: 0, calls: 0, tokens: {}, parts: {}, peak: {}, offPeak: {}, unpriced: { calls: 0, tokens: 0 } },
  week: { amount: 2, calls: 20, tokens: {}, parts: {}, peak: {}, offPeak: {}, unpriced: { calls: 0, tokens: 0 } },
  models: [],
  range: null,
  rangeModels: [],
  daily: [],
  rangeMode: 'today',
  rangeWindow: null,
  hasSession: false,
  isPeak: true,
  nextSwitch: { at: Date.now() + 8 * 3_600_000, peak: false },
  unreadable: 0,
  now: Date.now(),
  ...over,
})
const cfg = { currency: { symbol: '¥', perTokens: 1_000_000, decimals: 3 }, peak: { enabled: true, tz: 'Asia/Shanghai', windows: [{ start: '08:00', end: '22:00' }], weekend: 'offPeak', holidays: [] }, models: {} }

test('峰谷提示：给出切换时刻与约几小时', () => {
  const text = JSON.stringify(costView(cfg, fakeState(), { locale: 'zh-CN' }))
  assert.ok(/转谷时（约 \d+(\.\d+)? 小时）/.test(text), text.slice(0, 400))
})

test('趋势图：跨天数据出柱状图，单日不出', () => {
  const two = JSON.stringify(costView(cfg, fakeState({ daily: [{ date: '2026-11-04', amount: 1, calls: 5 }, { date: '2026-11-05', amount: 2, calls: 5 }] }), { locale: 'zh-CN' }))
  assert.ok(two.includes('"bar"'))
  assert.ok(two.includes('每日费用'))
  const one = JSON.stringify(costView(cfg, fakeState({ daily: [{ date: '2026-11-05', amount: 2, calls: 5 }] }), { locale: 'zh-CN' }))
  assert.ok(!one.includes('"bar"'))
})

test('模型行标记：兜底价与未填价可见', () => {
  const state = fakeState({
    range: { ...fakeState().today },
    rangeModels: [
      { model: 'known', provider: 'p', amount: 1, calls: 5, tokens: 100, priced: 5, fallback: 3 },
      { model: 'zero', provider: '', amount: 0, calls: 2, tokens: 50, priced: 2, fallback: 0 },
    ],
  })
  const text = JSON.stringify(costView(cfg, state, { locale: 'zh-CN' }))
  assert.ok(text.includes('按兜底价'))
  assert.ok(text.includes('未填价'))
})

test('列表画面：全 0 模型标未填价；编辑画面含缓存写入字段', () => {
  const config = { ...cfg, models: { 'p:a': { offPeak: { input: 0, cacheRead: 0, output: 0 } }, 'p:b': { offPeak: { input: 1, cacheRead: 0.1, output: 4 } } } }
  const options = [{ key: 'p:a', entry: config.models['p:a'], label: 'a', short: 'a', provider: 'p' }, { key: 'p:b', entry: config.models['p:b'], label: 'b', short: 'b', provider: 'p' }]
  const list = JSON.stringify(pricesView(config, options, { locale: 'zh-CN' }, { screen: 'list', selected: 'p:a' }))
  assert.ok(list.includes('未填价'))
  const edit = JSON.stringify(pricesView(config, options, { locale: 'zh-CN' }, { screen: 'edit', selected: 'p:b' }))
  assert.ok(edit.includes('data.m_cw') && edit.includes('data.M_cw'))
})

test('pricesData 带缓存写入初值', () => {
  const config = { ...cfg, models: { 'p:a': { offPeak: { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 4 }, peak: { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 8 } } } }
  const data = pricesData(config, 'p:a', null)
  assert.equal(data.m_cw, 1.25)
  assert.equal(data.M_cw, 2.5)
})
