// 面板视图（v2）：费用明细与价格设置。只负责画，不写文件。
import { formatWindows } from './config.js'
import { localDate, wallClock } from './pricing.js'
import { share } from './summary.js'

const DICT = {
  zh: {
    costs: '费用',
    today: '今日',
    session: '本会话',
    week: '近 7 天',
    calls: '次调用',
    peak: '峰时',
    offPeak: '谷时',
    nowPeak: '当前峰时',
    nowOff: '当前谷时',
    toOff: '转谷时',
    toPeak: '转峰时',
    inMinutes: '还有 {n} 分钟',
    soon: '不到 1 分钟',
    allDay: '峰谷未启用，全天一个价',
    breakdown: '费用构成（{scope}）',
    breakdownCaption: '占比：{a} / {b} / {c}',
    breakdownCaption4: '占比：{a} / {b} / {c} / {d}',
    brInput: '未命中缓存输入',
    brCache: '缓存命中输入',
    brWrite: '缓存写入',
    brOutput: '输出',
    tokensTitle: 'Token（{scope}）',
    tokenCalls: '调用',
    tokenInput: '输入',
    tokenCache: '缓存命中输入',
    tokenOutput: '输出',
    peakTable: '峰时 vs 谷时（{scope}）',
    colSlot: '时段',
    colAmount: '金额',
    colCalls: '次数',
    colTokens: 'Token',
    byModel: '按模型（{scope}）',
    refresh: '刷新',
    openPrices: '价格设置',
    unpriced: '有 {n} 次调用没匹配到价格，未计入金额',
    unpricedShort: '未定价',
    readFail: '{n} 个日志暂时读不到',
    noCalls: '这个时间段还没有调用记录',
    noPrice: '这段时间的调用都还没匹配到价格，先去「价格设置」填单价',
    rangePicker: '时间范围',
    rToday: '今日',
    rYesterday: '昨日',
    rWeek: '近 7 天',
    rMonth: '近 30 天',
    rCustom: '自定义',
    rAll: '全部',
    rFrom: '开始日期',
    rTo: '结束日期',
    applyRange: '应用区间',
    badRange: '日期没填对：要形如 2026-11-01，且开始不晚于结束',
    rangeApplied: '已按所选区间统计',
    cwLabel: '缓存写入',
    brInputShort: '未命中',
    brCacheShort: '命中',
    brWriteShort: '写缓存',
    brOutputShort: '输出',
    dailyTitle: '每日费用（{scope}）',
    confirmDelete: '再点一次「删除此模型」确认（10 秒内）',
    fallbackTag: '按兜底价',
    zeroTag: '未填价',
    hourFmt: '约 {h} 小时',
    per: '¥/百万 token',
    pricesTitle: '价格设置',
    editTitle: '模型设置',
    backToList: '返回列表',
    saveModel: '保存这个模型',
    deleteThis: '删除此模型',
    sModeLabel: '这个模型怎么计费',
    optFlatMode: '全天一个价',
    optPeakMode: '按时段峰谷',
    sWindows: '峰时段（如 08:00-22:00，可多段）',
    sWeekend: '周末',
    sHolidays: '节假日（全天谷价）',
    listHint: '每个模型独立设置、互不影响；没单独设过的模型按「全局默认」走。',
    colBilling: '计费',
    colWindows2: '时段',
    colOff: '谷价(输入/缓存/输出)',
    colPeak2: '峰价(输入/缓存/输出)',
    savedModel: '已保存，只改了这个模型',
    editing: '正在设置',
    modeLabel: '计价模式',
    optFlat: '全天一个价',
    optGlobal: '统一峰谷',
    optPerModel: '分模型峰谷',
    modeFlatHint: '全天一个价：只填一组价格，时段与峰价自动隐藏。',
    modeGlobalHint: '统一峰谷：所有模型共用同一套时段，谷/峰各填一组价。',
    modePerModelHint: '分模型峰谷：每个模型可写自己的时段，留空用全局。',
    modeSwitched: '已切换计价模式',
    tabPeak: '时段与模板',
    tabModels: '模型单价',
    tabMore: '兜底与单位',
    tplBailian: '百炼 8–22 峰',
    tplOfficial: '官方两段',
    tplFlat: '全天一个价',
    tplPeak2x: '峰=谷×2',
    tplHalf: '谷=峰×0.5',
    tplSame: '峰谷同价',
    tplGlobal: '用全局时段',
    tplPeakHint: '模板只改时段或峰谷关系，不动具体价格数字。',
    colModel: '模型',
    offIn: '谷·输入',
    offCr: '谷·缓存命中',
    offOut: '谷·输出',
    peakIn: '峰·输入',
    peakCr: '峰·缓存命中',
    peakOut: '峰·输出',
    addInMoreTab: '在「兜底与单位」页签里新增模型',
    appliedTpl: '已套用模板',
    appliedTplFail: '这个模板不可用',
    presetsTitle: '一键预设',
    presetBailian: '百炼 8–22 点',
    presetDeepSeek: '官方两段',
    presetFlat: '不分峰谷',
    presetApplied: '已套用：{name}',
    fModelWindows: '峰时段（留空=用全局）',
    pickModel: '切换模型',
    noModelsYet: '还没有定价的模型',
    createdEntry: '已建条目，填个价格',
    hintModelWindows: '如 08:00-22:00',
    openMore: '更多设置',
    moreTitle: '更多设置',
    secDefault: '兜底价（未匹配的模型）',
    secCurrency: '单位与货币',
    secDelete: '删除模型',
    saveDelete: '删除',
    fSymbol: '货币符号',
    fPer: '每多少 token 计价',
    fDec: '小数位',
    fDelKey: '要删的模型 key',
    needRate: '至少填一个价',
    notDeletable: 'default 不能删',
    notFound: '没有这个模型',
    deleted: '已删除 {key}',
    moreHint: '面板最多列 4 个模型，其余的在这里新增/删除；也可以直接改 price.json',
    defaultHint: '模型名匹配不上具体条目时用这套价',
    unitLine: '单位 {sym} / 百万 token（currency 可在 price.json 改）',
    secPeak: '峰谷时段',
    secModels: '模型单价',
    secAdd: '新增模型',
    fWindows: '峰时段',
    fWeekend: '周末怎么算',
    fHolidays: '节假日（全天谷时）',
    optOff: '谷时',
    optPeak: '峰时',
    optWindow: '按窗口',
    fNewKey: '模型 key',
    hintNewKey: 'provider:model 或 model',
    savePeak: '保存时段',
    saveModels: '保存单价',
    saveAdd: '添加',
    restHint: '还有 {n} 个模型没显示（面板最多 4 个），请改 price.json',
    unpricedTag: '未定价',
    fillUnpriced: '并入未定价',
    filledNone: '今天没有未定价的模型',
    filled: '已加入 {n} 个模型，请填单价',
    configBroken: '配置有问题：{msg}（下面按内置默认值算）',
    saveFailed: '保存失败，文件可能只读',
    noChange: '价格没有变化',
    needKey: '先填模型 key',
    badKey: '这个 key 太长',
    exists: '已有同名模型，改上面那段就行',
    full: '模型数量到上限了',
    peakHint: '峰时留空 = 按谷时算',
    scopeNote: '口径：不含标题生成等辅助调用；子智能体只计入今日 / 近 7 天',
    unpricedHint: '今天这些模型还没定价：{list}',
    fieldWindows: '峰时段',
    fieldWeekend: '周末',
    fieldHolidays: '假日（全天谷时）',
    hintWindows: '如 09:00-12:00,14:00-18:00',
    hintWeekend: 'off / peak / ignore',
    hintHolidays: '2026-10-01,2026-10-02',
    save: '保存',
    inLabel: '输入',
    crLabel: '缓存命中输入',
    outLabel: '输出',
    offSection: '谷时',
    peakSection: '峰时',
    fileHint: '改完点对应表单的保存；也可以直接改 price.json。',
    saved: '已保存',
    badWindows: '峰时段看不懂，用 09:00-12:00 这种写法',
    badWeekend: '周末只能填 off / peak / ignore',
    noFields: '没收到新的价格，请重试',
  },
  en: {
    costs: 'Costs',
    today: 'Today',
    session: 'This chat',
    week: 'Last 7d',
    calls: 'calls',
    peak: 'Peak',
    offPeak: 'Off-peak',
    nowPeak: 'Peak now',
    nowOff: 'Off-peak now',
    toOff: 'to off-peak',
    toPeak: 'to peak',
    inMinutes: 'in {n} min',
    soon: 'in <1 min',
    allDay: 'Peak pricing off — one rate all day',
    breakdown: 'Cost breakdown ({scope})',
    breakdownCaption: 'Shares: {a} / {b} / {c}',
    breakdownCaption4: 'Shares: {a} / {b} / {c} / {d}',
    brInput: 'Input (cache miss)',
    brCache: 'Input (cache hit)',
    brWrite: 'Cache write',
    brOutput: 'Output',
    tokensTitle: 'Tokens ({scope})',
    tokenCalls: 'Calls',
    tokenInput: 'Input',
    tokenCache: 'Cache-hit input',
    tokenOutput: 'Output',
    peakTable: 'Peak vs off-peak ({scope})',
    colSlot: 'Slot',
    colAmount: 'Amount',
    colCalls: 'Calls',
    colTokens: 'Tokens',
    byModel: 'By model ({scope})',
    refresh: 'Refresh',
    openPrices: 'Prices',
    unpriced: '{n} call(s) had no price and are excluded',
    unpricedShort: 'No price',
    readFail: '{n} log(s) unreadable right now',
    noCalls: 'No calls in this range yet',
    noPrice: 'No call matched a price — set rates in Prices',
    rangePicker: 'Time range',
    rToday: 'Today',
    rYesterday: 'Yesterday',
    rWeek: 'Last 7d',
    rMonth: 'Last 30d',
    rCustom: 'Custom',
    rAll: 'All',
    rFrom: 'From',
    rTo: 'To',
    applyRange: 'Apply',
    badRange: 'Bad dates: use 2026-11-01 style, from ≤ to',
    rangeApplied: 'Stats now cover the chosen range',
    cwLabel: 'Cache write',
    brInputShort: 'Miss',
    brCacheShort: 'Hit',
    brWriteShort: 'Write',
    brOutputShort: 'Out',
    dailyTitle: 'Daily cost ({scope})',
    confirmDelete: 'Tap "Delete this model" again within 10s to confirm',
    fallbackTag: 'fallback rate',
    zeroTag: 'no rate',
    hourFmt: '~{h} h',
    per: 'per 1M tokens',
    pricesTitle: 'Prices',
    editTitle: 'Model settings',
    backToList: 'Back to list',
    saveModel: 'Save this model',
    deleteThis: 'Delete this model',
    sModeLabel: 'Billing for this model',
    optFlatMode: 'Flat all day',
    optPeakMode: 'Peak windows',
    sWindows: 'Peak windows (e.g. 08:00-22:00, multi ok)',
    sWeekend: 'Weekends',
    sHolidays: 'Holidays (off-peak)',
    listHint: 'Each model is configured on its own; models never set here follow the global defaults.',
    colBilling: 'Billing',
    colWindows2: 'Windows',
    colOff: 'Off (in/cache/out)',
    colPeak2: 'Peak (in/cache/out)',
    savedModel: 'Saved — only this model changed',
    editing: 'Editing',
    modeLabel: 'Pricing mode',
    optFlat: 'Flat all day',
    optGlobal: 'Shared peak windows',
    optPerModel: 'Per-model windows',
    modeFlatHint: 'Flat: fill one set of rates; windows and peak rates are hidden.',
    modeGlobalHint: 'Shared windows: every model uses the same peak windows, off/peak rates each set.',
    modePerModelHint: 'Per-model: each model may override windows; blank falls back to global.',
    modeSwitched: 'Pricing mode switched',
    tabPeak: 'Windows & presets',
    tabModels: 'Model rates',
    tabMore: 'Fallback & unit',
    tplBailian: 'Bailian 8–22',
    tplOfficial: 'Official windows',
    tplFlat: 'Flat all day',
    tplPeak2x: 'Peak = off×2',
    tplHalf: 'Off = peak×0.5',
    tplSame: 'Same rates',
    tplGlobal: 'Global windows',
    tplPeakHint: 'Templates only change windows or the peak/off relationship, never the numbers.',
    colModel: 'Model',
    offIn: 'Off·in',
    offCr: 'Off·hit',
    offOut: 'Off·out',
    peakIn: 'Peak·in',
    peakCr: 'Peak·hit',
    peakOut: 'Peak·out',
    addInMoreTab: 'Add models in the "Fallback & unit" tab',
    appliedTpl: 'Template applied',
    appliedTplFail: 'Template unavailable',
    presetsTitle: 'Presets',
    presetBailian: 'Bailian 8–22',
    presetDeepSeek: 'Official 2 slots',
    presetFlat: 'No peak',
    presetApplied: 'Applied: {name}',
    fModelWindows: 'Windows (blank = global)',
    pickModel: 'Model',
    noModelsYet: 'No priced model yet',
    createdEntry: 'Entry created — fill the rates',
    hintModelWindows: 'e.g. 08:00-22:00',
    openMore: 'More',
    moreTitle: 'More settings',
    secDefault: 'Fallback rates (unmatched models)',
    secCurrency: 'Unit & currency',
    secDelete: 'Delete a model',
    saveDelete: 'Delete',
    fSymbol: 'Symbol',
    fPer: 'Tokens per unit',
    fDec: 'Decimals',
    fDelKey: 'Model key to delete',
    needRate: 'Fill at least one rate',
    notDeletable: 'default cannot be deleted',
    notFound: 'No such model',
    deleted: 'Deleted {key}',
    moreHint: 'The panel lists up to 4 models; add or delete the rest here, or edit price.json',
    defaultHint: 'Used when a model id matches no entry',
    unitLine: 'Rates in {sym} per 1M tokens (currency editable in price.json)',
    secPeak: 'Peak windows',
    secModels: 'Model rates',
    secAdd: 'Add model',
    fWindows: 'Peak windows',
    fWeekend: 'Weekends',
    fHolidays: 'Holidays (off-peak)',
    optOff: 'Off-peak',
    optPeak: 'Peak',
    optWindow: 'By window',
    fNewKey: 'Model key',
    hintNewKey: 'provider:model or model',
    savePeak: 'Save windows',
    saveModels: 'Save rates',
    saveAdd: 'Add',
    restHint: '{n} more model(s) hidden here (max 4 in the panel) — edit price.json',
    unpricedTag: 'No price',
    fillUnpriced: 'Add unpriced',
    filledNone: 'No unpriced model today',
    filled: 'Added {n} model(s) — fill in the rates',
    configBroken: 'Config problem: {msg} (using built-in defaults below)',
    saveFailed: 'Save failed — the file may be read-only',
    noChange: 'Nothing changed',
    needKey: 'Enter a model key first',
    badKey: 'That key is too long',
    exists: 'That model already exists — edit the section above',
    full: 'Model list is full',
    peakHint: 'Empty peak falls back to off-peak',
    scopeNote: 'Scope: excludes title/compaction helper calls; sub-agents count for today / 7 days only',
    unpricedHint: 'No price yet for: {list}',
    fieldWindows: 'Peak windows',
    fieldWeekend: 'Weekend',
    fieldHolidays: 'Holidays (off-peak)',
    hintWindows: 'e.g. 09:00-12:00,14:00-18:00',
    hintWeekend: 'off / peak / ignore',
    hintHolidays: '2026-10-01,2026-10-02',
    save: 'Save',
    inLabel: 'Input',
    crLabel: 'Cache-hit input',
    outLabel: 'Output',
    offSection: 'Off-peak',
    peakSection: 'Peak',
    fileHint: 'Tap each form’s Save; price.json works too.',
    saved: 'Saved',
    badWindows: 'Cannot read the windows — use 09:00-12:00',
    badWeekend: 'Weekend must be off / peak / ignore',
    noFields: 'No new rates received, try again',
  },
}

export function translator(locale) {
  const zh = !String(locale ?? '').toLowerCase().startsWith('en')
  const table = zh ? DICT.zh : DICT.en
  return (key, vars) => {
    let text = table[key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replaceAll(`{${k}}`, String(v))
    return text
  }
}

export function money(config, value) {
  const symbol = config.currency?.symbol ?? '¥'
  if (!(Number(value) > 0)) return `${symbol}0`
  const decimals = Number.isFinite(config.currency?.decimals) ? config.currency.decimals : 3
  let digits = decimals
  let text = Number(value).toFixed(digits)
  if (Number(text) === 0) text = Number(value).toFixed(Math.min(6, digits + 2))
  return `${symbol}${text}`
}

export function percent(part, total) {
  const ratio = share(part, total)
  if (ratio === null) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

export function compact(value) {
  const n = Number(value) || 0
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function peakLine(config, state, t) {
  const peak = config.peak
  if (!peak || peak.enabled === false) return t('allDay')
  const isPeak = state.isPeak
  const next = state.nextSwitch
  const head = isPeak ? t('nowPeak') : t('nowOff')
  if (!next) return head
  const minutes = Math.max(0, Math.round((next.at - state.now) / 60_000))
  const clock = wallClock(next.at, peak.tz || 'Asia/Shanghai')
  const hhmm = `${String(Math.floor(clock.minutes / 60)).padStart(2, '0')}:${String(clock.minutes % 60).padStart(2, '0')}`
  const dur = minutes <= 0 ? t('soon') : minutes < 90 ? t('inMinutes', { n: minutes }) : t('hourFmt', { h: Math.round((minutes / 60) * 10) / 10 })
  const target = next.peak ? t('toPeak') : t('toOff')
  return `${head} · ${hhmm}${target}（${dur}）`
}

/** 区间名：预设走字典，自定义显示 MM-DD~MM-DD。 */
function scopeLabel(t, mode, win, tz) {
  if (mode === 'custom' && win) {
    const a = localDate(win.from, tz).slice(5)
    const b = localDate(Math.max(win.from, Math.min(win.to, Date.now()) - 1), tz).slice(5)
    return `${a}~${b}`
  }
  return t(`r${String(mode).slice(0, 1).toUpperCase()}${String(mode).slice(1)}`)
}

/** 费用面板：时间范围选择 + 区间合计/本会话 + 费用构成 + 峰谷 + 按模型。 */
export function costView(config, state, caps) {
  const t = translator(caps?.locale)
  const mode = state.rangeMode ?? 'today'
  const win = state.rangeWindow
  const bucket = state.range ?? state.today
  const rows = state.rangeModels ?? state.models
  const tz = config.peak?.tz || 'Asia/Shanghai'
  const scope = scopeLabel(t, mode, win, tz)
  const total = bucket.amount
  const metrics = [
    { type: 'metric', label: scope, value: money(config, bucket.amount), caption: `${bucket.calls} ${t('calls')}` },
  ]
  if (state.hasSession !== false) {
    metrics.push({ type: 'metric', label: t('session'), value: money(config, state.session.amount), caption: `${state.session.calls} ${t('calls')}` })
  }
  const children = []
  if (state.configError) children.push({ type: 'callout', text: t('configBroken', { msg: state.configError }), tone: 'warn' })
  children.push({
    type: 'segmented',
    label: t('rangePicker'),
    bind: 'data.r_mode',
    onChange: 'setRange',
    options: [
      { label: t('rToday'), value: 'today' },
      { label: t('rYesterday'), value: 'yesterday' },
      { label: t('rWeek'), value: 'week' },
      { label: t('rMonth'), value: 'month' },
      { label: t('rAll'), value: 'all' },
      { label: t('rCustom'), value: 'custom' },
    ],
  })
  if (mode === 'custom') {
    children.push({
      type: 'form',
      submitLabel: t('applyRange'),
      submit: 'applyRange',
      children: [
        {
          type: 'row',
          children: [
            { type: 'date', label: t('rFrom'), bind: 'data.r_from' },
            { type: 'date', label: t('rTo'), bind: 'data.r_to' },
          ],
        },
      ],
    })
  }
  children.push(
    { type: 'row', children: metrics },
    mode === 'today'
      ? { type: 'metric', label: t('week'), value: money(config, state.week.amount), caption: `${state.week.calls} ${t('calls')}` }
      : { type: 'metric', label: t('today'), value: money(config, state.today.amount), caption: `${state.today.calls} ${t('calls')}` },
    { type: 'callout', text: peakLine(config, state, t), tone: state.isPeak ? 'warn' : 'good' },
  )

  const daily = state.daily ?? []
  if (daily.length > 1 && bucket.calls > 0) {
    children.push({
      type: 'chart',
      kind: 'bar',
      categories: daily.map((d) => d.date.slice(5)),
      series: [{ name: t('costs'), values: daily.map((d) => Number(d.amount.toFixed(4))) }],
      unit: config.currency?.symbol ?? '¥',
      caption: t('dailyTitle', { scope }),
    })
  }

  if (bucket.calls === 0) {
    children.push({ type: 'emptyState', title: t('noCalls') })
  } else if (total > 0) {
    const hasWrite = bucket.parts.cacheWrite > 0
    const categories = hasWrite
      ? [t('brInputShort'), t('brCacheShort'), t('brWriteShort'), t('brOutputShort')]
      : [t('brInputShort'), t('brCacheShort'), t('brOutputShort')]
    const fullNames = hasWrite
      ? [t('brInput'), t('brCache'), t('brWrite'), t('brOutput')]
      : [t('brInput'), t('brCache'), t('brOutput')]
    const values = hasWrite
      ? [bucket.parts.input, bucket.parts.cacheRead, bucket.parts.cacheWrite, bucket.parts.output]
      : [bucket.parts.input, bucket.parts.cacheRead, bucket.parts.output]
    const shares = values.map((v) => percent(v, total))
    const caption = hasWrite
      ? t('breakdownCaption4', { a: shares[0], b: shares[1], c: shares[2], d: shares[3] })
      : t('breakdownCaption', { a: shares[0], b: shares[1], c: shares[2] })
    children.push({
      type: 'chart',
      kind: 'donut',
      categories,
      series: [{ name: scope, values: values.map((v) => Number(v.toFixed(4))) }],
      unit: config.currency?.symbol ?? '¥',
      caption: `${t('breakdown', { scope })} · ${caption}`,
    })
    const rows2 = fullNames.map((label, i) => [label, `${money(config, values[i])} · ${shares[i]}`])
    children.push({ type: 'keyValue', items: rows2 })
  } else {
    children.push({ type: 'callout', text: t('noPrice'), tone: 'warn' })
  }

  children.push({
    type: 'keyValue',
    items: [
      [t('tokenCalls'), `${bucket.calls}`],
      [t('tokenInput'), compact(bucket.tokens.input)],
      [t('tokenCache'), compact(bucket.tokens.cacheRead)],
      [t('tokenOutput'), compact(bucket.tokens.output)],
    ],
  })

  if (bucket.calls > 0 && config.peak?.enabled !== false) {
    children.push({
      type: 'table',
      columns: [t('colSlot'), t('colAmount'), t('colCalls'), t('colTokens')],
      rows: [
        [t('peak'), money(config, bucket.peak.amount), `${bucket.peak.calls}`, compact(bucket.peak.tokens)],
        [t('offPeak'), money(config, bucket.offPeak.amount), `${bucket.offPeak.calls}`, compact(bucket.offPeak.tokens)],
      ],
    })
  }

  if (rows.length > 0) {
    children.push({
      type: 'list',
      items: rows.slice(0, 6).map((row) => {
        const tags = []
        if (row.priced === 0) tags.push(t('unpricedShort'))
        else if (!(row.amount > 0)) tags.push(t('zeroTag'))
        if (row.fallback > 0) tags.push(t('fallbackTag'))
        return {
          title: row.model,
          subtitle: `${row.calls} ${t('calls')} · ${compact(row.tokens)} tokens${tags.length ? ` · ${tags.join(' · ')}` : ''}`,
          trailing: money(config, row.amount),
          tone: tags.length ? 'warn' : undefined,
          action: { id: 'editModel', args: { model: row.model, provider: row.provider ?? '' } },
        }
      }),
    })
  }

  if (bucket.unpriced.calls > 0) children.push({ type: 'callout', text: t('unpriced', { n: bucket.unpriced.calls }), tone: 'warn' })
  if (state.unreadable > 0) children.push({ type: 'text', text: t('readFail', { n: state.unreadable }), tone: 'muted' })

  children.push({ type: 'text', text: t('scopeNote'), tone: 'muted' })
  children.push({
    type: 'actions',
    items: [
      { label: t('refresh'), action: 'refresh' },
      { label: t('openPrices'), action: 'openPrices', style: 'primary' },
    ],
  })

  return { v: 2, type: 'stack', title: t('costs'), children }
}

function numberField(label, bind) {
  return { type: 'number', label, bind, min: 0, max: 1_000_000 }
}

/**
 * 价格设置面板：三个小表单，各存各的。
 * 1) 峰谷时段（时段 / 周末 / 节假日）  2) 已有模型单价  3) 新增模型
 */
/**
 * 价格设置：两个画面。列表 = 所有模型一览 + 全局默认；
 * 编辑 = 单个模型的完整独立设置（模式/时段/谷峰价），保存只写这一个条目。
 */
export function pricesView(config, options, caps, extra = {}) {
  const t = translator(caps?.locale)
  return extra.screen === 'edit' ? editScreen(config, options, caps, extra, t) : listScreen(config, options, caps, extra, t)
}

function listScreen(config, options, caps, extra, t) {
  const cell = (v) => plain(config, v)
  const rows = options.slice(0, 20).map((m) => {
    const sched = { enabled: config.peak?.enabled !== false, windows: [], ...(config.peak ?? {}), ...(m.entry.schedule ?? {}) }
    const flat = sched.enabled === false
    const off = m.entry.offPeak ?? {}
    const peak = m.entry.peak ?? off
    const win = flat ? '—' : (sched.windows ?? []).map((w) => `${w.start}-${w.end}`).join(',') || '—'
    const zero = ['input', 'cacheRead', 'cacheWrite', 'output'].every((k) => !(Number(off[k]) > 0) && !(Number(peak[k]) > 0))
    return {
      title: m.label,
      subtitle: `${m.provider ? `${m.provider} · ` : ''}${flat ? t('optFlatMode') : win} · ${cell(off.input)}/${cell(off.cacheRead)}/${cell(off.output)}${zero ? ` · ${t('zeroTag')}` : ''}`,
      trailing: flat ? '' : `${cell(peak.input)}/${cell(peak.cacheRead)}/${cell(peak.output)}`,
      tone: zero ? 'warn' : undefined,
      action: { id: 'editModelSettings', args: { model: m.key } },
    }
  })
  const children = [
    { type: 'text', text: t('unitLine', { sym: config.currency?.symbol ?? '¥' }), tone: 'muted' },
    { type: 'text', text: t('listHint'), tone: 'muted' },
  ]
  if (extra.configError) children.push({ type: 'callout', text: t('configBroken', { msg: extra.configError }), tone: 'warn' })
  if (extra.unpriced?.length) children.push({ type: 'callout', text: t('unpricedHint', { list: extra.unpriced.slice(0, 4).join('、') }), tone: 'warn' })
  if (rows.length > 0) children.push({ type: 'list', items: rows })
  else children.push({ type: 'emptyState', title: t('noModelsYet'), message: t('addInMoreTab') })

  children.push({
    type: 'collapsible',
    label: t('tabMore'),
    expanded: false,
    children: [
      {
        type: 'form',
        label: t('secPeak'),
        submitLabel: t('savePeak'),
        submit: 'savePeak',
        children: [
          { type: 'textField', label: t('fWindows'), bind: 'data.g_windows', placeholder: t('hintWindows') },
          { type: 'segmented', label: t('fWeekend'), bind: 'data.g_weekend', options: [
            { label: t('optOff'), value: 'offPeak' }, { label: t('optPeak'), value: 'peak' }, { label: t('optWindow'), value: 'ignore' }] },
          { type: 'textField', label: t('fHolidays'), bind: 'data.g_holidays', placeholder: t('hintHolidays') },
        ],
      },
      {
        type: 'form',
        label: t('secDefault'),
        submitLabel: t('save'),
        submit: 'saveDefault',
        children: [
          { type: 'text', text: t('defaultHint'), tone: 'muted' },
          { type: 'row', children: [numberField(`${t('optOff')} · ${t('inLabel')}`, 'data.d_in'), numberField(`${t('optOff')} · ${t('crLabel')}`, 'data.d_cr'), numberField(`${t('optOff')} · ${t('outLabel')}`, 'data.d_out')] },
          { type: 'row', children: [numberField(`${t('optPeak')} · ${t('inLabel')}`, 'data.D_in'), numberField(`${t('optPeak')} · ${t('crLabel')}`, 'data.D_cr'), numberField(`${t('optPeak')} · ${t('outLabel')}`, 'data.D_out')] },
          { type: 'row', children: [numberField(`${t('optOff')} · ${t('cwLabel')}`, 'data.d_cw'), numberField(`${t('optPeak')} · ${t('cwLabel')}`, 'data.D_cw')] },
        ],
      },
      {
        type: 'form',
        label: t('secAdd'),
        submitLabel: t('saveAdd'),
        submit: 'addModel',
        children: [
          { type: 'textField', label: t('fNewKey'), bind: 'data.n_key', placeholder: t('hintNewKey') },
          { type: 'row', children: [numberField(`${t('optOff')} · ${t('inLabel')}`, 'data.n_in'), numberField(`${t('optOff')} · ${t('crLabel')}`, 'data.n_cr'), numberField(`${t('optOff')} · ${t('outLabel')}`, 'data.n_out')] },
        ],
      },
      {
        type: 'form',
        label: t('secCurrency'),
        submitLabel: t('save'),
        submit: 'saveCurrency',
        children: [
          { type: 'textField', label: t('fSymbol'), bind: 'data.c_symbol', maxLength: 4 },
          { type: 'row', children: [numberField(t('fPer'), 'data.c_per'), numberField(t('fDec'), 'data.c_dec')] },
        ],
      },
    ],
  })
  children.push({
    type: 'actions',
    items: [
      { label: t('fillUnpriced'), action: 'fillUnpriced' },
      { label: t('refresh'), action: 'refresh' },
    ],
  })
  return { v: 2, type: 'stack', title: t('pricesTitle'), children }
}

function editScreen(config, options, caps, extra, t) {
  const current = options.find((m) => m.key === extra.selected) ?? options[0]
  if (!current) return listScreen(config, options, caps, extra, t)
  const sched = { enabled: config.peak?.enabled !== false, windows: [], weekend: 'offPeak', holidays: [], ...(config.peak ?? {}), ...(current.entry.schedule ?? {}) }
  const flat = extra.modeOverride ? extra.modeOverride === 'flat' : sched.enabled === false
  const fields = [
    { type: 'segmented', label: t('sModeLabel'), bind: 'data.s_mode', onChange: 'setModelMode', options: [
      { label: t('optFlatMode'), value: 'flat' }, { label: t('optPeakMode'), value: 'peak' }] },
    {
      type: 'row',
      children: [
        numberField(flat ? t('inLabel') : `${t('optOff')} · ${t('inLabel')}`, 'data.m_in'),
        numberField(flat ? t('crLabel') : `${t('optOff')} · ${t('crLabel')}`, 'data.m_cr'),
        numberField(flat ? t('outLabel') : `${t('optOff')} · ${t('outLabel')}`, 'data.m_out'),
      ],
    },
  ]
  if (flat) {
    fields.push({ type: 'row', children: [numberField(t('cwLabel'), 'data.m_cw')] })
  }
  if (!flat) {
    fields.push(
      { type: 'textField', label: t('sWindows'), bind: 'data.s_windows', placeholder: t('hintModelWindows') },
      { type: 'segmented', label: t('sWeekend'), bind: 'data.s_weekend', options: [
        { label: t('optOff'), value: 'offPeak' }, { label: t('optPeak'), value: 'peak' }, { label: t('optWindow'), value: 'ignore' }] },
      { type: 'textField', label: t('sHolidays'), bind: 'data.s_holidays', placeholder: t('hintHolidays') },
      { type: 'row', children: [numberField(`${t('optPeak')} · ${t('inLabel')}`, 'data.M_in'), numberField(`${t('optPeak')} · ${t('crLabel')}`, 'data.M_cr'), numberField(`${t('optPeak')} · ${t('outLabel')}`, 'data.M_out')] },
      { type: 'row', children: [numberField(`${t('optOff')} · ${t('cwLabel')}`, 'data.m_cw'), numberField(`${t('optPeak')} · ${t('cwLabel')}`, 'data.M_cw')] },
    )
  }
  const tplItems = flat
    ? [{ label: `${t('optPeakMode')} · 8–22`, action: { id: 'modelTemplate', args: { tpl: 'w822' } } }]
    : [
        { label: t('tplPeak2x'), action: { id: 'modelTemplate', args: { tpl: 'peak2x' } } },
        { label: t('tplHalf'), action: { id: 'modelTemplate', args: { tpl: 'half' } } },
        { label: t('tplSame'), action: { id: 'modelTemplate', args: { tpl: 'same' } } },
        { label: t('tplBailian'), action: { id: 'modelTemplate', args: { tpl: 'w822' } } },
      ]
  return {
    v: 2,
    type: 'stack',
    title: `${t('editTitle')} · ${current.label}`,
    children: [
      { type: 'text', text: `${t('editing')}: ${current.provider ? `${current.provider} / ${current.short}` : current.short}`, tone: 'muted' },
      { type: 'form', label: t('editTitle'), submitLabel: t('saveModel'), submit: 'saveModel', children: fields },
      { type: 'actions', items: tplItems },
      {
        type: 'actions',
        items: [
          { label: t('backToList'), action: 'backToList', style: 'primary' },
          { label: t('deleteThis'), action: 'deleteThis' },
          { label: t('refresh'), action: 'refresh' },
        ],
      },
    ],
  }
}

/** 单价单元格：去掉多余尾零。 */
function plain(config, value) {
  const n = Number(value) || 0
  const text = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return `${config.currency?.symbol ?? '¥'}${text}`
}
