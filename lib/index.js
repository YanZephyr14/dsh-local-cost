// local-cost：自配价格的峰谷计费。宿主侧只做三件事——扫日志、算钱、把视图交给 App。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { createScanner } from './usage.js'
import { summarize } from './summary.js'
import { dayStartMs, isPeakAt, localDate, nextSwitch, resolvePrice, wallClock } from './pricing.js'
import { costView, money, pricesView, translator } from './views.js'
import { applyGlobalTemplate, applyModelTemplate } from './templates.js'
import {
  applyAddModel,
  applyCurrency,
  applyDefault,
  applyPeak,
  addUnpriced,
  applyModelSettings,
  collectFields,
  costRangeData,
  deleteModel,
  editableModels,
  ensureModelEntry,
  modelOptions,
  pricesData,
  selectionOf,
  unpricedModels,
} from './editor.js'

export const name = 'local-cost'

const dir = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')

/** 写到 stderr：检查器的 --json 读 stdout，不能被插件日志污染。 */
function log(message) {
  try {
    process.stderr.write(`[local-cost] ${message}\n`)
  } catch {
    /* 日志失败不影响插件 */
  }
}
const scanner = createScanner()

/** 价格面板当前编辑的模型；跨动作保持，失效时回落到第一个。 */
let selectedKey = null

/** 价格面板画面：list=模型一览，edit=单模型设置。 */
let screen = 'list'

/** 「全天一个价 / 按时段峰谷」刚点选、还没保存时的即时状态。 */
let modeOverride = null

/** 费用面板时间范围：预设或自定义（本地日期串）。 */
let rangeMode = 'today'
let customFrom = null
let customTo = null
const RANGE_MODES = new Set(['today', 'yesterday', 'week', 'month', 'custom'])

/** 当前选择对应的 [from, to) 毫秒窗口；自定义日期没填好时 null。 */
function windowFor(tz, now) {
  const dayMs = 86_400_000
  const todayStart = dayStartMs(localDate(now, tz), tz) ?? now
  switch (rangeMode) {
    case 'yesterday':
      return { from: todayStart - dayMs, to: todayStart }
    case 'week':
      return { from: now - 7 * dayMs, to: now }
    case 'month':
      return { from: now - 30 * dayMs, to: now }
    case 'custom': {
      const from = dayStartMs(customFrom, tz)
      const toStart = dayStartMs(customTo, tz)
      if (from === null || toStart === null || toStart < from) return null
      return { from, to: toStart + dayMs }
    }
    default:
      return { from: todayStart, to: now }
  }
}

/** 一次取数：配置 + 调用记录 + 聚合 + 当前峰谷。 */
function snapshot(sessionId) {
  const { config, error } = loadConfig(dir)
  const scan = scanner.scan()
  const now = Date.now()
  const tz = config.peak?.tz || 'Asia/Shanghai'
  const rangeWindow = windowFor(tz, now)
  const state = summarize(scan.calls, config, { sessionId, now, range: rangeWindow })
  const clock = wallClock(now, tz)
  return {
    config,
    configError: error,
    now,
    today: state.today,
    session: state.session,
    week: state.week,
    models: state.models,
    range: state.range,
    rangeModels: state.rangeModels,
    rangeMode,
    rangeWindow,
    hasSession: Boolean(sessionId),
    isPeak: isPeakAt(clock, config.peak, now),
    nextSwitch: nextSwitch(config.peak, now, { tz }),
    unreadable: scan.unreadable,
  }
}

/** 动作返回时顺带推一份当前选中模型的数据，避免 refresh 只换视图不换输入框值。 */
function dataFor() {
  const { config } = loadConfig(dir)
  return pricesData(config, selectionOf(config, selectedKey), modeOverride)
}

/** 费用面板时间选择器的数据；动作返回时一起 patch，避免画面新值旧。 */
function costData(tz = 'Asia/Shanghai') {
  if (rangeMode === 'custom' && (!customFrom || !customTo)) {
    const now = Date.now()
    customTo = localDate(now, tz)
    customFrom = localDate(now - 6 * 86_400_000, tz)
  }
  return costRangeData(rangeMode, customFrom, customTo)
}

function stripText(state, t) {
  const total = state.today.amount
  const mark = total > 0 ? money(state.config, total) : state.today.unpriced.calls > 0 ? '—' : money(state.config, 0)
  const parts = [`${t('today')} ${mark}`]
  if (state.today.unpriced.calls > 0) parts.push(`${t('unpricedShort')} ${state.today.unpriced.calls}`)
  else if (state.config.peak?.enabled !== false) parts.push(state.isPeak ? t('peak') : t('offPeak'))
  return parts.join(' · ').slice(0, 24)
}

/** 新增模型（价格面板「兜底与单位」页签）。 */
function runAddModel(event) {
  const t = translator(event?.locale)
  const fields = collectFields(event?.value)
  return persist(
    fields,
    (config, f) => applyAddModel(config, f, { needKey: t('needKey'), badKey: t('badKey'), exists: t('exists'), full: t('full') }),
    t,
    (result) => {
      if (result.added) {
        selectedKey = result.added
        screen = 'edit'
      }
      return t('saved')
    },
    event?.value,
  )
}

/** 把认不出的 payload 落一份盘，方便离线排查（引擎 stdout 抓不到时用）。 */
function dumpDebug(action, raw) {
  try {
    const home = process.env.DSH_HOME || path.join(process.env.HOME || '/root', '.dsh')
    const file = path.join(home, 'storages', 'local-cost', 'debug.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let text
    try {
      text = JSON.stringify(raw)
    } catch {
      text = String(raw)
    }
    fs.writeFileSync(
      file,
      `${JSON.stringify({ at: new Date().toISOString(), action, bytes: text?.length ?? 0, raw: JSON.parse(text ?? 'null') }, null, 2)}\n`,
    )
  } catch {
    /* 调试信息写不进去不影响功能 */
  }
}

/** 模板按钮的 args 形状兜底：{tpl} / {args:{tpl}} / 直接字符串。 */
function pickTpl(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    if (typeof value.tpl === 'string') return value.tpl
    if (value.args && typeof value.args.tpl === 'string') return value.args.tpl
  }
  return null
}

/** 打日志用：把任意 payload 压成一行，最多 300 字。 */
function describe(raw) {
  if (raw === undefined) return 'undefined'
  try {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    return text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return String(raw)
  }
}

/** 保存动作共用：拿到字段 → 合并 → 落盘 → 回一句提示并刷新面板。 */
function persist(fields, merge, t, done, raw) {
  const names = Object.keys(fields)
  if (names.length === 0) {
    // 认不出字段时把原始 payload 形状记下来，方便按 App 的真实格式校准。
    log(`未识别到字段，原始 value: ${describe(raw)}`)
    dumpDebug('unknown-payload', raw)
    return { toast: t('noFields') }
  }
  log(`收到字段: ${names.join(',')}`)
  const { config } = loadConfig(dir)
  const result = merge(config, fields)
  if (result.error) return { toast: result.error }
  try {
    saveConfig(dir, result.config)
  } catch {
    return { toast: t('saveFailed') }
  }
  const toast = done ? done(result) : t('saved')
  return { toast, refresh: true, patch: dataFor() }
}

export function apply(ctx) {
  const version = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
    } catch {
      return '?'
    }
  })()
  log(`已加载 v${version}，配置:${dir}/price.json`)
  // 只在有 dsh-go 桥接的手机本机引擎里生效。
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.strip('today', (scope, emit, caps) => {
      const t = translator(caps?.locale)
      const paint = () => {
        try {
          const state = snapshot(scope?.sessionId)
          emit({
            text: stripText(state, t),
            icon: 'coin',
            tone: state.today.unpriced.calls > 0 ? 'warn' : undefined,
          })
        } catch {
          emit({ text: `${t('today')} —`, icon: 'coin' })
        }
      }
      paint()
      const timer = setInterval(paint, 60_000)
      return () => clearInterval(timer)
    })

    ctx.dshGo.panel('cost', {
      view: (scope, caps) => {
        const state = snapshot(scope?.sessionId)
        return costView(state.config, state, caps)
      },
      data: (scope, emit) => {
        const { config } = loadConfig(dir)
        emit(costData(config.peak?.tz || 'Asia/Shanghai'))
        return () => {}
      },
      actions: {
        refresh: () => ({ refresh: true, patch: costData() }),
        openPrices: () => ({ open: 'panel:prices' }),
        setRange: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          const mode = fields.r_mode ?? event?.value?.value ?? (typeof event?.value === 'string' ? event?.value : null)
          if (!RANGE_MODES.has(mode)) return { toast: t('badRange') }
          rangeMode = mode
          const { config } = loadConfig(dir)
          const patch = costData(config.peak?.tz || 'Asia/Shanghai')
          return { refresh: true, patch }
        },
        applyRange: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          const { config } = loadConfig(dir)
          const tz = config.peak?.tz || 'Asia/Shanghai'
          const from = dayStartMs(fields.r_from, tz)
          const to = dayStartMs(fields.r_to, tz)
          if (from === null || to === null || to < from) {
            log(`区间日期未识别: ${describe(event?.value)}`)
            dumpDebug('applyRange', event?.value)
            return { toast: t('badRange'), refresh: true, patch: costData(tz) }
          }
          customFrom = localDate(from, tz)
          customTo = localDate(to, tz)
          rangeMode = 'custom'
          return { toast: t('rangeApplied'), refresh: true, patch: costData(tz) }
        },
        editModel: (scope, event) => {
          const t = translator(event?.locale)
          const model = event?.value?.model
          const provider = event?.value?.provider
          if (typeof model !== 'string' || model === '') return { toast: t('needKey') }
          const { config } = loadConfig(dir)
          // 优先落到真正生效的条目：已有 provider:model 或 model 命中就编辑它，
          // 都没有才新建 provider:model（无 provider 时新建裸名）。
          const hit = resolvePrice(config.models, provider, model)
          const wantKey = hit?.key ?? (provider ? `${provider}:${model}` : model)
          const result = ensureModelEntry(config, wantKey)
          if (result.error) return { toast: t('badKey') }
          if (result.created) {
            try {
              saveConfig(dir, result.config)
            } catch {
              return { toast: t('saveFailed') }
            }
          }
          selectedKey = result.key
          screen = 'edit'
          modeOverride = null
          return result.created ? [{ open: 'panel:prices' }, { toast: t('createdEntry') }] : { open: 'panel:prices' }
        },
      },
    })

    ctx.dshGo.panel('prices', {
      view: (scope, caps) => {
        const state = snapshot(scope?.sessionId)
        const options = modelOptions(state.config)
        selectedKey = selectionOf(state.config, selectedKey)
        const configured = Object.keys(state.config.models ?? {}).filter((key) => key !== 'default' && key !== '*').length
        if (screen === 'edit' && !options.some((m) => m.key === selectedKey)) screen = 'list'
        return pricesView(state.config, options, caps, {
          screen,
          selected: selectedKey,
          modeOverride,
          configError: state.configError,
          unpriced: unpricedModels(state, state.config),
          hiddenModels: Math.max(0, configured - options.length),
        })
      },
      data: (scope, emit) => {
        const { config } = loadConfig(dir)
        emit(pricesData(config, selectionOf(config, selectedKey), modeOverride))
        return () => {}
      },
      actions: {
        editModelSettings: (scope, event) => {
          const t = translator(event?.locale)
          const model = event?.value?.model
          if (typeof model !== 'string' || model === '') return { toast: t('needKey') }
          selectedKey = model
          screen = 'edit'
          modeOverride = null
          return { refresh: true, patch: dataFor() }
        },
        backToList: () => {
          screen = 'list'
          modeOverride = null
          return { refresh: true }
        },
        setModelMode: (scope, event) => {
          const fields = collectFields(event?.value)
          const mode = fields.s_mode ?? event?.value?.value ?? (typeof event?.value === 'string' ? event?.value : null)
          if (mode === 'flat' || mode === 'peak') modeOverride = mode
          return { refresh: true, patch: { s_mode: modeOverride ?? 'peak', ...dataFor() } }
        },
        saveModel: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(
            fields,
            (config, f) => applyModelSettings(config, f, { notFound: t('notFound'), windows: t('badWindows'), weekend: t('badWeekend') }, selectionOf(config, selectedKey)),
            t,
            (result) => {
              if (result.key) {
                selectedKey = result.key
                modeOverride = null
              }
              return t('savedModel')
            },
            event?.value,
          )
        },
        deleteThis: (scope, event) => {
          const t = translator(event?.locale)
          const { config } = loadConfig(dir)
          const key = selectionOf(config, selectedKey)
          const result = deleteModel(config, { del_key: key }, { needKey: t('needKey'), notDeletable: t('notDeletable'), notFound: t('notFound') })
          if (result.error) return { toast: result.error }
          try {
            saveConfig(dir, result.config)
          } catch {
            return { toast: t('saveFailed') }
          }
          selectedKey = null
          screen = 'list'
          modeOverride = null
          return { toast: t('deleted', { key: result.removed }), refresh: true, patch: dataFor() }
        },
        savePeak: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyPeak(config, f, { windows: t('badWindows'), weekend: t('badWeekend') }), t, null, event?.value)
        },
        addModel: (scope, event) => runAddModel(event),
        saveDefault: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyDefault(config, f, { needRate: t('needRate') }), t, null, event?.value)
        },
        saveCurrency: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyCurrency(config, f), t, null, event?.value)
        },
        deleteModel: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(
            fields,
            (config, f) =>
              deleteModel(config, f, { needKey: t('needKey'), notDeletable: t('notDeletable'), notFound: t('notFound') }),
            t,
            (result) => {
              if (result.removed === selectedKey) selectedKey = null
              return t('deleted', { key: result.removed })
            },
            event?.value,
          )
        },
        globalTemplate: (scope, event) => {
          const t = translator(event?.locale)
          const tpl = pickTpl(event?.value)
          if (tpl === null) {
            log(`模板按钮未识别 args: ${describe(event?.value)}`)
            dumpDebug('globalTemplate', event?.value)
            return { toast: t('appliedTplFail') }
          }
          const { config } = loadConfig(dir)
          const result = applyGlobalTemplate(config, tpl)
          if (result.error) return { toast: t('appliedTplFail') }
          try {
            saveConfig(dir, result.config)
          } catch {
            return { toast: t('saveFailed') }
          }
          return { toast: t('appliedTpl'), refresh: true, patch: dataFor() }
        },
        modelTemplate: (scope, event) => {
          const t = translator(event?.locale)
          const tpl = pickTpl(event?.value)
          if (tpl === null) {
            log(`模型模板按钮未识别 args: ${describe(event?.value)}`)
            dumpDebug('modelTemplate', event?.value)
            return { toast: t('appliedTplFail') }
          }
          const { config } = loadConfig(dir)
          const key = selectionOf(config, selectedKey)
          const result = applyModelTemplate(config, key, tpl)
          if (result.error) return { toast: result.error === 'nf' ? t('notFound') : t('appliedTplFail') }
          log(`模型模板 ${tpl} 作用于 ${key}`)
          try {
            saveConfig(dir, result.config)
          } catch {
            return { toast: t('saveFailed') }
          }
          return { toast: t('appliedTpl'), refresh: true }
        },
        pickModel: (scope, event) => {
          const value = event?.value?.value ?? event?.value
          if (typeof value === 'string' && value !== '') selectedKey = value
          return { refresh: true, patch: dataFor() }
        },
        fillUnpriced: (scope, event) => {
          const t = translator(event?.locale)
          const state = snapshot(scope?.sessionId)
          const pending = unpricedModels(state, state.config)
          if (pending.length === 0) return { toast: t('filledNone') }
          const { config, added } = addUnpriced(state.config, pending)
          if (added.length === 0) return { toast: t('filledNone') }
          try {
            saveConfig(dir, config)
          } catch {
            return { toast: t('saveFailed') }
          }
          selectedKey = added[0] ?? selectedKey
          screen = 'edit'
          return { toast: t('filled', { n: added.length }), refresh: true, patch: dataFor() }
        },
        refresh: () => ({ refresh: true, patch: dataFor() }),
      },
    })

  })
}
