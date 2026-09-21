// plugin-apply.test.mjs — 插件注册路径的冒烟测试：
// 用 mock ctx 调 apply()，确认 4 个 evo_* 工具 + /evo 命令真的注册出去，
// 且注册时不触碰 workflowEngine 服务（懒读取：无该服务也必须能 apply 成功，
// 否则在不带 workflow 引擎的 profile 里整个 entry 组会挂起）。
// 另钉住 known-issues #1（必须 export inject）与 #2（服务名是 workflowEngine）
// 两处出厂 bug 的修复，避免回退。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// 官方 SDK 由 dsh 运行时注入（不在 dependencies/peerDependencies 里声明）。
// 裸 clone（未 npm install）时它不在盘上——此时整组测试跳过而不是报错，
// 保证 `node --test` 在任何检出下都能跑出有意义的结果。
let plugin = null
let importError = null
try {
  plugin = await import(path.join(here, '..', 'src', 'index.mjs'))
} catch (error) {
  importError = error
}

const SKIP = plugin === null
  ? `官方 SDK 不在盘上（${importError?.code ?? 'import failed'}）——运行 npm install 后本组生效`
  : false

/** 本组测试需要官方 SDK 在盘上（由 dsh 运行时注入，故不写进 dependencies）。 */
function sdkTest(name, fn) {
  return test(name, { skip: SKIP }, fn)
}

function mockCtx() {
  const tools = []
  const commands = []
  const ctx = {
    tools: { register: (def) => { tools.push(def); return () => {} } },
    commands: { register: (def) => { commands.push(def); return () => {} } },
    // workflowEngine 服务缺席：apply 不得依赖它（懒读取纪律）
    get: () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  }
  return { ctx, tools, commands }
}

sdkTest('plugin declares inject (cordis 4 throws on undeclared service access — known-issues #1)', () => {
  assert.ok(Array.isArray(plugin.inject), 'export const inject must exist')
  assert.ok(plugin.inject.includes('tools'), 'tools must be declared')
  assert.ok(plugin.inject.includes('commands'), 'commands must be declared')
  // workflowEngine 必须**不**在 inject 里：静态 inject 会让缺该服务的 profile 永久 pending
  assert.ok(!plugin.inject.includes('workflowEngine'), 'workflowEngine must stay lazily read')
})

sdkTest('apply registers the four evo tools and the /evo command without the workflowEngine service', () => {
  const { ctx, tools, commands } = mockCtx()
  assert.doesNotThrow(() => { plugin.apply(ctx) })
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['evo_init', 'evo_rollback', 'evo_round', 'evo_status'],
  )
  assert.deepEqual(commands.map((c) => c.name), ['evo'])
  for (const t of tools) {
    assert.equal(typeof t.description, 'string')
    assert.ok(t.description.length > 40, `${t.name} needs a usable description`)
    assert.equal(typeof t.execute, 'function')
    assert.ok(t.parameters !== undefined, `${t.name} needs a parameters schema`)
  }
  assert.equal(typeof commands[0].handler, 'function')
})

sdkTest('evo_round names the missing workflowEngine service (known-issues #2: 服务名是 workflowEngine 不是 workflows)', async () => {
  const { ctx, tools } = mockCtx()
  plugin.apply(ctx)
  const round = tools.find((t) => t.name === 'evo_round')
  // 准备一个有 ledger 的工作区，让流程走到「取引擎」这一步（而不是先被 no ledger.md 拦下）
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evo-apply-'))
  await fs.writeFile(path.join(dir, 'ledger.md'), '# Evo ledger\n')
  try {
    await assert.rejects(
      () => round.execute({ workspace: dir }, { agent: { id: 'test' }, signal: undefined }),
      /no "workflowEngine" service/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

sdkTest('evo_round without a ledger fails fast with an actionable message', async () => {
  const { ctx, tools } = mockCtx()
  plugin.apply(ctx)
  const round = tools.find((t) => t.name === 'evo_round')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evo-noledger-'))
  try {
    await assert.rejects(
      () => round.execute({ workspace: dir }, { agent: { id: 'test' }, signal: undefined }),
      /no ledger\.md/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

sdkTest('plugin exports the round args doc for docs/tests to reference', () => {
  assert.equal(typeof plugin.ROUND_ARGS_DOC, 'string')
  assert.match(plugin.ROUND_ARGS_DOC, /workspaceRoot/)
  assert.match(plugin.ROUND_ARGS_DOC, /championScore/)
})