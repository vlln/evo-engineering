<h1 align="center">evo-engineering</h1>

<p align="center">
让 agent 把任意产物——文档、代码、skill、提示词——一轮轮改得更好：先定「怎样算更好」，
再自动跑「改进 → 独立评审 → 按冠军线选优」，而人随时能看、能喊停、能回滚。<br/>
（DeepSeek Harness 插件；同时含一份跨 harness 的 evo skill）
</p>

<p align="center">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
  <img src="https://badgen.net/badge/format/dsh%20bundle/blue" alt="format">
</p>

## 这是什么

把「自进化 / 递归自我改进（RSI）」当成一个**动词**用：对某个产物说「进化它」，剩下的交给一个固定回合协议——

```
元层（你 + 当前会话）：定标准 → 看结果 → 随时介入
任务层（子代理）：propose → act（隔离实现）→ critique（独立评审）→ select（冠军线）→ regress → commit
```

三层一起交付，**协议不绑死在某一个 harness 上**：

| 层 | 形态 | 谁能用 |
|---|---|---|
| 便携手册 | `skills/evo/`（SKILL.md + references） | 任何 agent harness——复制进你的 skill 目录，agent 按手册用你自己的子代理/文件/git 跑协议 |
| 确定性引擎 | `workflow/evo-round.mjs` | 任何带官方 workflow 引擎的 dsh 会话（把脚本喂给 `workflow` 工具） |
| 插件 | `/evo` 命令 + `evo_init` / `evo_round` / `evo_status` / `evo_rollback` | dsh 用户（自动记账、每圈 git 打点、可回滚） |

## 为什么需要它

**你现在的做法大概是这样**：让 agent 改一版，读一遍，觉得"好像好点了"，再让它改一版……
到第 5 轮时你已经说不清哪版最好、为什么好，也退不回第 3 版；换个会话重来，结论还会变。
如果有两个人（或两个模型）各改一版，你只能凭印象挑。

这个插件把这几件事交给流程：**标准写成文件**（`evals/criteria.md`）、**候选各自隔离实现**
（actor 互不可见，避免抄答案）、**独立评审打分**（critic 互不可见、必须给证据）、**按冠军线选优**
（新版本必须严格超过上一任冠军才被采纳）、**每圈一个 git 检查点**（随时回滚）。

**它不解决什么**：

- 标准模糊到语言也判不了时，仍然要人裁定——critic 分歧时会主动停下来问你（这是设计，不是故障）。
- 分数只是代理指标：所以还有"回归账本"（每圈重跑上一任冠军必须保持的行为），挡住"分涨了但把旧东西弄坏"。
- 它不替你决定"什么值得进化"，也不保证一定变得更好——**变化不够大时它会选择不改**。

**与相邻方案的区别**：

| 方案 | 谁发起 | 你要做什么 |
|---|---|---|
| 手工反复让 agent 改 | 你，每一轮 | 每轮自己判断好坏、自己记着哪版最好 |
| [dsh-loop](https://github.com/vlln/dsh-loop)（定时循环） | 你设定间隔，模型自调节 | 决定"多久跑一次"；循环本身不评估产物好坏 |
| [dsh-inspect](https://github.com/dsh-external/dsh-inspect)（检查→修复→复查） | 你要求检查/修复 | 一次闭环：找问题、修、复查；不做多轮选优与历史冠军线 |
| **evo-engineering** | 你说「进化它」 | 定一次标准，然后每圈看结果、必要时介入 |

## 安装

**1) dsh 插件**：

```sh
dsh plugin --profile web add "github:vlln/evo-engineering#main"
# 本地目录：cd evo-engineering && dsh plugin --profile web add .
# 卸载：   dsh plugin --profile web remove @vlln/evo-engineering
```

装完**重启 web**（bundle 在启动时组层栈）。仓库是零构建的（入口直接是 `src/index.mjs`），
git 源安装不触发构建。

插件跑在官方 workflow 引擎上（服务名 `workflowEngine`，官方基础组合自带）。本插件**不**静态
依赖它：缺该服务的组合里插件照常启动，只有调用工具时才报一条可操作的错误，而不是拖垮整个
profile 启动。

**2) evo skill（可选，跨 harness 都能用）**：SKILL.md 是通用规范，落位方式是放进 skill 发现路径。

```sh
# 让当前 DSH_HOME 认得它（用户级）
mkdir -p "$DSH_HOME/skills"
ln -s "$DSH_HOME/profiles/web/node_modules/@vlln/evo-engineering/skills/evo" "$DSH_HOME/skills/evo"

# 或只在某个项目里生效（项目级，二选一）
ln -s "$PWD/skills/evo" <你的项目>/.agents/skills/evo
```

（发现路径：项目 `<项目>/.dsh/skills`、`<项目>/.agents/skills`；用户 `$DSH_HOME/skills`、
`~/.agents/skills`。其他 harness 用自己的等价目录即可。）

## 用起来是什么样

```sh
/evo init README.md        # 建工作区：目标快照进 baseline/，生成标准与回归探针占位
#   然后和用户对标准（这是唯一必须由人做的事）：编辑 <workspace>/evals/criteria.md
/evo round                 # 跑一回合：提 2 案 → 隔离实现 → 每案 2 个独立评审 → 选优 → 回归 → 记账+打点
/evo status                # 回合数 / 当前 champion / 最近一轮
/evo round "把开头换成个人经历"   # 由你（元层）指定提议，跳过 brainstorm
/evo rollback              # 不满意？回滚到最近检查点
```

一回合结束后你会拿到这样的报告（真实运行输出，节选）：

```
## outcomes (sorted by mean score)
- runs/1/candidate-1  score 8.8  [1 verdicts, 1 accept / 0 reject]
- runs/1/candidate-2  score 6.3  [2 verdicts, 0 accept / 0 reject]

## selection
- selected: runs/1/candidate-1  score 8.8 (> champion 0)
- needsHuman: true (4 regression concern(s) from critics)

## regression probes
- [PASS] fact-check — 逐条核对 baseline 的事实主张，无相反陈述
- [PASS] smoke — 候选目录内 README.md 与 CHANGELOG.md 存在且非空
```

下一回合如果挑战者只拿到 8.5（高于阈值、无 reject，但没超过冠军 8.8），它会**拒绝采纳**、
champion 不变——这就是"宁可不动"的那一帧。评审的判分与理由落在
`runs/<round>/candidate-*/verdict-*.json`，每圈记在 `ledger.md`，git tag 可回滚。

## 能力面

**命令**

| 命令 | 说明 |
|---|---|
| `/evo init <target> [workspace]` | 建工作区：快照目标到 `baseline/`、生成 `evals/` 与 `ledger.md`、`git init` |
| `/evo round [数量 \| "提议文本"]` | 跑一回合；带引号的文本 = 由你指定的提议 |
| `/evo status` | 回合数 / 当前 champion / 最近一轮 |
| `/evo rollback [round]` | 回滚到检查点（缺省最近一圈） |
| `/evo help` | 用法 |

**工具**

| 工具 | 说明 |
|---|---|
| `evo_init` | 建工作区（可指定 workspace、overwrite、标准起草提示） |
| `evo_round` | 跑一回合，参数见下；跑完自动写 ledger + 打 git 检查点 |
| `evo_status` | 读 ledger，报告冠军与回合历史 |
| `evo_rollback` | 恢复工作区到某圈（只恢复工作区子树，不动宿主仓库其余部分） |

**Skills**

| Skill | 作用 |
|---|---|
| [`evo`](skills/evo/SKILL.md) | 跨 harness 的进化协议手册：工作区布局、六阶段回合协议、critic 判分与模糊标准、防退化三件套、递归阶梯（L1 产物 → L2 标准 → L3 协议 → L4 能力）与各层人类门禁 |

## 参数

`evo_round` 的常用参数（完整表见 `workflow/evo-round.mjs` 的 `ROUND_ARGS_DOC`）：

| 参数 | 默认 | 作用 |
|---|---|---|
| `proposals` | 无 | 由你指定改进提议（给了就不自动 brainstorm） |
| `own_proposals` | 2 | 自动提议的子代理数（每个独立上下文） |
| `actors` | 2 | 并行实现的子代理数（actor 之间互相隔离） |
| `critics` | 2 | 每个候选的独立评审数（判分与证据落盘） |
| `threshold` | 7 | 入选所需的最低均分（0–10） |
| `note` | 无 | 本回合备注，写进 ledger |

工作区里由你维护的两个文件：`evals/criteria.md`（**怎样算更好**——每条尽量写成可观察的表现）、
`evals/regression.md`（**上一任冠军必须保持的行为**——每圈重跑，任一失败即不采纳）。

## 已知限制

- **需要 profile 提供 workflow 引擎**（官方基础组合自带）；没有它时工具会明确报错。
- **actor 的工作目录未受限**：子代理按自身 cwd 解析路径，当前靠"回合后把产物吸收进 `runs/N/`"
  补救——根治需要 DSH 侧支持 per-agent cwd。
- **分数差小的时候别当真**：引擎不知道评估噪声有多大，几十分之一的差可能只是抖动；
  噪声与真实差异同量级时，演化会退化成随机游走**且看起来完全正常**（见
  [`docs/known-issues.md`](docs/known-issues.md) §3）。
- **模糊标准下 `needsHuman` 会经常出现**：critic 分歧即升级给人，这是刻意的代价交换。
- **成本 = 每圈 P×C 个子代理**：默认 2×2；预算参数有上限，但请按目标规模调整。
- **只作用于指定工作区内的产物**：不扫描、不修改工作区之外的文件。

## 插件管理

已装插件用 plugin-registry 的**薄控制台**管理（浏览器面板）：管理 profile 插件安装态
（bundle 层栈 + insert 行 + 启停），无需手改配置。安装：
`dsh plugin --profile web add <plugin-registry>/packages/plugin/console`

## 许可

MIT

---

工程备忘（真实运行验证证据、六个下线 bug 的复盘与最小复现、架构取舍、测试与门禁）：
[`docs/engineering-notes.md`](docs/engineering-notes.md) ·
[`docs/design.md`](docs/design.md) ·
[`docs/known-issues.md`](docs/known-issues.md) ·
[`CHANGELOG.md`](CHANGELOG.md)
