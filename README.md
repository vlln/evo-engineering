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
# 或本地：cd evo-engineering && dsh plugin --profile web add .
```

装完**重启 web**（bundle 走层栈）。插件运行在官方 workflow 引擎上
（`@deepseek-ai/dsh-workflow`，官方基础组合自带）；缺该服务的组合里插件照常
启动，工具调用时报清晰错误。

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

## 示例

`examples/blog-draft/` 是一篇 AI 味爆棚的博客草稿 + 人起草的模糊标准
（去 AI 味/像真人/有观点）；真实进化运行结果在
`examples/blog-draft.evo-workspace/`（含每圈候选与 verdict，逐步可回滚）。

## 仓库结构

```
evo-engineering/
├── skills/evo/            # L0：便携手册（SKILL.md + references/ + assets/）
├── workflow/              # L1：evo-round 引擎脚本（同一份被插件内嵌使用）
├── src/                   # L2：插件（index.mjs = cordis 入口；evo.mjs + ledger.mjs = 纯 Node 逻辑）
├── test/                  # node --test：语法/协议/ledger/mock 全流程
├── docs/design.md         # 第三受众：架构决策记录
└── examples/              # 演示目标 + 真实进化工作区
```

开发与测试：`node --test`（零依赖）、`npm run check`（全部 `node --check`）。

## 状态与路线

v0.1 已闭环：init→round→status→rollback 可用，示例跑过真实引擎回合。
路线见 `docs/design.md` §6（UI 进化页签、探针自动积累、/evo watch 持续圈、
harbor 基准对接）。

## License

MIT