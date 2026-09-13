# dsh-native — 在 dsh 上跑进化协议：三种速成方式 + args 全表

配套 skills/evo/SKILL.md「在 dsh 上跑」一节。dsh 用户优先用本文件的三种方式；
其他 harness 的用户只看 SKILL.md 本体 + 其他 references 就够。

## 方式一：/evo 命令（人最顺手的入口）

| 命令 | 干什么 |
|---|---|
| `/evo init <target> [workspace]` | 建工作区 + 快照进 baseline + git init |
| `/evo round` | 跑一回合（自 brainstorm ×2，自动记账 + tag） |
| `/evo round "具体提议"` | 带引号文本 = 元层显式提议（跳过 brainstorm） |
| `/evo status` | 回合数 / 当前 champion / 最近一轮 |
| `/evo rollback [n]` | 回滚到 checkpoint evo/round-N（缺省最近） |
| `/evo help` | 帮助 |

默认工作区 = 当前目录下的 `*.evo-workspace`；多个工作区时改用工具显式指定。

## 方式二：evo_* 工具（元层/模型驱动，参数全）

- `evo_init {target, workspace?, overwrite?, note?}`
- `evo_round {workspace, proposals?, own_proposals?, actors?, critics?, threshold?, note?}`
  —— 返回完整报告；结果自动进 ledger + git checkpoint；`needsHuman` 时人先看再采纳。
- `evo_status {workspace}` / `evo_rollback {workspace, round?}`

## 方式三：把 evo-round 脚本直接喂给官方 workflow 工具

任何带官方 `workflow` 工具的 dsh 会话都能自主跑回合（比如没有装插件的
部署环境）。脚本在 `workflow/evo-round.mjs`：`import { SCRIPT, ROUND_META,
ROUND_ARGS_DOC } from '.../evo-round.mjs'`，把 `SCRIPT` 作为 workflow 工具的
`script` 参数、`ROUND_ARGS_DOC` 里列的字段作为 `args`。跑完拿到结构化结果后，
**手动**补第 6 步：ledger 追加 + `git tag evo/round-N`（脚本不做 IO）。

### evo-round args 全表

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `workspaceRoot` | string, 必填 | 工作区绝对路径 |
| `round` | number, 1 | 回合号（仅用于路径/报告） |
| `criteriaRef` | string, evals/criteria.md | 标准相对路径 |
| `baselineRef` | string, baseline | 基线目录相对路径 |
| `targetWithin` | string, '' | 要进化的子路径（相对 baseline）；''= 整个基线 |
| `proposals` | string[], 缺省无 | 元层显式提议；给了就不 brainstorm |
| `ownProposals` | number, 2（有 proposals 时 0）| 自动提议 agent 数（上限 4） |
| `actors` | number, 2（1–4） | 并行实现 agent 数 |
| `critics` | number, 2（1–3） | 每候选评审 agent 数 |
| `maxAgents` | number, 18 | 本回合 agent 总预算（超出先砍 critic） |
| `threshold` | number, 7 | 入选得分下限 |
| `championScore` | number, 0 | 冠军地板（上一任胜者分） |
| `championDir` | string/null, null | 上一任胜者目录 |
| `regressionProbes` | {name,check}[], [] | 回归探针 |

脚本返回：`{ok, report, round, selected, score, needsHuman, humanReasons,
outcomes[], regression[], ...}`。

## 其他 harness 的 fallback 映射

| evo 原语 | dsh | 其他 harness |
|---|---|---|
| 子代理（独立上下文）| subagent（官方）| 任意 agent 的 subagent/child 能力；没有就同会话分段跑（告知用户成本更高）|
| schema 校验输出 | workflow agent 的 opts.schema | 提示词里写死 JSON 格式 + 自己校验 |
| 并发扇出 | workflow 引擎 / subagent 并行 | 串行（成本/时长如实告知）|
| 文件 IO | 子代理自带 bash/fs 工具 | 子代理由宿主文件能力；没有就你（元层）代读写 |
| ledger/git | 插件自动 / 元层手动 | 元层手动（SKILL.md 第 6 步）|

原则：**协议不变，载体可换**。SKILL.md 描述的就是"动作"，任何 harness 用
自己的工具把动作做出来即可。