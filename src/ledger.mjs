// ledger.mjs — evo 工作区账本（纯函数，无 cordis 依赖，可单测）。
//
// ledger.md 是进化循环的「决策记录 + 可回溯地基」：每回合追加一个 `## Round N` 小节，
// 记录提议数、各候选分数、入选者、needsHuman 原因。champion = 最近一个
// 非 regressionFailed 的入选候选（冠军地板由此读出）。

/** 当前时间戳（YYYY-MM-DD，本地时区）。 */
export function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 把一条回合记录渲染成 markdown 小节（追加到 ledger.md 末尾）。 */
export function renderRoundEntry(entry) {
  const lines = []
  lines.push(`## Round ${entry.round} — ${entry.date ?? today()}`)
  const proposalInfo = typeof entry.proposalsTotal === 'number'
    ? `${entry.proposalsTotal} proposals (acted ${entry.acted ?? '?'})`
    : 'n/a'
  lines.push(`- proposals: ${proposalInfo} · actors: ${entry.actors ?? '?'} · critics/candidate: ${entry.criticsPerCandidate ?? '?'}`)
  if (Array.isArray(entry.outcomes) && entry.outcomes.length > 0) {
    const parts = entry.outcomes.map((o) => `${o.candidateDir} ${o.score === null ? 'n/a' : o.score}` +
      ` [${o.verdicts ?? 0} verdicts, ${o.accepts ?? 0} accept/${o.rejects ?? 0} reject]`)
    lines.push(`- outcomes: ${parts.join(' ; ')}`)
  }
  if (entry.selected === null || entry.selected === undefined) {
    lines.push('- selected: none — champion unchanged')
  } else {
    const flag = entry.regressionFailed === true ? '  ⚠ regression FAILED' : ''
    lines.push(`- selected: ${entry.selected.candidateDir} (${entry.selected.score})${flag}`)
  }
  const reasons = Array.isArray(entry.humanReasons) && entry.humanReasons.length > 0
    ? entry.humanReasons.join('; ')
    : (entry.needsHuman ? 'see round details' : '—')
  lines.push(`- needsHuman: ${entry.needsHuman === true}${entry.needsHuman === true ? ` (${reasons})` : ''}`)
  if (typeof entry.note === 'string' && entry.note !== '') lines.push(`- note: ${entry.note}`)
  lines.push('')
  return lines.join('\n')
}

/** ledger 文件初始模板（init 时写入）。 */
export function ledgerHeader() {
  return [
    '# Evo ledger',
    '',
    '每个 `## Round N` 小节 = 一回合的可回溯记录。champion = 最近一个入选且未被',
    '回归挡下的候选；新候选必须在其分数之上才可能当选（冠军地板）。',
    'verdict 明细在 `runs/<round>/candidate-*/verdict-*.json`。',
    '',
  ].join('\n')
}

const ROUND_RE = /^## Round (\d+) — (\d{4}-\d{2}-\d{2})/gm
const SELECTED_RE = /^- selected: (runs\/\d+\/candidate-\d+) \(([\d.]+)\)/m
const NEEDS_HUMAN_RE = /^- needsHuman: (true|false)/m

/** 解析 ledger 文本为条目数组（旧到新）。 */
export function parseLedger(text) {
  const entries = []
  if (typeof text !== 'string') return entries
  let m
  ROUND_RE.lastIndex = 0
  const starts = []
  while ((m = ROUND_RE.exec(text)) !== null) starts.push({ round: Number(m[1]), date: m[2], index: m.index })
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    const block = text.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : undefined)
    const sel = SELECTED_RE.exec(block)
    const nh = NEEDS_HUMAN_RE.exec(block)
    entries.push({
      round: start.round,
      date: start.date,
      selected: sel === null ? null : { candidateDir: sel[1], score: Number(sel[2]) },
      needsHuman: nh !== null && nh[1] === 'true',
      regressionFailed: /⚠ regression FAILED/.test(block),
    })
  }
  return entries
}

/**
 * 从条目里读出当前 champion（最后一个入选且非 regressionFailed 的）。
 * 无 → null。champion 分数作为下一回合的冠军地板。
 */
export function findChampion(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.selected !== null && e.regressionFailed !== true) return e.selected
  }
  return null
}

/** 下一回合号 = 最大已有回合 + 1。 */
export function nextRound(entries) {
  let max = 0
  for (const e of entries) if (e.round > max) max = e.round
  return max + 1
}

/** 从 evals/regression.md 解析回归探针：每行 `- <name>: <check>`（或复选框 `- [ ] <name>: <check>`）。 */
export function parseRegressionProbes(text) {
  const probes = []
  if (typeof text !== 'string') return probes
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = /^- (?:\[ \] )?([^:]{1,60}): (.+)$/.exec(line)
    if (m !== null) probes.push({ name: m[1].trim(), check: m[2].trim() })
  }
  return probes
}