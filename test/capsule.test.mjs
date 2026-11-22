// 静态胶囊：清单声明合法，点按直达费用面板；状态条与脚注彻底让位。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = new URL('../lib/', import.meta.url).pathname
const MANIFEST = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

async function loadPlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-cost-capsule-'))
  fs.mkdirSync(path.join(dir, 'lib'))
  for (const name of fs.readdirSync(LIB)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(LIB, name), path.join(dir, 'lib', name))
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'local-cost', version: '0.0.0', type: 'module', main: 'lib/index.js' }))
  const mod = await import(pathToFileURL(path.join(dir, 'lib', 'index.js')).href)
  const panels = {}
  const handlers = {}
  mod.apply({
    inject(_deps, fn) {
      fn({ dshGo: { panel: (id, def) => { panels[id] = def }, strip: () => {}, turnNote: () => {}, on: (id, def) => { handlers[id] = def } } })
    },
  })
  return { dir, panels, handlers }
}

test('清单：胶囊 openCost 合法，状态条与脚注已撤掉', () => {
  const c = MANIFEST.dshGo.contributes
  assert.equal(c['composer.strip'], undefined)
  assert.equal(c['turn.note'], undefined)
  const actions = c['composer.actions']
  assert.equal(actions.length, 1)
  assert.equal(actions[0].id, 'openCost')
  assert.ok([...actions[0].label.zh].length <= 10)
  assert.ok([...actions[0].label.en].length <= 10)
  assert.equal(actions[0].effect, undefined, '走 on(id) 处理，不是静态 effect')
})

test('点胶囊直达费用面板', async () => {
  const { handlers } = await loadPlugin()
  assert.equal(typeof handlers.openCost, 'function')
  assert.deepEqual(handlers.openCost({}, {}), { open: 'panel:cost' })
})
