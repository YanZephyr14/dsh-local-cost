// local-cost：自配价格的峰谷计费。宿主侧只做三件事——扫日志、算钱、把视图交给 App。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { createScanner } from './usage.js'
import { summarize } from './summary.js'
import { isPeakAt, nextSwitch, wallClock } from './pricing.js'
import { costView, money, pricesView, translator } from './views.js'
import { applyGlobalTemplate, applyModelTemplate } from './templates.js'
import {
  applyAddModel,
  applyCurrency,
  applyDefault,
  applyModels,
  applyPeak,
  addUnpriced,
  applyMode,
  collectFields,
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

/** 新增模型（价格面板「兜底与单位」页签）。 */
function runAddModel(event) {
  const t = translator(event?.locale)
  const fields = collectFields(event?.value)
  return persist(
    fields,
    (config, f) => applyAddModel(config, f, { needKey: t('needKey'), badKey: t('badKey'), exists: t('exists'), full: t('full') }),
    t,
    (result) => {
      if (result.added) selectedKey = result.added
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
  return { toast: done ? done(result) : t('saved'), refresh: true }
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
      actions: {
        refresh: () => ({ refresh: true }),
        openPrices: () => ({ open: 'panel:prices' }),
        editModel: (scope, event) => {
          const t = translator(event?.locale)
          const model = event?.value?.model
          if (typeof model !== 'string' || model === '') return { toast: t('needKey') }
          const { config } = loadConfig(dir)
          const result = ensureModelEntry(config, model)
          if (result.error) return { toast: t('badKey') }
          if (result.created) {
            try {
              saveConfig(dir, result.config)
            } catch {
              return { toast: t('saveFailed') }
            }
          }
          selectedKey = result.key
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
        return pricesView(state.config, options, caps, {
          selected: selectedKey,
          configError: state.configError,
          unpriced: unpricedModels(state, state.config),
          hiddenModels: Math.max(0, configured - options.length),
        })
      },
      data: (scope, emit) => {
        const { config } = loadConfig(dir)
        emit(pricesData(config, selectionOf(config, selectedKey)))
        return () => {}
      },
      actions: {
        setMode: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          const mode = fields.mode ?? event?.value?.value
          const { config } = loadConfig(dir)
          const result = applyMode(config, mode)
          if (result.error) return { toast: t('appliedTplFail') }
          try {
            saveConfig(dir, result.config)
          } catch {
            return { toast: t('saveFailed') }
          }
          return { toast: t('modeSwitched'), refresh: true }
        },
        savePeak: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(fields, (config, f) => applyPeak(config, f, { windows: t('badWindows'), weekend: t('badWeekend') }), t, null, event?.value)
        },
        saveModels: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          return persist(
            fields,
            (config, f) =>
              applyModels(config, f, { noChange: t('noChange'), windows: t('badWindows'), notFound: t('notFound') }, selectionOf(config, selectedKey)),
            t,
            (result) => {
              if (result.key) selectedKey = result.key
              return t('saved')
            },
            event?.value,
          )
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
          const { config } = loadConfig(dir)
          const result = applyGlobalTemplate(config, event?.value?.tpl)
          if (result.error) return { toast: t('appliedTplFail') }
          try {
            saveConfig(dir, result.config)
          } catch {
            return { toast: t('saveFailed') }
          }
          return { toast: t('appliedTpl'), refresh: true }
        },
        modelTemplate: (scope, event) => {
          const t = translator(event?.locale)
          const { config } = loadConfig(dir)
          const result = applyModelTemplate(config, selectionOf(config, selectedKey), event?.value?.tpl)
          if (result.error) return { toast: result.error === 'nf' ? t('notFound') : t('appliedTplFail') }
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
          return { refresh: true }
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
          return { toast: t('filled', { n: added.length }), refresh: true }
        },
        refresh: () => ({ refresh: true }),
      },
    })

  })
}
