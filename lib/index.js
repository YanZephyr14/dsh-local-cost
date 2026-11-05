// local-cost：自配价格的峰谷计费。宿主侧只做三件事——扫日志、算钱、把视图交给 App。
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { createScanner } from './usage.js'
import { summarize } from './summary.js'
import { isPeakAt, nextSwitch, wallClock } from './pricing.js'
import { costView, money, pricesView, translator } from './views.js'
import { applyFields, collectFields, editableModels, pricesData } from './editor.js'

export const name = 'local-cost'

const dir = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')
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

export function apply(ctx) {
  try {
    console.log(`[local-cost] 已加载，配置:${dir}/price.json`)
  } catch {
    /* 日志失败不影响插件 */
  }
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
        const { config } = loadConfig(dir)
        return pricesView(config, editableModels(config), caps)
      },
      data: (scope, emit) => {
        const { config } = loadConfig(dir)
        emit(pricesData(config))
        return () => {}
      },
      actions: {
        savePrices: (scope, event) => {
          const t = translator(event?.locale)
          const fields = collectFields(event?.value)
          if (Object.keys(fields).length === 0) return { toast: t('noFields') }
          const { config } = loadConfig(dir)
          const result = applyFields(config, fields, { windows: t('badWindows'), weekend: t('badWeekend') })
          if (result.error) return { toast: result.error }
          try {
            saveConfig(dir, result.config)
          } catch {
            return { toast: t('noFields') }
          }
          return { toast: t('saved'), refresh: true }
        },
        refresh: () => ({ refresh: true }),
      },
    })
  })
}