// evo.mjs — evo 工作区的 Node 侧操作：init 骨架、ledger 读写、git checkpoint/回滚。
// 无 cordis 依赖，任何宿主上下文都能用（插件调用 / 直接脚本调用）。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { ledgerHeader, renderRoundEntry, parseLedger, findChampion, nextRound, today } from './ledger.mjs'

function runGit(root, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: 20_000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, code: error.code, stderr: String(stderr ?? error.message).trim() })
        return
      }
      resolve({ ok: true, stdout: String(stdout ?? '').trim() })
    })
  })
}

async function isGitRepo(root) {
  const res = await runGit(root, ['rev-parse', '--is-inside-work-tree'])
  return res.ok && res.stdout === 'true'
}

async function copyTargetIntoBaseline(targetAbs, baselineDir) {
  const stat = await fs.stat(targetAbs)
  if (stat.isDirectory()) {
    await fs.cp(targetAbs, baselineDir, { recursive: true, errorOnExist: false })
    return { baselineContent: baselineDir, targetWithin: '' }
  }
  const name = path.basename(targetAbs)
  await fs.mkdir(baselineDir, { recursive: true })
  await fs.copyFile(targetAbs, path.join(baselineDir, name))
  return { baselineContent: path.join(baselineDir, name), targetWithin: name }
}

/**
 * 初始化 evo 工作区：
 *   workspaceRoot/
 *     baseline/        ← 进化对象快照（只读）
 *     evals/criteria.md    ← 标准（占位，等待元层/人细化）
 *     evals/regression.md  ← 回归探针（占位）
 *     runs/            ← 每回合候选与 verdict
 *     ledger.md        ← 决策记录
 * 并 git init + 初始提交（git 可用时），保证每圈可回溯。
 */
export async function initWorkspace({ target, workspace, overwrite = false }) {
  if (typeof target !== 'string' || target.trim() === '') throw new Error('evo init: target is required')
  const targetAbs = path.resolve(target.trim())
  let stat
  try {
    stat = await fs.stat(targetAbs)
  } catch {
    throw new Error(`evo init: target does not exist: ${targetAbs}`)
  }
  const resolved = workspace !== undefined && workspace !== null && String(workspace).trim() !== ''
    ? path.resolve(String(workspace).trim())
    : path.join(path.dirname(targetAbs), `${path.basename(targetAbs)}.evo-workspace`)
  // 防自嵌套：工作区不能建在目标内部（复制时会递归炸）。
  const inTarget = stat.isDirectory() && (resolved === targetAbs || resolved.startsWith(targetAbs + path.sep))
  if (inTarget) throw new Error(`evo init: workspace must not be inside the target directory (plain ${resolved})`)

  let exists = true
  try { await fs.access(resolved) } catch { exists = false }
  if (exists && !overwrite) {
    throw new Error(`evo init: workspace already exists: ${resolved} (pass overwrite=true to reset)`)
  }

  const baselineDir = path.join(resolved, 'baseline')
  if (exists && overwrite) {
    // 保留已有内容：只补缺失骨架，不删用户已有数据。
    await fs.mkdir(path.join(resolved, 'runs'), { recursive: true })
  } else {
    await fs.mkdir(path.join(resolved, 'runs'), { recursive: true })
  }
  const evalsDir = path.join(resolved, 'evals')
  await fs.mkdir(evalsDir, { recursive: true })

  const { baselineContent, targetWithin } = await copyTargetIntoBaseline(targetAbs, baselineDir)

  const criteriaPath = path.join(evalsDir, 'criteria.md')
  try {
    await fs.access(criteriaPath)
  } catch {
    await fs.writeFile(criteriaPath, [
      '# Criteria — 怎样算「更好」',
      '',
      '> 由元层（会话 agent）与人类在对话里共同细化。标准要可判：',
      '> 每条最好写成「观察得到的具体表现」，而不是形容词。',
      '> 例：❌「语气不要 AI 味」→ ✅「无‘首先/其次/最后’式套话、无‘值得注意的是’，句子长短混合」。',
      '',
      '## 标准',
      '',
      '- （placeholder）criterion-1: 具体可判的标准',
      '',
    ].join('\n'))
  }
  const regressionPath = path.join(evalsDir, 'regression.md')
  try {
    await fs.access(regressionPath)
  } catch {
    await fs.writeFile(regressionPath, [
      '# Regression probes — 上一任冠军必须保持的行为',
      '',
      '> 每行一条探针：`- <name>: <可执行的检查>`。每回合选优后对新候选重跑，',
      '> 任一失败 → 该候选标记 regressionFailed，需人复核。',
      '',
      '- （placeholder）fact-check: 通读候选，确认没有引入与 baseline 相反的事实。',
      '',
    ].join('\n'))
  }
  const ledgerPath = path.join(resolved, 'ledger.md')
  try {
    await fs.access(ledgerPath)
  } catch {
    await fs.writeFile(ledgerPath, ledgerHeader())
  }

  const gitRes = await runGit(resolved, ['init', '-q'])
  const gitOk = gitRes.ok
  if (gitOk) {
    await runGit(resolved, ['add', '-A'])
    await runGit(resolved, ['commit', '-q', '-m', 'evo: init workspace'])
  }
  // 机器可读的 init 元信息（evo_round 用它恢复 targetWithin 等）。
  await fs.writeFile(path.join(resolved, '.evo-meta.json'), JSON.stringify({
    target: targetAbs,
    baselineContent,
    targetWithin,
    initedAt: today(),
    git: gitOk,
  }, null, 2))

  return {
    ok: true,
    workspace: resolved,
    baselineContent,
    targetWithin,
    git: gitOk ? 'initialized' : 'unavailable (state still persisted in ledger.md)',
    layout: [
      resolved,
      '├── baseline/         ← 进化对象快照（只读）',
      '├── evals/',
      '│   ├── criteria.md   ← 标准（先和用户对标准再跑第一圈！）',
      '│   └── regression.md ← 回归探针',
      '├── runs/             ← 每回合：候选 + verdict',
      '└── ledger.md         ← 决策记录（champion 从这读出）',
    ].join('\n'),
  }
}

/** 读 ledger 全文；不存在返回 null。 */
export async function readLedger(workspace) {
  try {
    return await fs.readFile(path.join(workspace, 'ledger.md'), 'utf8')
  } catch {
    return null
  }
}

/** 工作区当前状态摘要（status 工具用）。 */
export async function workspaceStatus(workspace) {
  const text = await readLedger(workspace)
  if (text === null) return { ok: false, reason: 'no ledger.md — run evo init first' }
  const entries = parseLedger(text)
  const champion = findChampion(entries)
  const lines = []
  lines.push(`# Evo status — ${workspace}`)
  lines.push(`- rounds: ${entries.length} (next: ${nextRound(entries)})`)
  if (champion !== null) lines.push(`- champion: ${champion.candidateDir} (score ${champion.score})`)
  else lines.push('- champion: none yet')
  if (entries.length > 0) {
    const last = entries[entries.length - 1]
    lines.push(`- last round #${last.round}: ${last.selected !== null ? `selected ${last.selected.candidateDir} (${last.selected.score})` : 'no winner'}` +
      (last.needsHuman ? ' [needsHuman]' : ''))
  }
  return { ok: true, text: lines.join('\n'), entries, champion }
}

/** 收尾：把一回合结果追加进 ledger 并打 git checkpoint（可回溯地基）。 */
export async function commitRound(workspace, entry, { tag = true } = {}) {
  const ledgerPath = path.join(workspace, 'ledger.md')
  let text = await readLedger(workspace) ?? ''
  text = text.trimEnd() + '\n\n' + renderRoundEntry(entry)
  await fs.writeFile(ledgerPath, text)
  const git = await isGitRepo(workspace)
  if (!git) return { committed: false, git: 'not a git repo', tag: null }
  await runGit(workspace, ['add', '-A'])
  const commit = await runGit(workspace, ['commit', '-q', '-m', `evo: round ${entry.round}`])
  let tagRes = null
  if (tag && commit.ok) {
    tagRes = await runGit(workspace, ['tag', `evo/round-${entry.round}`])
  }
  return { committed: commit.ok, git: 'ok', tag: tagRes !== null && tagRes.ok ? `evo/round-${entry.round}` : null }
}

/** 回滚：无 round → 最近一个 evo/round-* tag；有 → 指定 tag。 */
export async function rollbackWorkspace(workspace, round) {
  const git = await isGitRepo(workspace)
  if (!git) return { ok: false, text: 'workspace is not a git repo — nothing to roll back to' }
  const target = round !== undefined && round !== null
    ? `evo/round-${Number(round)}`
    : await latestRoundTag(workspace)
  if (target === null) return { ok: false, text: 'no evo/round-* checkpoint tags found' }
  const res = await runGit(workspace, ['reset', '--hard', target])
  if (!res.ok) return { ok: false, text: `git reset --hard ${target} failed: ${res.stderr}` }
  return { ok: true, text: `rolled back to ${target}` }
}

async function latestRoundTag(workspace) {
  const res = await runGit(workspace, ['tag', '--list', 'evo/round-*'])
  if (!res.ok) return null
  const tags = res.stdout.split('\n').filter(Boolean).sort((a, b) => {
    const na = Number(/evo\/round-(\d+)/.exec(a)?.[1] ?? 0)
    const nb = Number(/evo\/round-(\d+)/.exec(b)?.[1] ?? 0)
    return nb - na
  })
  return tags[0] ?? null
}

/** 一次真实文件复制（保留给未来需要串流的场景；当前用 fs.cp 已够）。 */
export async function copyFile(src, dest) {
  await pipeline(createReadStream(src), createWriteStream(dest))
}

export { today }