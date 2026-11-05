import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, clone, parseWindows, sanitize, toMinutes } from '../lib/config.js'
import { costParts, isPeakAt, nextSwitch, resolvePrice, wallClock } from '../lib/pricing.js'
import { share, summarize } from '../lib/summary.js'
import { collectFields, applyFields, pricesData } from '../lib/editor.js'

const at = (iso) => Date.parse(iso)
const config = () => sanitize(clone(DEFAULT_CONFIG)).config
const peakAt = (iso, cfg = config()) => isPeakAt(wallClock(at(iso), cfg.peak.tz), cfg.peak, at(iso))

test('峰时段边界：09:00 起、12:00 止', () => {
  assert.equal(peakAt('2026-11-05T08:59:00+08:00'), false)
  assert.equal(peakAt('2026-11-05T09:00:00+08:00'), true)
  assert.equal(peakAt('2026-11-05T11:59:00+08:00'), true)
  assert.equal(peakAt('2026-11-05T12:00:00+08:00'), false)
  assert.equal(peakAt('2026-11-05T14:00:00+08:00'), true)
  assert.equal(peakAt('2026-11-05T18:00:00+08:00'), false)
})

test('跨午夜窗口', () => {
  const cfg = config()
  cfg.peak.windows = [{ start: '22:00', end: '02:00' }]
  assert.equal(peakAt('2026-11-05T23:30:00+08:00', cfg), true)
  assert.equal(peakAt('2026-11-05T01:30:00+08:00', cfg), true)
  assert.equal(peakAt('2026-11-05T02:00:00+08:00', cfg), false)
  assert.equal(peakAt('2026-11-05T12:00:00+08:00', cfg), false)
})

test('周末与假日按谷时；weekend=peak 时整天峰时', () => {
  const cfg = config()
  assert.equal(peakAt('2026-11-07T10:00:00+08:00', cfg), false)
  cfg.peak.weekend = 'peak'
  assert.equal(peakAt('2026-11-07T03:00:00+08:00', cfg), true)
  cfg.peak.weekend = 'ignore'
  assert.equal(peakAt('2026-11-07T10:00:00+08:00', cfg), true)
  cfg.peak.holidays = ['2026-11-05']
  assert.equal(peakAt('2026-11-05T10:00:00+08:00', cfg), false)
})

test('峰谷关闭时全天谷价', () => {
  const cfg = config()
  cfg.peak.enabled = false
  assert.equal(peakAt('2026-11-05T10:00:00+08:00', cfg), false)
  assert.equal(nextSwitch(cfg.peak, at('2026-11-05T10:00:00+08:00'), { tz: cfg.peak.tz }), null)
})

test('下一次切换落在 12:00', () => {
  const cfg = config()
  const next = nextSwitch(cfg.peak, at('2026-11-05T10:30:00+08:00'), { tz: cfg.peak.tz })
  assert.ok(next)
  assert.equal(next.peak, false)
  const clock = wallClock(next.at, cfg.peak.tz)
  assert.equal(clock.minutes, 12 * 60)
})

test('模型匹配：provider:model → model → default → 未命中', () => {
  const cfg = config()
  const key = 'custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017'
  assert.equal(resolvePrice(cfg.models, 'custom-dashscope-aliyuncs', 'deepseek-v4.1-flash-1017').key, key)
  assert.equal(resolvePrice(cfg.models, 'other', 'deepseek-v4.1-flash-1017').key, key)
  cfg.models['DeepSeek_V4.1_Flash'] = { offPeak: { input: 9, output: 9 } }
  assert.equal(resolvePrice(cfg.models, 'x', 'deepseek v4.1 flash').key, 'DeepSeek_V4.1_Flash')
  assert.equal(resolvePrice(cfg.models, 'x', 'nothing'), null)
  cfg.models.default = { offPeak: { input: 2 } }
  assert.equal(resolvePrice(cfg.models, 'x', 'nothing').matched, 'default')
})

test('分项成本：三项之和等于总额，占比合计 100%', () => {
  const call = { input: 1000, cacheRead: 2000, cacheWrite: 0, output: 500 }
  const { parts } = costParts(call, { input: 1, cacheRead: 0.1, output: 4 }, 1_000_000)
  assert.ok(Math.abs(parts.input - 0.001) < 1e-12)
  assert.ok(Math.abs(parts.cacheRead - 0.0002) < 1e-12)
  assert.ok(Math.abs(parts.output - 0.002) < 1e-12)
  assert.ok(Math.abs(parts.total - 0.0032) < 1e-12)
  const sum = [parts.input, parts.cacheRead, parts.output].reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - parts.total) < 1e-12)
  const ratios = [parts.input, parts.cacheRead, parts.output].map((p) => share(p, parts.total))
  assert.ok(Math.abs(ratios.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  assert.equal(share(1, 0), null)
})

test('聚合：今日分项、峰谷拆分、按模型', () => {
  const cfg = config()
  const key = 'custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017'
  cfg.models[key] = { offPeak: { input: 1, cacheRead: 0.1, output: 4 }, peak: { input: 2, cacheRead: 0.2, output: 8 } }
  const calls = [
    { t: at('2026-11-05T10:00:00+08:00'), provider: 'custom-dashscope-aliyuncs', model: 'deepseek-v4.1-flash-1017', input: 1000, cacheRead: 0, cacheWrite: 0, output: 100, session: 'session-a' },
    { t: at('2026-11-05T20:00:00+08:00'), provider: 'custom-dashscope-aliyuncs', model: 'deepseek-v4.1-flash-1017', input: 1000, cacheRead: 0, cacheWrite: 0, output: 100, session: 'session-a' },
  ]
  const now = at('2026-11-05T21:00:00+08:00')
  const state = summarize(calls, cfg, { sessionId: 'session-a', now })
  assert.equal(state.today.calls, 2)
  assert.equal(state.today.peak.calls, 1)
  assert.equal(state.today.offPeak.calls, 1)
  assert.ok(Math.abs(state.today.peak.amount - (1000 * 2 + 100 * 8) / 1e6) < 1e-12)
  assert.ok(Math.abs(state.today.offPeak.amount - (1000 * 1 + 100 * 4) / 1e6) < 1e-12)
  assert.equal(state.session.calls, 2)
  assert.equal(state.models[0].model, 'deepseek-v4.1-flash-1017')
})

test('未定价调用不进金额、单列计数', () => {
  const cfg = config()
  cfg.models = {}
  const calls = [{ t: at('2026-11-05T10:00:00+08:00'), provider: 'p', model: 'm', input: 10, cacheRead: 0, cacheWrite: 0, output: 5, session: 's' }]
  const state = summarize(calls, cfg, { sessionId: 's', now: at('2026-11-05T11:00:00+08:00') })
  assert.equal(state.today.amount, 0)
  assert.equal(state.today.unpriced.calls, 1)
  assert.equal(state.today.unpriced.tokens, 15)
})

test('配置清洗：坏峰时段跳过、负价归零、周末非法回退', () => {
  const { config: cfg, issues } = sanitize({
    peak: { windows: [{ start: '25:00', end: 'x' }, { start: '9:00', end: '10:00' }], weekend: 'nope' },
    models: { m: { offPeak: { input: -5, output: '3' } } },
  })
  assert.deepEqual(cfg.peak.windows, [{ start: '09:00', end: '10:00' }])
  assert.equal(cfg.peak.weekend, 'offPeak')
  assert.equal(cfg.models.m.offPeak.input, 0)
  assert.equal(cfg.models.m.offPeak.output, 3)
  assert.ok(issues.length >= 2)
})

test('峰时段解析', () => {
  assert.deepEqual(parseWindows('09:00-12:00, 14:00-18:00'), [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ])
  assert.equal(parseWindows('09:00'), null)
  assert.equal(parseWindows('09:00-09:00'), null)
  assert.equal(toMinutes('9:05'), 545)
})

test('表单字段收集与保存', () => {
  const cfg = config()
  const data = pricesData(cfg)
  assert.ok('p0_in' in data)
  const payload = { data: { ...data, p0_in: '3', P0_in: '6', g_windows: '08:00-10:00' } }
  const fields = collectFields(payload)
  assert.equal(fields.p0_in, '3')
  const messages = { windows: 'bad', weekend: 'bad' }
  const applied = applyFields(cfg, fields, messages)
  assert.equal(applied.error, null)
  assert.equal(applied.config.peak.windows[0].start, '08:00')
  const model = applied.config.models['custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017']
  assert.equal(model.offPeak.input, 3)
  assert.equal(model.peak.input, 6)
  const bad = applyFields(cfg, { g_windows: 'nope' }, messages)
  assert.equal(bad.error, 'bad')
})