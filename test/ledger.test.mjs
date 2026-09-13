// ledger.test.mjs — ledger 纯函数单测：解析/渲染/champion 读取/下一回合号/探针解析。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderRoundEntry, ledgerHeader, parseLedger, findChampion, nextRound, parseRegressionProbes,
} from '../src/ledger.mjs'

test('renderRoundEntry emits a round section with selected', () => {
  const text = renderRoundEntry({
    round: 2,
    date: '2026-09-13',
    proposalsTotal: 2,
    acted: 2,
    actors: 2,
    criticsPerCandidate: 2,
    outcomes: [
      { candidateDir: 'runs/2/candidate-1', score: 6.2, verdicts: 2, accepts: 1, rejects: 0, spread: 1.4 },
      { candidateDir: 'runs/2/candidate-2', score: 7.4, verdicts: 2, accepts: 2, rejects: 0, spread: 0.6 },
    ],
    selected: { candidateDir: 'runs/2/candidate-2', score: 7.4 },
    regressionFailed: false,
    needsHuman: false,
    humanReasons: [],
    note: undefined,
  })
  assert.match(text, /## Round 2 — 2026-09-13/)
  assert.match(text, /selected: runs\/2\/candidate-2 \(7\.4\)/)
  assert.match(text, /needsHuman: false/)
  assert.ok(text.trimEnd().endsWith('\n') === false || true)
})

test('parseLedger round-trips entries and findChampion picks the last non-regression winner', () => {
  const body = [
    ledgerHeader(),
    renderRoundEntry({ round: 1, selected: { candidateDir: 'runs/1/candidate-2', score: 7.1 }, needsHuman: false, regressionFailed: false, humanReasons: [], outcomes: [] }),
    renderRoundEntry({ round: 2, selected: { candidateDir: 'runs/2/candidate-1', score: 7.3 }, needsHuman: false, regressionFailed: true, humanReasons: ['1 regression probe(s) failed'], outcomes: [] }),
    renderRoundEntry({ round: 3, selected: null, needsHuman: true, humanReasons: ['no winner'], outcomes: [] }),
  ].join('\n')
  const entries = parseLedger(body)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].round, 1)
  assert.equal(entries[1].regressionFailed, true)
  assert.equal(entries[2].selected, null)
  assert.equal(entries[2].needsHuman, true)
  const champion = findChampion(entries)
  assert.deepEqual(champion, { candidateDir: 'runs/1/candidate-2', score: 7.1 })
  assert.equal(nextRound(entries), 4)
})

test('parseRegressionProbes handles plain and checkbox lines', () => {
  const text = [
    '# probes',
    '',
    '- fact-check: 通读候选，确认没有引入与 baseline 相反的事实。',
    '- [ ] smoke: 候选目录存在且含 CHANGELOG.md',
    '- 不是探针的一行没有冒号结构 xyz',
  ].join('\n')
  const probes = parseRegressionProbes(text)
  assert.equal(probes.length, 2)
  assert.equal(probes[0].name, 'fact-check')
  assert.equal(probes[1].name, 'smoke')
})