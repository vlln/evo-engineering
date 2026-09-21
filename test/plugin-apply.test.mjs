// plugin-apply.test.mjs — 插件注册路径的冒烟测试：
// 用 mock ctx 调 apply()，确认 4 个 evo_* 工具 + /evo 命令真的注册出去，
// 且注册时不触碰 workflows 服务（惰性读取：无该服务也必须能 apply 成功，
// 否则在不带 workflow 引擎的 profile 里整个 entry 组会挂起）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const plugin = await import(path.join(here, '..', 'src', 'index.mjs'))

function mockCtx() {
  const tools = []
  const commands = []
  const ctx = {
    tools: { register: (def) => { tools.push(def); return () => {} } },
    commands: { register: (def) => { commands.push(def); return () => {} } },
    // workflows 服务缺席：apply 不得依赖它（懒读取纪律）
    get: () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  }
  return { ctx, tools, commands }
}

test('apply registers the four evo tools and the /evo command without the workflows service', () => {
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

test('evo_round fails with an actionable error when the workflows service is missing', async () => {
  const { ctx, tools } = mockCtx()
  plugin.apply(ctx)
  const round = tools.find((t) => t.name === 'evo_round')
  await assert.rejects(
    () => round.execute({ workspace: '/tmp/whatever' }, { agent: { id: 'test' }, signal: undefined }),
    /no "workflows" service|no ledger\.md/,
  )
})

test('plugin exports the round args doc for docs/tests to reference', () => {
  assert.equal(typeof plugin.ROUND_ARGS_DOC, 'string')
  assert.match(plugin.ROUND_ARGS_DOC, /workspaceRoot/)
  assert.match(plugin.ROUND_ARGS_DOC, /championScore/)
})