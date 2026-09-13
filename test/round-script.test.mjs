// round-script.test.mjs — evo-round 引擎脚本的静态校验：
// 1) 模块可加载（导出 SCRIPT/META/ARGS_DOC）；2) 引擎包裹求值无语法错误；
// 3) 关键协议片段存在（schema、阶段、防退化逻辑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const moduleUrl = path.join(here, '..', 'workflow', 'evo-round.mjs')

const { SCRIPT, ROUND_META, ROUND_ARGS_DOC } = await import(moduleUrl)

test('module exports the script, meta and args doc', () => {
  assert.equal(typeof SCRIPT, 'string')
  assert.ok(SCRIPT.length > 4000, 'script should be substantial')
  assert.equal(ROUND_META.name, 'evo-round')
  assert.ok(ROUND_META.phases.length >= 5)
  assert.ok(ROUND_ARGS_DOC.includes('workspaceRoot'))
})

test('SCRIPT compiles inside the engine vm wrapper (no syntax errors)', () => {
  // 引擎包裹：`(async () => { body })()`，globals 注入由引擎负责；此处只编译不执行。
  const wrapped = `(async () => { ${SCRIPT} })()`
  assert.doesNotThrow(() => new vm.Script(wrapped))
})

test('SCRIPT contains the round protocol phases and safety guards', () => {
  for (const needle of [
    'phase(\'Propose\')', 'phase(\'Act\')', 'phase(\'Critique\')',
    'phase(\'Select\')', 'phase(\'Regression\')',
    'CRITIC_SCHEMA', 'PROPOSAL_SCHEMA', 'ACTOR_SCHEMA', 'REGRESSOR_SCHEMA',
    'best.score > championScore', // 冠军地板
    'regressionProbes',               // 回归
    'needsHuman',                     // 人类门禁
  ]) {
    assert.ok(SCRIPT.includes(needle), `SCRIPT should contain: ${needle}`)
  }
})

test('SCRIPT has no unescaped template interpolation or stray backticks', () => {
  assert.ok(
    !SCRIPT.includes('${'),
    'no unescaped ${ may survive into the engine body (it would break evaluation)',
  )
  assert.ok(
    !SCRIPT.includes('`'),
    'no backticks may survive into the engine body (they would break the wrapper)',
  )
})

test('engine script files pass node --check', () => {
  for (const rel of ['workflow/evo-round.mjs', 'src/index.mjs', 'src/evo.mjs', 'src/ledger.mjs']) {
    const file = path.join(here, '..', rel)
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }), rel)
  }
})