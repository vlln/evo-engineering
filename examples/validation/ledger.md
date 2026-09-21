# Evo ledger

每个 `## Round N` 小节 = 一回合的可回溯记录。champion = 最近一个入选且未被
回归挡下的候选；新候选必须在其分数之上才可能当选（冠军地板）。
verdict 明细在 `runs/<round>/candidate-*/verdict-*.json`。

## Round 1 — 2026-09-13
- proposals: 2 proposals (acted 2) · actors: 2 · critics/candidate: 2
- outcomes: runs/1/candidate-1 8.8 [1 verdicts, 1 accept/0 reject] ; runs/1/candidate-2 6.3 [2 verdicts, 0 accept/0 reject]
- selected: runs/1/candidate-1 (8.8)
- needsHuman: true (critic flagged 4 regression concern(s) — perspective shift 需人确认)
- note: live engine round (workflow tool)

## Round 2 — 2026-09-13
- proposals: 1 proposals (acted 1) · actors: 1 · critics/candidate: 2
- outcomes: runs/2/candidate-1 8.5 [2 verdicts, 2 accept/0 reject]
- selected: none — champion unchanged
- needsHuman: false
- note: meta-proposal round: 冠军地板生效（8.5 < 8.8），champion 不变
