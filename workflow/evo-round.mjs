// evo-round — 进化工程「一回合」确定性引擎（dsh 官方 workflow 引擎脚本）。
//
// 这是 L1 层：把进化循环里「propose → act → critique → select → regression」
// 固化成 schema 校验、并行扇出的 workflow 脚本。消费方式有两种：
//   1. 插件（src/index.mjs 的 evo_round 工具）经 ctx.workflows.start({script})
//      运行本脚本，跑完后由插件（Node 侧）追加 ledger、打 git checkpoint；
//   2. 任何带官方 workflow 工具的 dsh 会话，把 SCRIPT 直接喂给 workflow 工具
//      （args 见 ROUND_ARGS_DOC），由元层（会话/人）自己驱动循环。
//
// 脚本自身不做 IO（引擎约束）：所有文件读写由脚本派生的子代理完成（子代理带
// bash/fs 内置工具），脚本只做调度与确定性聚合。防退化（冠军地板、回归探针）
// 的判断在本脚本内；ledger/git 持久化在插件侧。
//
// 设计要点（对应 skills/evo 手册的协议）：
//   - 知识泄漏防护：actor 只拿到自己的 proposal，看不到别的候选；proposer/critic
//     各自独立上下文、互不可见。
//   - 确定性 select：不信任模型的自由文本结论，只按 schema 校验过的数字聚合。
//   - 模糊标准：critic 独立判分，分歧大（spread>=3 等）→ needsHuman=true 升级到
//     元层对话，由人裁定并顺带细化标准。
//   - 防退化：分数必须同时 >= threshold 且 > championScore 才当选；回归探针失败
//     → regressionFailed + needsHuman，不自动采纳。
//
// SCRIPT 字符串的转义规则：其内容会被引擎以 `(async()=>{ body })()` 包裹求值。
// 由于本文件用外层模板字面量承载 body，body 内不允许出现：
//   - 未转义的 `${`（会触发模块层插值）——body 内一律不用模板字符串；
//   - 单引号字符串里的 `\n`（会被外层模板真换行）——body 内的提示词统一用
//     join('\\n') 拼行，外层模板把 `\\n` 还原成脚本里的 `\n` 转义。
// test/round-script.test.mjs 会用 vm 编译该 body，任何语法错误都会被测试抓住。

/** workflow run 的 meta（插件 workflows.start({meta}) 需要）。 */
export const ROUND_META = {
  name: 'evo-round',
  description: 'One evolution round: propose → act → critique → select → regression.',
  phases: [
    { title: 'Prepare', detail: 'Resolve workspace paths and round config.' },
    { title: 'Propose', detail: 'Draft candidate changes (meta-provided or own proposers).' },
    { title: 'Act', detail: 'Parallel actors implement each proposal in isolation.' },
    { title: 'Critique', detail: 'Independent critics score each candidate against criteria.' },
    { title: 'Select', detail: 'Deterministic champion-floor selection.' },
    { title: 'Regression', detail: 'Re-run champion probes against the winner.' },
  ],
}

/** args 说明（把 SCRIPT 喂给 workflow 工具时参考）。 */
export const ROUND_ARGS_DOC = `evo-round args:
  workspaceRoot      (string, required) evo 工作区绝对路径
  round              (number) 回合号，默认 1
  criteriaRef        (string) 标准文件相对路径，默认 evals/criteria.md
  baselineRef        (string) 基线目录相对路径，默认 baseline
  targetWithin       (string) 基线内要进化的子路径(相对 baselineRef)，默认 ''（整个基线）
  proposals          (string[]) 元层显式给出的改进提议（有则不再自己 brainstorm）
  ownProposals       (number) 无 proposals 时 spawn 的提议 agent 数，默认 2，上限 4
  actors             (number) 并行实现 agent 数，默认 2，上限 4
  critics            (number) 每个候选的独立评审 agent 数，默认 2，上限 3
  maxAgents          (number) 本回合 agent 总预算，默认 18（超出先砍 critics）
  threshold          (number) 得分入选下限，默认 7（0–10）
  championScore      (number) 冠军线（上一任胜者分数），默认 0
  championDir        (string|null) 上一任胜者目录（相对 root），null = 无
  regressionProbes   ({name, check}[]) 上一任胜者的回归探针，默认 []
`

const SCRIPT = `
// body 在引擎作用域内求值：可用 args / agent / parallel / phase / log。
// eslint-disable-next-line no-unused-vars
const A = args ?? {}
const workspaceRoot = A.workspaceRoot
if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
  throw new Error('evo-round: args.workspaceRoot (absolute path of the evo workspace) is required')
}
const round = typeof A.round === 'number' ? A.round : 1
const criteriaRef = typeof A.criteriaRef === 'string' ? A.criteriaRef : 'evals/criteria.md'
const baselineRef = typeof A.baselineRef === 'string' ? A.baselineRef : 'baseline'
const targetWithin = typeof A.targetWithin === 'string' ? A.targetWithin : ''
const metaProposals = Array.isArray(A.proposals)
  ? A.proposals.filter(function (p) { return typeof p === 'string' && p.trim().length > 0 }).map(function (p) { return p.trim() })
  : []
const ownProposals = typeof A.ownProposals === 'number'
  ? Math.max(0, Math.min(4, Math.floor(A.ownProposals)))
  : (metaProposals.length > 0 ? 0 : 2)
const maxActors = typeof A.actors === 'number' ? Math.max(1, Math.min(4, Math.floor(A.actors))) : 2
const maxCritics = typeof A.critics === 'number' ? Math.max(1, Math.min(3, Math.floor(A.critics))) : 2
const maxAgents = typeof A.maxAgents === 'number' ? Math.max(4, Math.floor(A.maxAgents)) : 18
const threshold = typeof A.threshold === 'number' ? A.threshold : 7
const championScore = typeof A.championScore === 'number' ? A.championScore : 0
const championDir = typeof A.championDir === 'string' ? A.championDir : null
const regressionProbes = Array.isArray(A.regressionProbes) ? A.regressionProbes.slice(0, 4) : []

const joinP = function () {
  const parts = Array.prototype.slice.call(arguments)
  return [workspaceRoot].concat(parts).join('/')
}
const baselineAbs = joinP(baselineRef)
const criteriaAbs = joinP(criteriaRef)
const targetAbs = targetWithin === '' ? baselineAbs : joinP(baselineRef, targetWithin)
// act 的起点：**有冠军就从冠军复制**。否则每圈都从起源 baseline 重来，
// 冠军地板只能否决、不能累积 —— 实测发现的结构缺口。
// baseline/ 保持只读不变，它仍是用于回归对照的起源快照。
const actBaseAbs = championDir !== null ? joinP(championDir) : targetAbs
const ledgerAbs = joinP('ledger.md')

// ---- schemas（subset：type/properties/required/additionalProperties/items/enum）----
const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    change: { type: 'string' },
    rationale: { type: 'string' },
    expectedCriteria: { type: 'array', items: { type: 'string' } },
    risk: { type: 'string' },
  },
  required: ['title', 'change', 'rationale', 'expectedCriteria', 'risk'],
}
const ACTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidateDir: { type: 'string' },
    done: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['candidateDir', 'done'],
}
const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'number' },
    verdict: { type: 'string', enum: ['accept', 'revise', 'reject'] },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    regressionConcerns: { type: 'array', items: { type: 'string' } },
    perCriterion: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          score: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['criterion', 'score', 'note'],
      },
    },
  },
  required: ['score', 'verdict', 'summary', 'strengths', 'weaknesses', 'risks', 'regressionConcerns', 'perCriterion'],
}
const REGRESSOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    probe: { type: 'string' },
    passed: { type: 'boolean' },
    evidence: { type: 'string' },
  },
  required: ['probe', 'passed', 'evidence'],
}

// ---- prompt builders（body 内拼行统一 join('\\n')）----
const PROPOSER_PROMPT = (index) => {
  return [
    'You are a PROPOSER in an evolution loop.',
    'Workspace: ' + workspaceRoot,
    'The artifact to EVOLVE (read it): ' + targetAbs,
    'The standard defining "better" (read it): ' + criteriaAbs,
    'Prior context (read if present): ' + ledgerAbs + ', and scan ' + joinP('runs') + ' for prior candidates, especially the latest champion.',
    'Your job: propose EXACTLY ONE concrete, narrowly-scoped change to the artifact that would improve it along the criteria.',
    'Do NOT implement anything. Do NOT propose changing the standard itself (that is a human-gated meta action).',
    'Prefer small, verifiable changes over big rewrites. Output the proposal schema: title, change (precise and actionable), rationale, expectedCriteria (which criteria this should raise), risk (what could go wrong or regress).'
  ].join('\\n')
}

const ACTOR_PROMPT = (index, change) => {
  const candidateDir = joinP('runs', String(round), 'candidate-' + (index + 1))
  return [
    'You are an ACTOR in an evolution loop. Workspace: ' + workspaceRoot,
    'Read the standard: ' + criteriaAbs,
    'Read the artifact you must IMPROVE (READ-ONLY — never modify it): ' + actBaseAbs,
    'That artifact is the CURRENT BEST (champion) unless the proposal says otherwise.',
    'Your assigned proposal (' + (index + 1) + '): ' + change,
    'Work directory (ABSOLUTE path — use it VERBATIM; never turn it into a relative path, and never rely on the shell working directory): ' + candidateDir + ' — create it, copy THAT artifact file(s) into it, then apply the proposal there.',
    'This candidate is ISOLATED: do NOT read or touch any other candidate under ' + joinP('runs') + '. Work only inside your own candidate dir.',
    'Also write CHANGELOG.md inside the candidate dir: what changed vs baseline, why, and which criteria each change targets.',
    'If the proposal is unclear or infeasible, apply the closest safe small change and say so in note.',
    'Output schema: candidateDir (echo the EXACT ABSOLUTE work directory you used, character for character), done (true when written), note.'
  ].join('\\n')
}

const CRITIC_PROMPT = (candidate, criticIndex) => {
  const candidateAbs = candidate.candidateAbs !== undefined ? candidate.candidateAbs : joinP(candidate.candidateDir)
  return [
    'You are an independent CRITIC in an evolution loop; you judge ONE candidate only.',
    'Workspace: ' + workspaceRoot,
    'The standard defining "better" (read it): ' + criteriaAbs,
    'Origin baseline — immutable snapshot, use it to detect regressions (READ-ONLY): ' + targetAbs,
    'CURRENT CHAMPION you must strictly beat: ' + (championDir !== null ? actBaseAbs : '(none yet)'),
    'Adoption requires score >= threshold AND strictly above champion score (' + championScore + ').',
    'Candidate to evaluate (ABSOLUTE path — use it verbatim when running any command): ' + candidateAbs,
    'Judge honestly how well the candidate satisfies the standard. Prefer concrete, evidence-based observations over impressions. Be skeptical: look for what is NOT improved, what regressed vs baseline, and risks.',
    'Critics never coordinate — your verdict is your own. If possible, also save your verdict JSON to ' + joinP(candidate.candidateDir, 'verdict-' + (criticIndex + 1) + '.json') + ' for the audit trail.',
    'Output schema: score (0-10 overall), verdict (accept = take as champion; revise = direction right but needs work; reject = does not help), summary, strengths[], weaknesses[], risks[], regressionConcerns[] (things that could break what previously worked), perCriterion[] ({criterion, score, note}).'
  ].join('\\n')
}

const REGRESSOR_PROMPT = (probe, candidateDir) => {
  return [
    'You are a REGRESSION CHECKER in an evolution loop. A candidate was selected as the new champion.',
    'Workspace: ' + workspaceRoot,
    'Candidate: ' + joinP(candidateDir),
    'Probe name: ' + probe.name,
    'Probe check: ' + probe.check,
    'Run the check against the candidate (and the workspace as a whole) with real evidence — inspect files, run commands if applicable. Do not guess.',
    'Output schema: probe (the probe name), passed (boolean), evidence (what you observed).'
  ].join('\\n')
}

// ---- phases ----
phase('Prepare')
log('evo-round #' + round + ' workspace=' + workspaceRoot)
log('baseline=' + baselineAbs + ' criteria=' + criteriaAbs + ' target=' + targetAbs)
log('metaProposals=' + metaProposals.length + ' ownProposals=' + ownProposals + ' actors=' + maxActors + ' critics=' + maxCritics)

phase('Propose')
const proposals = []
if (metaProposals.length > 0) {
  metaProposals.forEach(function (change, i) {
    proposals.push({ title: 'meta-proposal-' + (i + 1), change: change, rationale: 'provided by the meta layer', expectedCriteria: [], risk: '', source: 'meta-' + (i + 1) })
  })
  log('using ' + metaProposals.length + ' meta-provided proposal(s)')
} else {
  const proposers = []
  for (let i = 0; i < ownProposals; i++) {
    proposers.push(function () {
      return agent(PROPOSER_PROMPT(i), { label: 'proposer-' + (i + 1), phase: 'Propose', schema: PROPOSAL_SCHEMA })
    })
  }
  const results = await parallel(proposers)
  results.forEach(function (r, i) {
    if (r === null) { log('proposer-' + (i + 1) + ' failed (no schema output)'); return }
    proposals.push({
      title: r.title,
      change: r.change,
      rationale: r.rationale,
      expectedCriteria: Array.isArray(r.expectedCriteria) ? r.expectedCriteria : [],
      risk: typeof r.risk === 'string' ? r.risk : '',
      source: 'proposer-' + (i + 1),
    })
  })
  log('own proposers produced ' + proposals.length + ' proposal(s)')
}
if (proposals.length === 0) {
  return { ok: false, report: 'evo-round #' + round + ': no proposal available — cannot run a round', round: round, needsHuman: false }
}

phase('Act')
const acted = Math.min(proposals.length, maxActors)
if (acted < proposals.length) log('only ' + acted + ' of ' + proposals.length + ' proposals will be acted on (actors cap)')
const actorThunks = []
for (let i = 0; i < acted; i++) {
  const pm = proposals[i]
  actorThunks.push(function () {
    return agent(ACTOR_PROMPT(i, pm.change), { label: 'actor-' + (i + 1), phase: 'Act', schema: ACTOR_SCHEMA })
  })
}
const actorResults = await parallel(actorThunks)
const candidates = []
actorResults.forEach(function (r, i) {
  if (r === null || !r.done) {
    log('actor-' + (i + 1) + ' failed — candidate skipped')
    return
  }
  // actor 可能报**绝对路径**（实测会）。对外仍用它的原值（结果/report 的契约，测试锁定），
  // 内部另算一个安全的绝对路径给 critic 用（避免把绝对路径再拼一次 workspaceRoot）。
  const rawDir = typeof r.candidateDir === 'string' ? r.candidateDir.trim() : ''
  const absDir = rawDir.indexOf('/') === 0 ? rawDir : joinP(rawDir)
  if (rawDir.indexOf('/') === 0 && rawDir.indexOf(workspaceRoot) !== 0) {
    log('WARNING: actor-' + (i + 1) + ' wrote OUTSIDE the workspace: ' + rawDir + ' — accepted, but the prompt asked for the given absolute dir')
  }
  candidates.push({ index: i, candidateDir: r.candidateDir, candidateAbs: absDir, proposal: proposals[i], actorNote: typeof r.note === 'string' ? r.note : '' })
})
if (candidates.length === 0) {
  return { ok: true, report: 'evo-round #' + round + ': all actors failed to produce candidates. Check ' + joinP('runs', String(round)) + ' for partial state.', round: round, needsHuman: true }
}

phase('Critique')
const spent = acted + (ownProposals > 0 ? ownProposals : 0)
let criticsTotal = Math.min(candidates.length * maxCritics, Math.max(candidates.length, maxAgents - spent))
const perCandidate = Math.max(1, Math.floor(criticsTotal / candidates.length))
const criticThunks = []
const verdictByCandidate = {}
candidates.forEach(function (c) {
  verdictByCandidate[c.candidateDir] = []
  for (let k = 0; k < perCandidate; k++) {
    criticThunks.push(function () {
      return agent(CRITIC_PROMPT(c, k), { label: 'critic-' + (c.index + 1) + '-' + (k + 1), phase: 'Critique', schema: CRITIC_SCHEMA })
    })
  }
})
const criticResults = await parallel(criticThunks)
let criticSlot = 0
candidates.forEach(function (c) {
  for (let k = 0; k < perCandidate; k++) {
    const v = criticResults[criticSlot++]
    if (v === null) { log('a critic for ' + c.candidateDir + ' failed'); continue }
    verdictByCandidate[c.candidateDir].push(v)
  }
})

phase('Select')
const outcomes = []
for (const c of candidates) {
  const verdicts = verdictByCandidate[c.candidateDir]
  if (verdicts.length === 0) {
    outcomes.push({ candidateDir: c.candidateDir, score: null, note: 'no verdicts — unjudged', verdicts: 0, accepts: 0, rejects: 0, spread: 0, regressionConcerns: [], proposalTitle: c.proposal.title })
    continue
  }
  const scores = verdicts.map(function (v) { return Number(v.score) })
  const mean = scores.reduce(function (a, b) { return a + b }, 0) / scores.length
  const rejects = verdicts.filter(function (v) { return v.verdict === 'reject' }).length
  const accepts = verdicts.filter(function (v) { return v.verdict === 'accept' }).length
  const regressionConcerns = []
  verdicts.forEach(function (v) {
    if (Array.isArray(v.regressionConcerns)) regressionConcerns.push.apply(regressionConcerns, v.regressionConcerns)
  })
  outcomes.push({
    candidateDir: c.candidateDir,
    proposalTitle: c.proposal.title,
    score: Math.round(mean * 10) / 10,
    verdicts: verdicts.length,
    accepts: accepts,
    rejects: rejects,
    regressionConcerns: regressionConcerns,
    spread: Math.round((Math.max.apply(null, scores) - Math.min.apply(null, scores)) * 10) / 10,
    note: '',
  })
}
outcomes.sort(function (a, b) {
  const sa = a.score === null ? -1 : a.score
  const sb = b.score === null ? -1 : b.score
  return sb - sa
})
const best = outcomes[0]

let selected = null
if (best !== undefined && best.score !== null && best.score >= threshold && best.rejects === 0 && best.score > championScore) {
  selected = best
}
let needsHuman = false
const humanReasons = []
if (selected !== null) {
  if (selected.verdicts > 1 && selected.spread >= 3) { needsHuman = true; humanReasons.push('critics disagree widely (spread ' + selected.spread + ')') }
  if (selected.verdicts > 1 && selected.accepts < selected.verdicts && selected.spread >= 2) { needsHuman = true; humanReasons.push('verdict mix (accept/revise) on the winner') }
  if (selected.regressionConcerns.length > 0) { needsHuman = true; humanReasons.push(selected.regressionConcerns.length + ' regression concern(s) from critics') }
} else if (best !== undefined && best.score !== null && best.score > championScore && best.score < threshold) {
  needsHuman = true
  humanReasons.push('best candidate (' + best.score + ') is above champion but below threshold ' + threshold)
}

phase('Regression')
let regression = []
if (selected !== null && regressionProbes.length > 0) {
  const thunks = regressionProbes.map(function (p, idx) {
    return function () {
      return agent(REGRESSOR_PROMPT(p, selected.candidateDir), { label: 'regressor-' + (idx + 1), phase: 'Regression', schema: REGRESSOR_SCHEMA })
    }
  })
  const results = await parallel(thunks)
  regression = results.filter(function (r) { return r !== null })
  const failed = regression.filter(function (r) { return r.passed === false })
  if (failed.length > 0) {
    needsHuman = true
    selected.regressionFailed = true
    humanReasons.push(failed.length + ' regression probe(s) failed against the winner')
  }
}

const lines = []
lines.push('# evo-round #' + round + ' report')
lines.push('')
lines.push('- workspace: ' + workspaceRoot)
lines.push('- proposals: ' + proposals.length + ' (acted ' + acted + ')  actors: ' + maxActors + '  critics/candidate: ' + perCandidate)
lines.push('- threshold: ' + threshold + '  championScore: ' + championScore + (championDir !== null ? '  championDir: ' + championDir : ''))
lines.push('')
lines.push('## outcomes (sorted by mean score)')
if (outcomes.length === 0) {
  lines.push('- (none)')
} else {
  outcomes.forEach(function (o) {
    lines.push('- ' + o.candidateDir + '  score ' + (o.score === null ? 'n/a' : o.score) + '  [' + o.verdicts + ' verdicts, ' + o.accepts + ' accept / ' + o.rejects + ' reject]' + (o.note !== '' ? '  ' + o.note : ''))
  })
}
lines.push('')
lines.push('## selection')
if (selected === null) {
  lines.push('- no winner this round' + (best !== undefined && best.score !== null ? ' (best ' + best.candidateDir + ' = ' + best.score + ')' : '') + ' — no adoption, champion unchanged')
} else {
  lines.push('- selected: ' + selected.candidateDir + '  score ' + selected.score + ' (> champion ' + championScore + ')')
  if (selected.regressionFailed === true) lines.push('- regression: FAILED — do NOT adopt without human review')
  if (selected.regressionConcerns.length > 0) lines.push('- regression concerns: ' + selected.regressionConcerns.join('; '))
}
lines.push('- needsHuman: ' + needsHuman + (humanReasons.length > 0 ? ' (' + humanReasons.join('; ') + ')' : ''))
if (regression.length > 0) {
  lines.push('')
  lines.push('## regression probes')
  regression.forEach(function (r) { lines.push('- [' + (r.passed ? 'PASS' : 'FAIL') + '] ' + r.probe + (r.evidence !== '' ? ' — ' + r.evidence : '')) })
}
lines.push('')
lines.push('## next')
lines.push('- meta: read verdicts under runs/' + round + '/candidate-*/, then either adopt (champion updated), refine criteria, or run round ' + (round + 1))

return {
  ok: true,
  report: lines.join('\\n'),
  round: round,
  championScore: championScore,
  championDir: championDir,
  selected: selected === null ? null : { candidateDir: selected.candidateDir, score: selected.score, regressionFailed: selected.regressionFailed === true },
  score: selected === null ? null : selected.score,
  needsHuman: needsHuman,
  humanReasons: humanReasons,
  outcomes: outcomes.map(function (o) {
    return { candidateDir: o.candidateDir, score: o.score, verdicts: o.verdicts, accepts: o.accepts, rejects: o.rejects, spread: o.spread }
  }),
  regression: regression,
  acted: acted,
  proposalsTotal: proposals.length,
}
`

export { SCRIPT }
export default { SCRIPT, ROUND_META, ROUND_ARGS_DOC }