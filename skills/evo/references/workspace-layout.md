# workspace-layout — 目录、命名与 ledger 行格式规范

配套 skills/evo/SKILL.md「Evo Workspace」一节。约定统一后，跨会话/跨 harness
看到同一布局就能直接干活。

## 目录树（规范）

```
<workspace>/
├── baseline/                # 快照，只读（绝不修改）
│   └── <目标原样>           # 目录整树复制 / 文件带名复制；targetWithin 记录子路径
├── evals/
│   ├── criteria.md          # 标准：`## 标准` + `- (placeholder)` 起步；可判优先
│   └── regression.md        # 探针：每行 `- <name>: <check>`
├── runs/
│   └── <round>/
│       ├── candidate-<i>/   # i 从 1 起；自包含候选（含复制来的文件 + CHANGELOG.md）
│       │   └── verdict-<k>.json
│       └── proposals.json   # 本圈提议（有元层/工具则落盘，便于审计）
├── ledger.md                # 决策记录（见下）
└── .evo-meta.json           # init 元信息 {target, targetWithin, baselineContent, initedAt}
```

命名约束：
- 回合号从 1 递增，不跳号；候选号 1 起，本圈内唯一。
- `candidate-<i>` 目录**自包含**（改后的完整产物），critic 只看它，不依赖 baseline。
- verdict 文件名 `verdict-<k>.json`，k 是 critic 序号。

## ledger.md 的回合小节（每圈一节）

```markdown
## Round 3 — 2026-09-13
- proposals: 2 (acted 2) · actors: 2 · critics/candidate: 2
- outcomes: runs/3/candidate-1 6.2 [2 verdicts, 1 accept/0 reject] ; runs/3/candidate-2 7.4 [2 verdicts, 2 accept/0 reject]
- selected: runs/3/candidate-2 (7.4)
- needsHuman: false
```

- `selected` 场是 champion 的判据；（可选）`⚠ regression FAILED` 标记 = 踢出 champion。
- L2/L3 动作也在 ledger 留痕：
  - `criteria change r4: +<新标准>（用户签收）`
  - `protocol change r6: 回滚阈值 7→6（双人评审 + 冻结基准 A/B）`
- ledger 是**追加型**：不改写历史小节（改历史 = 篡改审计）。

## 初始化四步（任何 harness 直接用文件工具）

1. mkdir workspace（独立目录，**不要建在目标目录内部**——防递归复制）；
2. 复制目标 → baseline/；写 `.evo-meta.json`（含 targetWithin）；
3. 生成三件：criteria.md（placeholder）、regression.md（placeholder）、ledger.md（头部）；
4. `git init && git add -A && git commit -m "evo: init"`（git 可用时）。

## 不变量（每圈结束核对）

- baseline/ 内容与 init 时一致（抽查）；
- runs/ 下新增内容只属于本圈；
- 没有任何进程/会话持有的"活文件"被当作 baseline（活产物先冻结再快照）。