// mock-run.test.mjs — 用 mock 引擎（vm）跑真实 SCRIPT 的完整控制流。
// 与官方 workflow 引擎相同的包裹方式求值 body，替换 agent/parallel/phase/log：
//   - agent  按 label 返回夹具（proposer/actor/critic/regressor）
//   - parallel 顺序执行 thunk
// 验证：select 的冠军地板、reject 一票否决、回归失败 → regressionFailed+needsHuman、
// 报告与返回值结构。真实引擎路径由 dsh-inspect 同款 hook 保证，这里测的是协议逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { SCRIPT } = await import(path.join(here, '..', 'workflow', 'evo-round.mjs'))

/** 用夹具跑一遍脚本；返回 { value, calls }。 */
async function runWithFixtures(args, fixtures) {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = opts?.label ?? ''
    calls.push(label)
    const make = fixtures[label]
    if (typeof make !== 'function') throw new Error(`mock: no fixture for label ${label}`)
    const value = make(label)
    if (value === null) return null
    return value
  }
  const parallel = async (thunks) => {
    const out = []
    for (const t of thunks) out.push(await t())
    return out
  }
  const phase = () => {}
  const log = () => {}
  const ctx = { args, agent, parallel, phase, log }
  vm.createContext(ctx)
  const wrapped = `(async () => { ${SCRIPT} })()`
  const script = new vm.Script(wrapped)
  const value = await script.runInContext(ctx)
  return { value, calls }
}

/** 默认夹具生成器：2 proposers、2 actors、critic 按 "critic-<c>-<k>" 给分。 */
function defaultFixtures({ candidate1Score = 6.0, candidate2Score = 8.0, actor2Done = true } = {}) {
  const fixtures = {}
  fixtures['proposer-1'] = () => ({ title: 'p1', change: 'proposal one', rationale: 'r', expectedCriteria: ['c1'], risk: 'x' })
  fixtures['proposer-2'] = () => ({ title: 'p2', change: 'proposal two', rationale: 'r', expectedCriteria: ['c2'], risk: 'y' })
  fixtures['actor-1'] = () => ({ candidateDir: 'runs/1/candidate-1', done: true, note: '' })
  fixtures['actor-2'] = () => actor2Done
    ? { candidateDir: 'runs/1/candidate-2', done: true, note: '' }
    : { candidateDir: '', done: false, note: 'failed' }
  const verdict = (score, verdictType = 'accept') => ({
    score,
    verdict: verdictType,
    summary: 's',
    strengths: ['a'],
    weaknesses: ['b'],
    risks: [],
    regressionConcerns: [],
    perCriterion: [{ criterion: 'c1', score, note: 'n' }],
  })
  fixtures['critic-1-1'] = () => verdict(candidate1Score, candidate1Score >= 7 ? 'accept' : 'revise')
  fixtures['critic-1-2'] = () => verdict(candidate1Score, candidate1Score >= 7 ? 'accept' : 'revise')
  fixtures['critic-2-1'] = () => verdict(candidate2Score)
  fixtures['critic-2-2'] = () => verdict(candidate2Score)
  fixtures['regressor-1'] = () => ({ probe: 'fact-check', passed: true, evidence: 'ok' })
  return fixtures
}

const baseArgs = {
  workspaceRoot: '/tmp/mock-evo',
  round: 1,
  ownProposals: 2,
  actors: 2,
  critics: 2,
  championScore: 0,
  championDir: null,
}

test('happy path: selects the higher-scored candidate above champion floor', async () => {
  const { value, calls } = await runWithFixtures(baseArgs, defaultFixtures({ candidate1Score: 6.0, candidate2Score: 8.0 }))
  assert.equal(value.ok, true)
  assert.equal(value.selected.candidateDir, 'runs/1/candidate-2')
  assert.equal(value.selected.score, 8.0)
  assert.equal(value.needsHuman, false)
  assert.equal(value.score, 8.0)
  // 两个候选都应被 2 个 critic 评审
  assert.ok(calls.filter((l) => l.startsWith('critic-1-')).length === 2)
  assert.ok(calls.filter((l) => l.startsWith('critic-2-')).length === 2)
  assert.match(value.report, /runs\/1\/candidate-2/)
})

test('champion floor: candidate below champion score is not selected', async () => {
  const { value } = await runWithFixtures(
    { ...baseArgs, championScore: 8.5, championDir: 'runs/0/candidate-1' },
    defaultFixtures({ candidate1Score: 6.0, candidate2Score: 8.0 }),
  )
  assert.equal(value.selected, null)
  assert.equal(value.score, null)
  assert.ok(value.needsHuman === false) // 无入选且最好的也没超冠军 → 纯无赢家
  assert.match(value.report, /no winner/)
})

test('reject veto: a single reject unseats the would-be winner', async () => {
  const fixtures = defaultFixtures({ candidate1Score: 6.0, candidate2Score: 8.0 })
  fixtures['critic-2-2'] = () => ({
    score: 8.0, verdict: 'reject', summary: 's', strengths: [], weaknesses: [], risks: [],
    regressionConcerns: ['regexes are unreadable'], perCriterion: [],
  })
  const { value } = await runWithFixtures(baseArgs, fixtures)
  assert.equal(value.selected, null)
  assert.match(value.report, /no winner/)
})

test('failed actor is skipped and does not produce a candidate', async () => {
  const { value } = await runWithFixtures(baseArgs, defaultFixtures({ candidate1Score: 7.5, actor2Done: false }))
  assert.equal(value.selected.candidateDir, 'runs/1/candidate-1')
  assert.equal(value.outcomes.length, 1)
  assert.ok(!value.outcomes.some((o) => o.candidateDir.includes('candidate-2')))
})

test('regression failure marks regressionFailed and needsHuman', async () => {
  const fixtures = defaultFixtures({ candidate1Score: 6.0, candidate2Score: 8.0 })
  fixtures['regressor-1'] = () => ({ probe: 'fact-check', passed: false, evidence: 'candidate contradicts baseline' })
  const { value } = await runWithFixtures({ ...baseArgs, regressionProbes: [{ name: 'fact-check', check: 'x' }] }, fixtures)
  assert.equal(value.selected.regressionFailed, true)
  assert.equal(value.needsHuman, true)
  assert.match(value.humanReasons.join(' '), /regression probe/)
})

test('critic disagreement (spread >= 3) forces needsHuman even for a winner above floor', async () => {
  const fixtures = defaultFixtures({ candidate1Score: 6.0, candidate2Score: 8.0 })
  fixtures['critic-2-1'] = () => ({
    score: 8.5, verdict: 'accept', summary: 's', strengths: [], weaknesses: [], risks: [],
    regressionConcerns: [], perCriterion: [{ criterion: 'c1', score: 8.5, note: 'n' }],
  })
  fixtures['critic-2-2'] = () => ({
    score: 5.5, verdict: 'revise', summary: 's', strengths: [], weaknesses: [], risks: [],
    regressionConcerns: [], perCriterion: [{ criterion: 'c1', score: 5.5, note: 'n' }],
  })
  const { value } = await runWithFixtures(baseArgs, fixtures)
  assert.equal(value.selected.candidateDir, 'runs/1/candidate-2') // 仍选，但…
  assert.equal(value.needsHuman, true)
  assert.match(value.humanReasons.join(' '), /disagree|spread|verdict mix/)
})

test('meta-provided proposals skip own brainstorm', async () => {
  const fixtures = defaultFixtures()
  const args = { ...baseArgs, proposals: ['rewrite the intro'], ownProposals: 0 }
  const { value, calls } = await runWithFixtures(args, fixtures)
  // 元层提议时不应有任何 proposer 被调用
  assert.ok(!calls.some((l) => l.startsWith('proposer-')))
  assert.equal(value.proposalsTotal, 1)
  assert.equal(value.acted, 1)
})

test('no criteria-adjacent regressions: return shape is stable', async () => {
  const { value } = await runWithFixtures(baseArgs, defaultFixtures({ candidate2Score: 8.0 }))
  for (const key of ['ok', 'report', 'round', 'championScore', 'championDir', 'selected', 'score', 'needsHuman', 'humanReasons', 'outcomes', 'regression', 'acted', 'proposalsTotal']) {
    assert.ok(key in value, `return value should carry ${key}`)
  }
  assert.equal(typeof value.report, 'string')
  assert.ok(value.report.length > 100)
})