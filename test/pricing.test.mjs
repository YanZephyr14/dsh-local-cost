import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, clone, parseWindows, sanitize, toMinutes } from '../lib/config.js'
import { costParts, effectivePeak, isPeakAt, nextSwitch, priceCall, resolvePrice, wallClock } from '../lib/pricing.js'
import { share, summarize } from '../lib/summary.js'
import { collectFields, applyPeak, applyModels, applyAddModel, applyCurrency, applyDefault, deleteModel, addUnpriced, editableModels, ensureModelEntry, modelOptions, pricesData, selectionOf, unpricedModels } from '../lib/editor.js'
import { applyGlobalTemplate, applyModelTemplate } from '../lib/templates.js'

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

test('时段表单：只改窗口不动价格', () => {
  const cfg = config()
  const before = JSON.stringify(cfg.models)
  const fields = collectFields({ data: { g_windows: '08:00-10:00', g_weekend: 'ignore' } })
  const r = applyPeak(cfg, fields, { windows: 'bad', weekend: 'bad' })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.config.peak.windows, [{ start: '08:00', end: '10:00' }])
  assert.equal(r.config.peak.weekend, 'ignore')
  assert.equal(JSON.stringify(r.config.models), before)
  assert.equal(applyPeak(cfg, { g_windows: 'nope' }, { windows: 'bad' }).error, 'bad')
  assert.equal(applyPeak(cfg, { g_weekend: '周末' }, { weekend: 'bad-wk' }).error, 'bad-wk')
})

test('单价表单：只作用于选中模型', () => {
  const cfg = config()
  const key = Object.keys(cfg.models)[0]
  cfg.models.second = { offPeak: { input: 7, cacheRead: 0, output: 8 }, peak: { input: 7, cacheRead: 0, output: 8 } }
  const fields = collectFields({ data: { m_in: '3', m_cr: '0.3', m_out: '9', M_in: '6', M_cr: '0.6', M_out: '18' } })
  const r = applyModels(cfg, fields, { noChange: 'same', notFound: 'nf' }, key)
  assert.equal(r.error, undefined)
  assert.equal(r.key, key)
  assert.deepEqual(r.config.models[key].offPeak, { input: 3, cacheRead: 0.3, output: 9 })
  assert.deepEqual(r.config.models[key].peak, { input: 6, cacheRead: 0.6, output: 18 })
  assert.deepEqual(r.config.models.second, cfg.models.second, '别的模型不动')
  // m_sel 指定另一个模型
  const r2 = applyModels(cfg, { m_sel: 'second', m_in: 5 }, { noChange: 'same', notFound: 'nf' }, key)
  assert.equal(r2.config.models.second.offPeak.input, 5)
  assert.equal(r2.config.models[key].offPeak.input, 1)
  assert.equal(applyModels(cfg, { m_in: 1 }, { noChange: 'same', notFound: 'nf' }, 'ghost').error, 'nf')
  assert.equal(applyModels(cfg, collectFields({ data: pricesData(cfg, key) }), { noChange: 'same', notFound: 'nf' }, key).error, 'same')
})

test('选中模型：失效回落第一个；数据跟着选中切换', () => {
  const cfg = config()
  const keys = modelOptions(cfg).map((m) => m.key)
  assert.equal(selectionOf(cfg, 'ghost'), keys[0])
  assert.equal(selectionOf(cfg, null), keys[0])
  const data = pricesData(cfg, keys[0])
  assert.equal(data.m_sel, keys[0])
  assert.equal(data.m_in, 1)
})

test('每个模型可以覆盖/清空峰时段（m_windows）', () => {
  const cfg = config()
  const key = Object.keys(cfg.models)[0]
  const set = applyModels(cfg, collectFields({ data: { m_windows: '08:00-22:00' } }), { windows: 'bad', noChange: 'same', notFound: 'nf' }, key)
  assert.equal(set.error, undefined)
  assert.deepEqual(set.config.models[key].schedule.windows, [{ start: '08:00', end: '22:00' }])
  const cleared = applyModels(set.config, collectFields({ data: { m_windows: '' } }), { windows: 'bad', noChange: 'same', notFound: 'nf' }, key)
  assert.equal(cleared.config.models[key].schedule, undefined)
  assert.equal(applyModels(cfg, { m_windows: 'nope' }, { windows: 'bad', noChange: 'same' }, key).error, 'bad')
})

test('ensureModelEntry：未定价模型一键建条目（抄 default）', () => {
  const cfg = config()
  cfg.models.default = { offPeak: { input: 2, cacheRead: 0.2, output: 8 } }
  const r = ensureModelEntry(cfg, 'qwen3.8-flash')
  assert.equal(r.created, true)
  assert.deepEqual(r.config.models['qwen3.8-flash'].offPeak, { input: 2, cacheRead: 0.2, output: 8 })
  assert.deepEqual(r.config.models['qwen3.8-flash'].peak, { input: 2, cacheRead: 0.2, output: 8 })
  const again = ensureModelEntry(r.config, 'qwen3.8-flash')
  assert.equal(again.created, false)
  assert.equal(ensureModelEntry(cfg, '').error, 'key')
  assert.equal(Object.keys(cfg.models).length, 2, '原配置不动')
})

test('新增模型：空 key / 重名 / 正常', () => {
  const cfg = config()
  const msgs = { needKey: 'need', badKey: 'bad', exists: 'dup', full: 'full' }
  assert.equal(applyAddModel(cfg, { n_key: '  ' }, msgs).error, 'need')
  assert.equal(applyAddModel(cfg, { n_key: Object.keys(cfg.models)[0] }, msgs).error, 'dup')
  const r = applyAddModel(cfg, { n_key: 'openai:gpt-6', n_in: '10', n_cr: '1', n_out: '40' }, msgs)
  assert.equal(r.added, 'openai:gpt-6')
  assert.deepEqual(r.config.models['openai:gpt-6'].offPeak, { input: 10, cacheRead: 1, output: 40 })
  assert.deepEqual(r.config.models['openai:gpt-6'].peak, { input: 10, cacheRead: 1, output: 40 })
  assert.equal(Object.keys(cfg.models).length, 1, '原配置不应被改')
})

test('未定价模型：识别 + 批量并入（抄 default）', () => {
  const cfg = config()
  cfg.models.default = { offPeak: { input: 2, cacheRead: 0.2, output: 8 } }
  const state = {
    models: [
      { model: 'a-new', calls: 3, tokens: 100, amount: 0, priced: 0 },
      { model: 'deepseek-v4.1-flash-1017', calls: 5, tokens: 200, amount: 1, priced: 5 },
    ],
  }
  const pending = unpricedModels(state, cfg)
  assert.deepEqual(pending, ['a-new'])
  const { config: next, added } = addUnpriced(cfg, pending)
  assert.deepEqual(added, ['a-new'])
  assert.deepEqual(next.models['a-new'].offPeak, { input: 2, cacheRead: 0.2, output: 8 })
  assert.deepEqual(unpricedModels({ models: state.models.map((r) => ({ ...r, priced: 1 })) }, next), [])
})

test('非法时区被拒绝并给出提示', () => {
  const { config: cfg, issues } = sanitize({ peak: { tz: 'Mars/Base' } })
  assert.equal(cfg.peak.tz, DEFAULT_CONFIG.peak.tz)
  assert.ok(issues.some((m) => m.includes('时区')))
  assert.equal(sanitize({ peak: { tz: 'UTC' } }).issues.length, 0)
})

test('模型自己的峰时段覆盖全局（百炼 8–22 点）', () => {
  const cfg = config()
  cfg.peak = { enabled: true, tz: 'Asia/Shanghai', windows: [{ start: '09:00', end: '12:00' }], weekend: 'offPeak', holidays: [] }
  cfg.models.bailian = {
    offPeak: { input: 1, output: 4 },
    peak: { input: 2, output: 8 },
    schedule: { windows: [{ start: '08:00', end: '22:00' }], weekend: 'ignore' },
  }
  const clock = (iso) => wallClock(at(iso), 'Asia/Shanghai')
  const entry = cfg.models.bailian
  assert.equal(isPeakAt(clock('2026-11-05T10:00:00+08:00'), effectivePeak(cfg, entry), at('2026-11-05T10:00:00+08:00')), true)
  assert.equal(isPeakAt(clock('2026-11-05T12:30:00+08:00'), effectivePeak(cfg, entry), at('2026-11-05T12:30:00+08:00')), true)
  assert.equal(isPeakAt(clock('2026-11-05T23:00:00+08:00'), effectivePeak(cfg, entry), at('2026-11-05T23:00:00+08:00')), false)
  // 周六：全局按谷时，但该模型 weekend=ignore，8 点仍算峰
  assert.equal(isPeakAt(clock('2026-11-07T10:00:00+08:00'), effectivePeak(cfg, entry), at('2026-11-07T10:00:00+08:00')), true)
  // 没有 schedule 的模型继续用全局
  assert.equal(isPeakAt(clock('2026-11-07T10:00:00+08:00'), effectivePeak(cfg, cfg.models[Object.keys(cfg.models)[0]]), at('2026-11-07T10:00:00+08:00')), false)
})

test('priceCall 按模型规则算钱', () => {
  const cfg = config()
  cfg.models.bailian = { offPeak: { input: 1, output: 4 }, peak: { input: 2, output: 8 }, schedule: { windows: [{ start: '08:00', end: '22:00' }], weekend: 'ignore' } }
  const call = { t: at('2026-11-05T10:00:00+08:00'), provider: 'x', model: 'bailian', input: 1000, cacheRead: 0, cacheWrite: 0, output: 100 }
  const r = priceCall(call, cfg, wallClock(call.t, 'Asia/Shanghai'))
  assert.equal(r.peak, true)
  assert.ok(Math.abs(r.total - (1000 * 2 + 100 * 8) / 1e6) < 1e-12)
})

test('兜底价 default、单位、删除模型', () => {
  const cfg = config()
  const d = applyDefault(cfg, collectFields({ data: { d_in: '3', d_out: '12', D_in: '6', D_out: '24' } }), { needRate: 'need' })
  assert.equal(d.error, undefined)
  assert.deepEqual(d.config.models.default.offPeak, { input: 3, cacheRead: 0, output: 12 })
  assert.deepEqual(d.config.models.default.peak, { input: 6, cacheRead: 0, output: 24 })
  // 未匹配模型命中 default
  assert.equal(resolvePrice(d.config.models, 'x', 'nothing').matched, 'default')

  const cur = applyCurrency(cfg, collectFields({ data: { c_symbol: 'US$', c_per: '1000', c_dec: '4' } }))
  assert.equal(cur.config.currency.symbol, 'US$')
  assert.equal(cur.config.currency.perTokens, 1000)
  assert.equal(cur.config.currency.decimals, 4)

  const key = editableModels(cfg)[0].key
  const del = deleteModel(cfg, { del_key: key }, { needKey: 'need', notDeletable: 'no', notFound: 'nf' })
  assert.equal(del.removed, key)
  assert.equal(del.config.models[key], undefined)
  assert.equal(deleteModel(cfg, { del_key: 'default' }, { notDeletable: 'no' }).error, 'no')
  assert.equal(deleteModel(cfg, { del_key: 'nope' }, { notFound: 'nf' }).error, 'nf')
})

test('全局模板：只改时段，不碰价格', () => {
  const cfg = config()
  const key = Object.keys(cfg.models)[0]
  const before = JSON.stringify(cfg.models)
  const bailian = applyGlobalTemplate(cfg, 'bailian')
  assert.deepEqual(bailian.config.peak.windows, [{ start: '08:00', end: '22:00' }])
  assert.equal(bailian.config.peak.weekend, 'ignore')
  assert.deepEqual(bailian.config.peak.holidays, [])
  assert.equal(JSON.stringify(bailian.config.models), before)
  assert.equal(applyGlobalTemplate(cfg, 'flat').config.peak.enabled, false)
  assert.equal(applyGlobalTemplate(cfg, 'proto').error, 'tpl')
  assert.equal(applyGlobalTemplate(cfg, 'constructor').error, 'tpl')
})

test('模型模板：峰谷关系只动选中模型', () => {
  const cfg = config()
  cfg.models.other = { offPeak: { input: 5, cacheRead: 0.5, output: 20 } }
  const key = Object.keys(cfg.models)[0]
  cfg.models[key] = { offPeak: { input: 1, cacheRead: 0.1, output: 4 }, peak: { input: 1, cacheRead: 0.1, output: 4 } }
  const p2 = applyModelTemplate(cfg, key, 'peak2x')
  assert.deepEqual(p2.config.models[key].peak, { input: 2, cacheRead: 0.2, output: 8 })
  assert.deepEqual(p2.config.models.other, cfg.models.other, '别的模型不动')
  const half = applyModelTemplate(p2.config, key, 'half')
  assert.deepEqual(half.config.models[key].offPeak, { input: 1, cacheRead: 0.1, output: 4 })
  const same = applyModelTemplate(p2.config, key, 'same')
  assert.deepEqual(same.config.models[key].peak, same.config.models[key].offPeak)
  const sched = applyModelTemplate(cfg, key, 'peak2x')
  sched.config.models[key].schedule = { windows: [{ start: '08:00', end: '22:00' }], weekend: 'ignore' }
  const back = applyModelTemplate(sched.config, key, 'global')
  assert.deepEqual(back.config.models[key].schedule, { weekend: 'ignore' })
  assert.equal(applyModelTemplate(cfg, 'ghost', 'peak2x').error, 'nf')
  assert.equal(applyModelTemplate(cfg, key, 'nope').error, 'tpl')
})

test('计价模式：推断、切换、模板联动', async () => {
  const { inferMode, sanitize: san } = await import('../lib/config.js')
  const { applyMode } = await import('../lib/editor.js')
  assert.equal(inferMode({ peak: { enabled: false }, models: {} }), 'flat')
  assert.equal(inferMode({ peak: { enabled: true }, models: { a: { schedule: { windows: [{ start: '08:00', end: '09:00' }] } } } }), 'perModel')
  assert.equal(inferMode({ peak: { enabled: true }, models: { a: {} } }), 'global')
  const kept = san({ mode: 'perModel', peak: { enabled: true }, models: { a: { offPeak: { input: 1 } } } })
  assert.equal(kept.config.mode, 'perModel')
  const inferred = san({ peak: { enabled: false }, models: { a: { offPeak: { input: 1 } } } })
  assert.equal(inferred.config.mode, 'flat')
  const flat = applyMode(config(), 'flat')
  assert.equal(flat.config.mode, 'flat')
  assert.equal(flat.config.peak.enabled, false)
  assert.equal(applyMode(flat.config, 'global').config.peak.enabled, true)
  assert.equal(applyMode(config(), 'nope').error, 'mode')
  assert.equal(applyMode(config(), 'constructor').error, 'mode')
  const tpl = applyGlobalTemplate({ ...config(), mode: 'flat' }, 'bailian')
  assert.equal(tpl.config.mode, 'global')
  assert.equal(applyGlobalTemplate({ ...config(), mode: 'perModel' }, 'official').config.mode, 'perModel')
  assert.equal(applyGlobalTemplate(config(), 'flat').config.mode, 'flat')
})

test('模式面板：三种模式的视图都合法且字段随模式增减', async () => {
  const { pricesView } = await import('../lib/views.js')
  const { pricesData, modelOptions, selectionOf } = await import('../lib/editor.js')
  const { checkView } = await import('/root/.dsh/skills/dsh-go-plugin/kit/lib/view-check.js')
  const countInputs = (n) => {
    let c = ['textField', 'number', 'segmented', 'select'].includes(n.type) ? 1 : 0
    for (const k of ['children']) for (const x of n[k] ?? []) c += countInputs(x)
    for (const it of n.items ?? []) for (const x of it.children ?? []) c += countInputs(x)
    return c
  }
  const cfg = config()
  for (const mode of ['flat', 'global', 'perModel']) {
    const c = { ...cfg, mode }
    const view = pricesView(c, modelOptions(c), { locale: 'zh-CN' }, { selected: selectionOf(c, null), unpriced: [], hiddenModels: 0 })
    const text = JSON.stringify(view)
    const r = checkView(view, { budget: 'panel', lang: 'zh', data: pricesData(c, selectionOf(c, null)) })
    assert.ok(r.ok, `${mode} 视图非法`)
    assert.equal(r.issues.filter((i) => i.kind === 'broken').length, 0, mode)
    const n = countInputs(view)
    assert.ok(n <= 32, `${mode} 输入框 ${n} 超预算`)
    if (mode === 'flat') {
      assert.ok(!text.includes('data.M_in'), 'flat 不应有峰价字段')
      assert.ok(!text.includes('data.g_windows'), 'flat 不应有时段字段')
    } else {
      assert.ok(text.includes('data.M_in'))
      assert.ok(text.includes('data.g_windows'))
    }
    assert.equal(text.includes('data.m_windows'), mode === 'perModel')
  }
})
