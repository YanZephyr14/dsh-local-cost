// local-cost：自配价格的峰谷计费。宿主侧只做三件事——扫日志、算钱、把视图交给 App。
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { createScanner } from './usage.js'
import { summarize } from './summary.js'
import { isPeakAt, nextSwitch, wallClock } from './pricing.js'
import { costView, money, moreView, pricesView, translator } from './views.js'
import {
  applyAddModel,
  applyModels,
  applyPeak,
  addUnpriced,
  applyCurrency,
  applyDefault,
  collectFields,
  deleteModel,
  editableModels,
  pricesData,
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

/** 一次取数：配置 + 调用记录 + 聚合 + 当前峰谷。 */
function snapshot(sessionId) {
  const { config, error } = loadConfig(dir)
  const scan = scanner.scan()
  const now = Date.now()
  const tz = config.peak?.tz || 'Asia/Shanghai'
  const state = summarize(scan.calls, config, { sessionId, now })
  const clock = wallClock(now, tz)
  return {
    config,
    configError: error,
    now,
    today: state.today,
    session: state.session,
    week: state.week,
    models: state.models,
    hasSession: Boolean(sessionId),
    isPeak: isPeakAt(clock, config.peak, now),
    nextSwitch: nextSwitch(config.peak, now, { tz }),
    unreadable: scan.unreadable,
  }
}

function stripText(state, t) {
  const total = state.today.amount
  const mark = total > 0 ? money(state.config, total) : state.today.unpriced.calls > 0 ? '—' : money(state.config, 0)
  const parts = [`${t('today')} ${mark}`]
  if (state.today.unpriced.calls > 0) parts.push(`${t('unpricedShort')} ${state.today.unpriced.calls}`)
  else if (state.config.peak?.enabled !== false) parts.push(state.isPeak ? t('peak') : t('offPeak'))
  return parts.join(' · ').slice(0, 24)
}

/** 常用峰谷预设：只改全局时段，不动单价与模型自己的覆盖。 */
const PRESETS = {
  presetBailian: {
    label: '百炼 8–22 点',
    peak: { enabled: true, windows: [{ start: '08:00', end: '22:00' }], weekend: 'ignore', holidays: [] },
  },
  presetDeepSeek: {
    label: '官方两段',
    peak: { enabled: true, weekend: 'offPeak', windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  },
  presetFlat: { label: '不分峰谷', peak: { enabled: false } },
}

function applyPreset(config, preset) {
  return { ...config, peak: { ...(config.peak ?? {}), ...preset.peak } }
}

/** 套用预设：只动全局峰谷时段，单价和模型自己的覆盖保持不变。 */
function runPreset(key, event) {
  const t = translator(event?.locale)
  const preset = PRESETS[key]
  if (!preset) return { toast: t('saveFailed') }
  const { config } = loadConfig(dir)
  try {
    saveConfig(dir, applyPreset(config, preset))
  } catch {
    return { toast: t('saveFailed') }
  }
  return { toast: t('presetApplied', { name: t(key) }), refresh: true }
}

/** 新增模型（两个面板共用）。 */
function runAddModel(event) {
  const t = translator(event?.locale)
  const fields = collectFields(event?.value)
  return persist(
    fields,
    (config, f) => applyAddModel(config, f, { needKey: t('needKey'), badKey: t('badKey'), exists: t('exists'), full: t('full') }),
    t,
  )
}

/** 保存动作共用：拿到字段 → 合并 → 落盘 → 回一句提示并刷新面板。 */
function persist(fields, merge, t, done) {
  if (Object.keys(fields).length === 0) return { toast: t('noFields') }
  log(`收到字段: ${Object.keys(fields).join(',')}`)
  const { config } = loadConfig(dir)
  const result = merge(config, fields)
  if (result.error) return { toast: result.error }
  try {
    saveConfig(dir, result.config)
  } catch {
    return { toast: t('saveFailed') }
  }
  return { toast: done ? done(result) : t('saved'), refresh: true }
}

export function apply(ctx) {
  log(`已加载，配置:${dir}/price.json`)
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
      actions: {
        refresh: () => ({ refresh: true }),
        openPrices: () => ({ open: 'panel:prices' }),
      },
    })

    ctx.dshGo.panel('prices', {
      view: (scope, caps) => {
        const state = snapshot(scope?.sessionId)
        const models = editableModels(state.config)
        const configured = Object.keys(state.config.models ?? {}).filter((key) => key !== 'default' && key !== '*').length
        return pricesView(state.config, models, caps, {
          configError: state.configError,
          unpriced: unpricedModels(state, state.config),
          hiddenModels: Math.max(0, configured - models.length),
        })
      },
      data: (scope, emit) => {
        const { config } = loadConfig(dir)
        emit(pricesData(config))
        return () => {}
      },
      actions: {
        savePeak: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyPeak(config, f, { windows: t('badWindows'), weekend: t('badWeekend') }), t)
        },
        saveModels: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyModels(config, f, { noChange: t('noChange') }), t)
        },
        addModel: (scope, event) => runAddModel(event),
        openMore: () => ({ open: 'panel:more' }),
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
          return { toast: t('filled', { n: added.length }), refresh: true }
        },
        presetBailian: (scope, event) => runPreset('presetBailian', event),
        presetDeepSeek: (scope, event) => runPreset('presetDeepSeek', event),
        presetFlat: (scope, event) => runPreset('presetFlat', event),
        refresh: () => ({ refresh: true }),
      },
    })

    ctx.dshGo.panel('more', {
      view: (scope, caps) => {
        const { config, error } = loadConfig(dir)
        return moreView(config, caps, { configError: error })
      },
      data: (scope, emit) => {
        const { config } = loadConfig(dir)
        emit(pricesData(config))
        return () => {}
      },
      actions: {
        addModel: (scope, event) => runAddModel(event),
        saveDefault: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyDefault(config, f, { needRate: t('needRate') }), t)
        },
        saveCurrency: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyCurrency(config, f), t)
        },
        deleteModel: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(
            fields,
            (config, f) =>
              deleteModel(config, f, { needKey: t('needKey'), notDeletable: t('notDeletable'), notFound: t('notFound') }),
            t,
            (result) => t('deleted', { key: result.removed }),
          )
        },
        openPrices: () => ({ open: 'panel:prices' }),
        refresh: () => ({ refresh: true }),
      },
    })
  })
}