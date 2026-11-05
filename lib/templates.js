// 设置模板：一键套用峰谷时段与峰谷价关系，不编造任何具体价格。
// 全局模板改 peak；模型模板只改选中的那一个模型。
import { clone } from './config.js'

export const GLOBAL_TEMPLATES = {
  bailian: {
    peak: { enabled: true, windows: [{ start: '08:00', end: '22:00' }], weekend: 'ignore', holidays: [] },
  },
  official: {
    peak: { enabled: true, windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], weekend: 'offPeak' },
  },
  flat: { peak: { enabled: false } },
}

/** 套用全局时段模板：只覆盖模板里写明的字段，tz 等保持。 */
export function applyGlobalTemplate(base, id) {
  const tpl = GLOBALTEMPLATES_GET(id)
  if (!tpl) return { error: 'tpl' }
  const config = clone(base)
  config.peak = { ...(config.peak ?? {}), ...clone(tpl.peak) }
  return { config, id }
}

function GLOBALTEMPLATES_GET(id) {
  return Object.prototype.hasOwnProperty.call(GLOBAL_TEMPLATES, id) ? GLOBAL_TEMPLATES[id] : undefined
}

const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6
const scale = (rates, k) => ({
  input: round6((Number(rates.input) || 0) * k),
  cacheRead: round6((Number(rates.cacheRead) || 0) * k),
  output: round6((Number(rates.output) || 0) * k),
})

/** 模型模板：峰=谷×2 / 谷=峰×0.5 / 峰谷同价 / 用全局时段。 */
export function applyModelTemplate(base, key, id) {
  const entry = base.models?.[key]
  if (!entry?.offPeak) return { error: 'nf' }
  const config = clone(base)
  const next = { ...config.models[key] }
  const off = { ...next.offPeak }
  const peak = { ...(next.peak ?? off) }
  switch (id) {
    case 'peak2x':
      next.peak = scale(off, 2)
      break
    case 'half':
      next.offPeak = scale(peak, 0.5)
      break
    case 'same':
      next.peak = { ...scale(off, 1) }
      break
    case 'global': {
      if (next.schedule) {
        const schedule = { ...next.schedule }
        delete schedule.windows
        if (Object.keys(schedule).length === 0) delete next.schedule
        else next.schedule = schedule
      }
      break
    }
    default:
      return { error: 'tpl' }
  }
  config.models[key] = next
  return { config, id, key }
}
