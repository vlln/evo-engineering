# 验证存档 —— 真实引擎跑出来的两回合

这个目录是**真跑过**的证据快照（不是示意/手写样例）。目标是一篇 AI 味爆棚的
博客草稿 `examples/blog-draft/README.md`，标准是 4 条**模糊标准**（去 AI 味 /
像真人写的 / 有观点 / 保留原意），见 `criteria.md`。

| 文件 | 是什么 |
|---|---|
| `ledger.md` | 两回合的决策记录：分数、入选者、needsHuman 原因 |
| `criteria.md` / `regression.md` | 本回合使用的标准与回归探针 |
| `round-1-winner/` | 胜出候选（8.8）：改写后的正文 + CHANGELOG + 一份 critic 判分 |
| `round-2-challenger/` | 挑战者（8.5）：**被冠军地板拒绝**的候选 + 判分 |

## 两回合发生了什么

- **Round 1**：2 个提议子代理 → 2 个 actor 隔离实现 → 每个候选 2 个独立 critic
  → 2 个回归检查。`round-1-winner` 以 **8.8 当选**（无 reject，两条回归探针 PASS）。
  critic 的判分是量化+取证式的：grep 验证禁词零命中、句长极差从 baseline 的
  3.9 倍拉到 9.5 倍；同时它主动报了"第一人称 vs 群体口吻"的视角回归担忧，
  于是该回合被标 `needsHuman`（人可介入，机制不替你拍板）。
- **Round 2**：元层读 Round 1 的 critic 意见，提了一个针对性提议（修正文里
  五子棋实验的叙事自洽瑕疵）。挑战者拿到 **8.5**：高于阈值 7、无 reject，
  但 **8.5 < 冠军 8.8** → **拒绝采纳，champion 不变**。
  这就是防退化三件套里的"冠军地板"在真实运行中生效的样子。

> Round 2 的拒绝是本项目最想展示的一帧：**分数进步不足时，系统宁可不动**。

## 怎么自己复现

```sh
# 1. 建工作区（把目标快照进 baseline/）
/evo init examples/blog-draft
# 2. 对标准（把 criteria.md 拷进工作区 evals/，或直接和 agent 讨论着改）
# 3. 跑圈
/evo round          # 提2案 → 隔离实现 → 独立评审 → 选优 → 回归 → 记账+tag
/evo status         # 看 champion 与冠军地板
```

用插件跑时，每圈会自动写 `ledger.md` 并打 git tag（`evo/round-N`；工作区嵌在
宿主仓库里时会分区成 `evo/<工作区名>/round-N`），`/evo rollback` 可随时回退。

本地实测工作区（含 git 历史，可现场演示回滚）不入库，路径为
`examples/blog-draft.evo-workspace/`（在 `.gitignore` 里）。
