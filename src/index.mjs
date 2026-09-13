// evo-engineering — 「RSI 作动词」的 dsh 原生入口（L2 UX 层）。
//
// 把进化工程的工作区操作（init/round/status/rollback）暴露成：
//   - 四个模型工具 evo_init / evo_round / evo_status / evo_rollback
//     （元层=当前会话 agent 用它们驱动进化，人类全程可介入对话）；
//   - 一个 /evo 用户命令路由器。
//
// 回合协议本体不在这里：evo_round 把 workflow/evo-round.mjs 里的引擎脚本交给
// 官方 workflow 引擎（ctx.workflows）跑，引擎负责并行扇出 actor/critic/回归
// 子代理并做 schema 校验；本文件只做 Node 侧的收尾——ledger 追加 + git
// checkpoint（可回溯地基）与人类门禁提示。
//
// 与 dsh-inspect 相同的依赖纪律：workflows 服务不静态 inject（否则在无该服务
// 的组合里整个 entry 永久挂起），只在工具真正被调用时经 ctx.get() 读取，
// 缺服务时报清晰错误而不是拖垮 profile 启动。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { SCRIPT, ROUND_META, ROUND_ARGS_DOC } from '../workflow/evo-round.mjs'
import {
  initWorkspace, readLedger, workspaceStatus, commitRound, rollbackWorkspace,
} from './evo.mjs'
import {
  parseLedger, findChampion, nextRound, parseRegressionProbes, today,
} from './ledger.mjs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const name = 'evo-engineering'

/** 工具侧配置：目前没有用户可调项（预留未来 settings 卡）。 */
export function apply(ctx) {
  // ── workflows 服务的惰性守卫（抄 dsh-inspect 的手法，防加载期挂起）──────
  function requireWorkflows(context) {
    const workflows = context.get('workflows')
    if (workflows === void 0) {
      throw new Error(
        'evo-engineering: no "workflows" service in this profile — evo rounds run on the '
        + 'official workflow engine (@deepseek-ai/dsh-workflow). Use a profile whose '
        + 'composition provides workflows (official base bundles) or add a provider plugin.',
      )
    }
    return workflows
  }

  async function runRoundScript(context, scriptArgs, parent, signal) {
    const workflows = requireWorkflows(context)
    const run = workflows.start({
      script: SCRIPT,
      meta: ROUND_META,
      args: scriptArgs,
      parent,
      signal,
    })
    if (signal !== undefined && signal.aborted) run.cancel('aborted before start')
    const onAbort = signal !== undefined && typeof signal.addEventListener === 'function'
      ? () => { run.cancel('parent step aborted') }
      : undefined
    if (onAbort !== undefined) signal.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed') {
        throw new Error(`evo-round run ${result.stopReason}${result.error !== undefined ? ` (${result.error})` : ''}`)
      }
      return result.value
    } finally {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
      await run.dispose()
    }
  }

  // ── 工具：evo_init ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'evo_init',
    description:
      '初始化一个 evo 进化工作区：把目标（文件/目录）快照进 baseline/，建 evals（标准+回归探针）'
      + '与 ledger.md，git init 打底。之后先和用户对标准（evals/criteria.md），再跑 evo_round。'
      + '触发场景：用户说「进化/优化/改进 X」「让 X 变好」「RSI」，X 是文档/代码/skill/提示词等产物。',
    parameters: {
      target: { type: 'string', required: true, description: '要进化的目标绝对或相对路径（文件或目录）。' },
      workspace: { type: 'string', description: '工作区路径；缺省 <目标名>.evo-workspace（与目标同目录）。' },
      overwrite: { type: 'boolean', description: 'true = 已存在工作区也补骨架（不删已有数据）。' },
      note: { type: 'string', description: '给标准起草的提示：目标的用途、风格、想达成的效果。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const target = String(args.target ?? '').trim()
      if (target === '') throw new Error('evo_init: target is required')
      const workspace = typeof args.workspace === 'string' && args.workspace.trim() !== '' ? args.workspace.trim() : undefined
      const init = await initWorkspace({ target, workspace, overwrite: args.overwrite === true })
      let text = `evo workspace initialized:\n\n${init.layout}\n\n`
      text += `目标快照在 baseline/（只读）。下一步：\n`
      text += `1. 与用户确认标准 → 编辑 ${path.join(init.workspace, 'evals', 'criteria.md')}（可判、可观察）\n`
      text += `2. 可选：在 ${path.join(init.workspace, 'evals', 'regression.md')} 写明上一任冠军必须保持的行为\n`
      text += `3. 调用 evo_round 跑第一圈（workspace=${init.workspace}）`
      if (typeof args.note === 'string' && args.note.trim() !== '') {
        text += `\n\n标准起草提示（供元层参考）：${args.note.trim()}`
      }
      return { ok: true, text }
    },
  }))

  // ── 工具：evo_round ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'evo_round',
    description:
      '跑一回合进化：propose（元层给 proposals 或自 brainstorm）→ act（并行实现）→ critique（独立评审）'
      + '→ select（冠军地板：得分须 ≥ threshold 且 > 上届 champion）→ regression（重跑探针）。'
      + '结果自动追加 ledger.md 并打 git checkpoint（evo/round-N）；有 needsHuman 时需人复核后再采纳。',
    parameters: {
      workspace: { type: 'string', required: true, description: 'evo 工作区路径（evo_init 的返回值）。' },
      proposals: { type: 'array', items: { type: 'string' }, description: '可选：元层显式改进提议（有则不再 brainstorm）。' },
      own_proposals: { type: 'number', description: '无 proposals 时 spawn 的提议 agent 数，默认 2。' },
      actors: { type: 'number', description: '并行实现 agent 数，默认 2。' },
      critics: { type: 'number', description: '每个候选的评审 agent 数，默认 2。' },
      threshold: { type: 'number', description: '入选得分下限，默认 7。' },
      note: { type: 'string', description: '本回合备注（写进 ledger）。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const workspace = String(args.workspace ?? '').trim()
      if (workspace === '') throw new Error('evo_round: workspace is required')
      const parent = exec?.agent
      if (parent === void 0) throw new Error('evo_round requires a calling agent (exec.agent was undefined)')

      const ledgerText = await readLedger(workspace)
      if (ledgerText === null) throw new Error(`evo_round: no ledger.md in ${workspace} — run evo_init first`)
      const entries = parseLedger(ledgerText)
      const champion = findChampion(entries)
      const round = nextRound(entries)

      let probes = []
      try {
        const probeText = await fs.readFile(path.join(workspace, 'evals', 'regression.md'), 'utf8')
        probes = parseRegressionProbes(probeText)
      } catch { /* 无探针文件 = 没有回归约束，跳过 */ }

      let meta = {}
      try {
        meta = JSON.parse(await fs.readFile(path.join(workspace, '.evo-meta.json'), 'utf8'))
      } catch { /* 旧工作区无 meta 文件，回落默认 */ }

      const proposals = Array.isArray(args.proposals)
        ? args.proposals.filter((p) => typeof p === 'string' && p.trim() !== '')
        : undefined
      const scriptArgs = {
        workspaceRoot: workspace,
        round,
        criteriaRef: 'evals/criteria.md',
        baselineRef: 'baseline',
        targetWithin: typeof meta.targetWithin === 'string' ? meta.targetWithin : '',
        ...(proposals !== undefined && proposals.length > 0 ? { proposals } : {}),
        ...(typeof args.own_proposals === 'number' ? { ownProposals: args.own_proposals } : {}),
        ...(typeof args.actors === 'number' ? { actors: args.actors } : {}),
        ...(typeof args.critics === 'number' ? { critics: args.critics } : {}),
        ...(typeof args.threshold === 'number' ? { threshold: args.threshold } : {}),
        championScore: champion !== null ? champion.score : 0,
        championDir: champion !== null ? champion.candidateDir : null,
        regressionProbes: probes,
      }

      const resultValue = await runRoundScript(ctx, scriptArgs, parent, exec?.signal)
      const r = resultValue ?? {}
      const report = typeof r.report === 'string' ? r.report : `evo_round: workflow finished with no report${r.error !== undefined ? ` (${r.error})` : ''}`

      const entry = {
        round: typeof r.round === 'number' ? r.round : round,
        date: today(),
        proposalsTotal: typeof r.proposalsTotal === 'number' ? r.proposalsTotal : 0,
        acted: typeof r.acted === 'number' ? r.acted : 0,
        actors: typeof args.actors === 'number' ? args.actors : 2,
        criticsPerCandidate: Array.isArray(r.outcomes) && r.outcomes.length > 0 ? (r.outcomes[0].verdicts ?? 0) : 0,
        outcomes: Array.isArray(r.outcomes) ? r.outcomes : [],
        selected: r.selected ?? null,
        regressionFailed: r.selected?.regressionFailed === true,
        needsHuman: r.needsHuman === true,
        humanReasons: Array.isArray(r.humanReasons) ? r.humanReasons : [],
        note: typeof args.note === 'string' ? args.note : undefined,
      }
      const commit = await commitRound(workspace, entry)

      const lines = []
      lines.push(report)
      lines.push('')
      lines.push(`- ledger: ${path.join(workspace, 'ledger.md')}`)
      lines.push(`- git checkpoint: ${commit.committed ? (commit.tag ?? 'committed') : (commit.git === 'not a git repo' ? 'skipped (not a git repo)' : 'failed')}`)
      if (entry.needsHuman) {
        lines.push('')
        lines.push('⚠ needsHuman: 人需要看一眼（原因见 report）。采纳前调用 evo_rollback 可随时回退本圈。')
      } else if (entry.selected !== null) {
        lines.push(`- ✅ champion 已更新为 ${entry.selected.candidateDir} (${entry.selected.score})`)
      }
      lines.push('')
      lines.push(`  next: /evo status 看状态；读 verdict 明细 runs/${entry.round}/candidate-*/verdict-*.json；或跑下一圈 round ${entry.round + 1}`)
      return { ok: true, text: lines.join('\n') }
    },
  }))

  // ── 工具：evo_status ───────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'evo_status',
    description: '查看 evo 工作区状态：回合数、当前 champion（冠军地板）、最近一回合结果。',
    parameters: {
      workspace: { type: 'string', required: true, description: 'evo 工作区路径。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const workspace = String(args.workspace ?? '').trim()
      if (workspace === '') throw new Error('evo_status: workspace is required')
      const status = await workspaceStatus(workspace)
      return { ok: status.ok, text: status.ok ? status.text : status.reason }
    },
  }))

  // ── 工具：evo_rollback ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'evo_rollback',
    description: '回滚 evo 工作区到某回合 checkpoint（git tag evo/round-N）；无 round 参数则回滚到最近一个 checkpoint。',
    parameters: {
      workspace: { type: 'string', required: true, description: 'evo 工作区路径。' },
      round: { type: 'number', description: '回滚到的回合号；缺省 = 最近一个 evo/round-* tag。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const workspace = String(args.workspace ?? '').trim()
      if (workspace === '') throw new Error('evo_rollback: workspace is required')
      const res = await rollbackWorkspace(workspace, args.round)
      return { ok: res.ok, text: res.text }
    },
  }))

  // ── 命令：/evo ─────────────────────────────────────────────────────────────
  ctx.commands.register({
    name: 'evo',
    description: '进化工程（RSI 作动词）：/evo init <target> | /evo round [proposal] | /evo status | /evo rollback [round] | /evo help',
    input: { hint: 'init|round|status|rollback|help [args]' },
    handler: async (invocation) => {
      const raw = invocation.rawInput.trim()
      try {
        if (raw === '' || raw === 'help') {
          return { kind: 'success', text: [
            'evo — 让 RSI 成为使用 agent 的方式（进化工程）。',
            '',
            '用法：',
            '  /evo init <target> [workspace]   建工作区并快照目标到 baseline/',
            '  /evo round [n | "提议文本"]      跑一回合（n=回合数，缺省自动续号；带引号文本=显式提议）',
            '  /evo status                      看回合数/冠军/最近一轮',
            '  /evo rollback [n]                回滚到 checkpoint evo/round-N（缺省最近）',
            '  /evo help                        本帮助',
            '',
            '完整的回合协议、防退化、递归阶梯见 evo skill。',
          ].join('\n') }
        }
        if (raw === 'status') {
          const ws = await findWorkspaceForCommand(ctx)
          const status = await workspaceStatus(ws)
          return status.ok
            ? { kind: 'success', text: status.text }
            : { kind: 'error', text: status.reason }
        }
        const rollbackMatch = /^rollback(?:\s+(\d+))?$/.exec(raw)
        if (rollbackMatch !== null) {
          const ws = await findWorkspaceForCommand(ctx)
          const res = await rollbackWorkspace(ws, rollbackMatch[1] === undefined ? undefined : Number(rollbackMatch[1]))
          return res.ok ? { kind: 'success', text: res.text } : { kind: 'error', text: res.text }
        }
        const initMatch = /^init\s+(.+?)(?:\s+(\S+))?$/.exec(raw)
        if (initMatch !== null) {
          const target = initMatch[1].trim()
          const workspace = initMatch[2]?.trim()
          const init = await initWorkspace({ target, workspace: workspace ?? undefined })
          let text = `evo workspace initialized:\n\n${init.layout}\n\n下一步：与用户对标准（${path.join(init.workspace, 'evals', 'criteria.md')}），然后 /evo round。`
          return { kind: 'success', text }
        }
        const roundMatch = /^round(?:\s+(.+))?$/.exec(raw)
        if (roundMatch !== null) {
          const ws = await findWorkspaceForCommand(ctx)
          const rest = (roundMatch[1] ?? '').trim()
          // 引号包裹的一段文本 = 显式提议；其他选项暂不支持（工具路径提供完整参数）。
          const proposals = rest.startsWith('"') && rest.endsWith('"') ? [rest.slice(1, -1)] : undefined
          const parent = invocation.agent
          if (parent === void 0) return { kind: 'error', text: '/evo round requires an active agent' }
          const ledgerText = await readLedger(ws)
          if (ledgerText === null) return { kind: 'error', text: 'no ledger.md — run /evo init first' }
          const entries = parseLedger(ledgerText)
          const champion = findChampion(entries)
          const round = nextRound(entries)
          const scriptArgs = {
            workspaceRoot: ws,
            round,
            ...(proposals !== undefined && proposals.length > 0 ? { proposals } : {}),
            championScore: champion !== null ? champion.score : 0,
            championDir: champion !== null ? champion.candidateDir : null,
          }
          const value = await runRoundScript(ctx, scriptArgs, parent, invocation.signal)
          const entry = {
            round: typeof value?.round === 'number' ? value.round : round,
            date: today(),
            proposalsTotal: value?.proposalsTotal ?? 0,
            acted: value?.acted ?? 0,
            actors: 2,
            criticsPerCandidate: Array.isArray(value?.outcomes) && value.outcomes.length > 0 ? (value.outcomes[0].verdicts ?? 0) : 0,
            outcomes: Array.isArray(value?.outcomes) ? value.outcomes : [],
            selected: value?.selected ?? null,
            regressionFailed: value?.selected?.regressionFailed === true,
            needsHuman: value?.needsHuman === true,
            humanReasons: Array.isArray(value?.humanReasons) ? value.humanReasons : [],
          }
          const commit = await commitRound(ws, entry)
          const lines = [value?.report ?? '(no report)', '', `- git checkpoint: ${commit.committed ? (commit.tag ?? 'committed') : 'skipped'}`]
          if (entry.needsHuman) lines.push('', '⚠ needsHuman — 人先看一眼再决定是否采纳；evo_rollback 可回退。')
          else if (entry.selected !== null) lines.push('', `✅ champion 更新为 ${entry.selected.candidateDir} (${entry.selected.score})`)
          return { kind: 'success', text: lines.join('\n') }
        }
        return { kind: 'error', text: `unknown /evo subcommand: ${raw.split(/\s+/)[0] ?? ''} — try /evo help` }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'error', text: `evo: ${message}` }
      }
    },
  })

  /** /evo 命令的默认工作区：当前工作目录下唯一的 *.evo-workspace；没有则报错。 */
  async function findWorkspaceForCommand(context) {
    const cwd = process.cwd()
    const candidates = [] // 简化：只查 cwd 下直接一层
    try {
      for (const name of await fs.readdir(cwd)) {
        if (name.endsWith('.evo-workspace')) candidates.push(path.join(cwd, name))
      }
    } catch { /* fallthrough */ }
    if (candidates.length === 0) throw new Error('no *.evo-workspace found in the current directory — run /evo init <target> first')
    if (candidates.length > 1) throw new Error(`multiple evo workspaces found (${candidates.join(', ')}) — use the evo_round/evo_status tools with an explicit workspace instead`)
    return candidates[0]
  }
}

/** ROUND_ARGS_DOC 导出供文档/测试引用。 */
export { ROUND_ARGS_DOC }