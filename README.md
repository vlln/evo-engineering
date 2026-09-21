# evo-engineering — 把 RSI 当作一个使用动词

**进化工程（Evolution Engineering）**：让「自进化 / 递归自我改进（RSI）」不再是一个
研究课题，而是一个普通用户能用的**动词**——对任意产物说「进化它」，一次性交付
标准、循环、防退化与回滚。

```
用户：进化一下这个 README（去掉 AI 味）
  ↓
元层（会话 + 人）：对标准 → 跑圈 → 看结果 → 随时介入
  ↓
任务层：propose → act（隔离实现）→ critique（独立评审）→ select（冠军地板）→ regress → commit
```

三层交付，同一套协议：

| 层 | 形态 | 谁能用 |
|---|---|---|
| **L0 skill**（便携手册） | `skills/evo/` 的 SKILL.md + 5 个 references | **任何** agent harness——加载 skill，agent 按手册用你自己的子代理/文件/git 跑协议 |
| **L1 workflow**（确定性引擎） | `workflow/evo-round.mjs` 的引擎脚本（schema 校验、并行扇出） | 任何带官方 `workflow` 工具的 dsh 会话 |
| **L2 plugin**（UX） | `/evo` 命令 + `evo_init/evo_round/evo_status/evo_rollback` 工具 | dsh 用户获得最完整体验（自动记账 + git 打点 + 回滚） |

## 安装

**dsh（推荐，最完整体验）**——bundle 插件，一行装：

```sh
dsh plugin --profile web add "github:vlln/evo-engineering#main"
# 或本地目录：cd evo-engineering && dsh plugin --profile web add .
# 卸载：dsh plugin --profile web remove @vlln/evo-engineering
```

包名 `@vlln/evo-engineering`。仓库是**零构建**的（入口直接是 `src/index.mjs`，
纯 ESM JS），所以 git 源安装不会触发构建步骤。装完**重启 web**（bundle 在启动
时组层栈）。

插件跑在官方 workflow 引擎上（服务名 `workflowEngine`，由官方基础组合提供——
本插件**不**静态 inject 它：缺该服务的组合里插件照常启动，只有工具被调用时才
报一条可操作的错误，而不是拖垮整个 profile 启动）。

**其他 harness / 只想用协议**——只装 skill：把 `skills/evo/` 目录放进你的
skills 目录（或 `skit install ./evo-engineering`）。SKILL.md 是完整手册，
不依赖 dsh 的任何 API。

## 用起来（dsh）

```sh
/evo init README.md                # 建工作区：快照→baseline，生成标准文件占位
#   打开 <workspace>/evals/criteria.md 和用户对标准（这是唯一必做的"人"事）
/evo round                         # 跑一回合：提2案→隔离实现→2评审→选优→记账+tag
/evo status                        # 回合数 / 当前 champion / 最近一轮
/evo round "把第一段换成个人经历开头"   # 元层显式提议（跳过 brainstorm）
/evo rollback                      # 不满意？回滚到最近 checkpoint
```

模型侧还有 `evo_init / evo_round / evo_status / evo_rollback` 四个完整参数的工具
（proposals / own_proposals / actors / critics / threshold），以及直接喂
`workflow` 工具的引擎脚本（`workflow/evo-round.mjs`，args 见文件内
`ROUND_ARGS_DOC`）。

## 它解决什么（设计要点）

- **RSI 去神秘化**：双层架构（元层=对话、任务层=actor/critic）就是全部；
  人类默认在场，不是全自动黑箱。
- **模糊标准合法**：去 AI 味这种写不成损失函数的标准，靠 critic 的语言理解 +
  证据行 + 分歧升级给人，照样能迭代。
- **防退化**：冠军地板（严格大于上届）+ 回归账本（每圈重跑探针）+ 每圈
  git checkout（可回滚）——"看起来变好、实际变坏"被挡在门外。
- **递归是阶梯不是玄学**：产物（L1）→ 标准（L2，人签收）→ 协议（L3，A/B）→
  能力（L4，默认关）。见 `skills/evo/references/rsi-ladder.md`。

## 示例（真跑过的证据）

`examples/blog-draft/` 是一篇 AI 味爆棚的博客草稿 + 人起草的 4 条**模糊标准**
（去 AI 味 / 像真人写的 / 有观点 / 保留原意）。

`examples/validation/` 是**真实引擎跑出来的两回合存档**（不是手写样例）：

- Round 1：胜出候选 **8.8 当选**——critic 的证据是量化的（grep 验证禁词零命中、
  句长极差从 baseline 3.9 倍拉到 9.5 倍），并主动报了视角回归担忧 → 回合被标
  `needsHuman`（人可介入）
- Round 2：挑战者 **8.5**，高于阈值且无 reject，但 **8.5 < 冠军 8.8 → 拒绝采纳**。
  这是"冠军地板"在真实运行中生效的样子——**分数进步不足时，系统宁可不动**

复现方式与逐帧说明见 `examples/validation/README.md`。

## 仓库结构

```
evo-engineering/
├── skills/evo/            # L0：便携手册（SKILL.md + references/ + assets/）
├── workflow/              # L1：evo-round 引擎脚本（同一份被插件内嵌使用）
├── src/                   # L2：插件（index.mjs = cordis 入口；evo.mjs + ledger.mjs = 纯 Node 逻辑）
├── test/                  # node --test：语法/协议/ledger/mock 全流程/git 范围
├── docs/design.md         # 架构决策记录（第三受众）
├── docs/known-issues.md   # 验证中发现的问题 + 最小复现 + 7 条快速自检
├── examples/              # 演示目标 + 真实进化回合存档
└── CHANGELOG.md
```

开发与测试：`node --test`（零依赖）、`npm run check`（全部 `node --check`）。

## 状态、已知问题与路线

- **可用状态**：init → round → status → rollback 全部闭环；引擎面与插件面均已
  在真实 profile 中验证过。
- **坦诚说明**：v0.1 出厂时插件面**从未在真实 profile 里启动过**，在一个实验
  仓库（44 批实验）上做端到端验证时暴露了 6 个 bug（4 个使插件完全不可用，
  含"启动即崩"与"冠军地板静默失效"；2 个会误伤宿主仓库的 git 提交）。全部已修
  并带回归测试（26 项）。详细清单、根因与最小复现见 `docs/known-issues.md`。
- **仍未修**：① actor 越界的"根"（现靠回合后吸收补救，根治需 DSH 侧 per-agent
  cwd）；② σ_fitness 未标定就允许启动循环——噪声与遗传差异同阶时演化会退化成
  随机游走**且看起来完全正常**（`docs/known-issues.md` §3）。
- **路线**：见 `docs/design.md` §6（UI 进化页签、探针自动积累、`/evo watch`
  持续圈、harbor 0–1 判分器当 critic）。

## License

MIT