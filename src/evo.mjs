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

/**
 * 定位工作区相对其所属 git 仓库根的路径。
 * 返回 { root, rel, wsName }；rel === '' 表示工作区**就是**仓库根。
 *
 * 为什么需要它：工作区经常被放在一个**更大的宿主仓库**里（例如
 * `~/Project/my-lab/evo-ws/chain-v1`）。此时任何"对这棵工作区做 git 操作"的意图
 * 都必须显式限定到 `rel`，否则动的是整个宿主仓库。
 */
async function gitLayout(workspace) {
  const top = await runGit(workspace, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return null
  // 两侧都必须取 realpath：macOS 上 `/var` 是指向 `/private/var` 的符号链接，
  // `git rev-parse --show-toplevel` 返回的是后者，而 `os.tmpdir()` 给的是前者。
  // 直接 path.relative 会算出 `../../../..` 这种"仓库外"路径，把 pathspec 打飞。
  const abs = await fs.realpath(path.resolve(workspace)).catch(() => path.resolve(workspace))
  const root = await fs.realpath(top.stdout).catch(() => top.stdout)
  const rel = path.relative(root, abs).split(path.sep)
    .filter((s) => s !== '' && s !== '.').join('/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return { root, rel, wsName: path.basename(abs) }
}

/**
 * 本工作区的 checkpoint tag 名。
 * 嵌套在宿主仓库里时**按工作区名分区**——否则多个工作区共用 `evo/round-N` 会互相覆盖
 * （实测：3 个工作区跑 9 圈只留下 5 个 tag，回滚会滚到别的工作区的检查点）。
 */
function roundTag(layout, round) {
  return layout.rel === '' ? `evo/round-${round}` : `evo/${layout.wsName}/round-${round}`
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
  const layout = await gitLayout(workspace)
  if (layout === null) return { committed: false, git: 'not a git repo', tag: null }
  // ⚠️ checkpoint 只捕获**本工作区**。
  // 旧实现是 `git add -A`（无路径范围）：工作区嵌套在宿主仓库里时，它会把宿主的无关改动、
  // 乃至别人的整个未跟踪工作树扫进 `evo: round N`，并提交到"当时检出的任意分支"。
  // 实测代价：一次 `evo: round 1` 扫进 1,105 个文件（362,698 行），其中只有 18% 属于该工作区。
  // 修法：`add -A -- <rel>` 限定路径 + `commit --only -- <rel>`（只提交该路径，
  // 忽略索引里其它已暂存的内容）。
  const spec = layout.rel === '' ? '.' : layout.rel
  await runGit(layout.root, ['add', '-A', '--', spec])
  const commit = await runGit(layout.root, ['commit', '-q', '-m', `evo: round ${entry.round}`, '--only', '--', spec])
  let tagRes = null
  let tagName = null
  if (tag && commit.ok) {
    tagName = roundTag(layout, entry.round)
    tagRes = await runGit(layout.root, ['tag', tagName])
  }
  return {
    committed: commit.ok,
    git: 'ok',
    tag: tagRes !== null && tagRes.ok ? tagName : null,
    // 便于调用方/测试断言"这次提交被限定到了哪里"；工作区即仓库根时为 null
    scopedTo: layout.rel === '' ? null : layout.rel,
  }
}

/** 回滚：无 round → 本工作区最近一个 checkpoint tag；有 → 指定 tag。 */
export async function rollbackWorkspace(workspace, round) {
  const layout = await gitLayout(workspace)
  if (layout === null) return { ok: false, text: 'workspace is not a git repo — nothing to roll back to' }
  let target
  if (round !== undefined && round !== null) {
    const scoped = roundTag(layout, round)
    target = (await tagExists(layout.root, scoped)) ? scoped : `evo/round-${Number(round)}`
  } else {
    target = await latestRoundTag(layout)
  }
  if (target === null) return { ok: false, text: 'no evo/round-* checkpoint tags found' }
  if (layout.rel === '') {
    const res = await runGit(layout.root, ['reset', '--hard', target])
    if (!res.ok) return { ok: false, text: `git reset --hard ${target} failed: ${res.stderr}` }
    return { ok: true, text: `rolled back to ${target}` }
  }
  // ⚠️ 工作区嵌套在宿主仓库里时**不能**用 `reset --hard`——那会把宿主的全部未提交改动
  // （与工作区无关的文件）一起丢掉。改为只把工作区子树恢复到该 tag。
  // 注意：该 tag 之后在工作区内**新增的未跟踪文件不会被删除**（保守，避免误删用户数据）。
  const res = await runGit(layout.root, ['checkout', target, '--', layout.rel])
  if (!res.ok) return { ok: false, text: `git checkout ${target} -- ${layout.rel} failed: ${res.stderr}` }
  return {
    ok: true,
    text: `rolled back workspace subtree ${layout.rel} to ${target}` +
      ` (host repo's other paths untouched; files added inside the workspace after that round are kept)`,
  }
}

async function tagExists(root, name) {
  const res = await runGit(root, ['tag', '--list', name])
  return res.ok && res.stdout.split('\n').some((t) => t.trim() === name)
}

async function latestRoundTag(layout) {
  // 先找本工作区分区的 tag，再回退到扁平的旧命名（兼容既有工作区）。
  const scoped = await listRoundTags(layout.root, `evo/${layout.wsName}/round-*`)
  if (scoped.length > 0) return scoped[0]
  const flat = await listRoundTags(layout.root, 'evo/round-*')
  return flat[0] ?? null
}

async function listRoundTags(root, pattern) {
  const res = await runGit(root, ['tag', '--list', pattern])
  if (!res.ok) return []
  return res.stdout.split('\n').map((t) => t.trim()).filter(Boolean).sort((a, b) => {
    const na = Number(/round-(\d+)$/.exec(a)?.[1] ?? 0)
    const nb = Number(/round-(\d+)$/.exec(b)?.[1] ?? 0)
    return nb - na
  })
}

/** 一次真实文件复制（保留给未来需要串流的场景；当前用 fs.cp 已够）。 */
export async function copyFile(src, dest) {
  await pipeline(createReadStream(src), createWriteStream(dest))
}

export { today }