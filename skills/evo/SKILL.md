---
name: evo
description: >
  进化工程（RSI 作动词）：当用户要「进化/改进/优化/迭代某个产物」——文档、代码、README、
  skill、提示词、工作流脚本——或提到 RSI、自进化、self-improvement、「让 X 变得更好」时使用。
  本技能给你一套任何 harness 都能跑的双层进化循环（元层=你+用户，任务层=actor/critic 子代理）：
  定标准 → 跑圈（propose/act/critique/select/regress）→ 防退化（冠军地板/回归账本/每圈提交）
  → 递归升级（产物→标准→协议→能力）。在 dsh 上优先用 evo-round workflow 脚本与 /evo 插件
  （见 references/dsh-native.md）；其他 harness 按本文档的子代理协议直接执行。
when-to-use: >
  用户说「把这个/它进化一下」「让 README 更有人味」「优化我的 skill」「自进化这个插件」
  「RSI 一下」等；或者任务本质是「对已有产物做多轮、可回溯、带评估的持续改进」，
  而不是一次性改写。一次性改写/单轮优化不需要本技能。
license: MIT
metadata:
  author: vlln
  version: "0.1.0"
---

# evo — 进化工程：把 RSI 当作一个使用动词

## 心智模型（先读这个）

**RSI（递归自我改进）不必是研究课题。把它当一个动词用**：用户对任意产物说
「进化它」，你就启动一个**双层循环**：

```
元层（你 + 用户，对话式、可参与）     ← 定标准 / 看结果 / 介入修改
  │  每个回合：
  │    propose → act → critique → select → regress → commit
  ▼
任务层（子代理，独立上下文）
  ├── actor ×N    各自实现一个改进提议（互相隔离）
  └── critic ×M   各自独立评审候选（互相隔离）
```

- **元层 = 你正在执行的这次对话**。默认就是有人参与的（像 Claude Code 一样可以随时
  插话、设标准、否决）。完全无人值守的自监督模式是特例，不是默认。
- **任务层 = 子代理**（subagent / fork 之类能力）。actor 干活，critic 打分——他们
  看到什么、怎么判断，都写死在提示词里，不依赖你逐步解释。
- 两者的优化目标不同：任务层优化「候选更好」，元层优化「整个系统（标准+协议+产物）
  更好」——这就是"递归"。

一句话协议：**对一个产物 X：先定「怎样算更好」→ 然后反复跑「提几个改进方案 →
  隔离实现 → 独立评审 → 按冠军地板选优 → 重跑回归 → 记账+打点」→ 直到收敛或人说停。**

> 在 dsh 上，用 `references/dsh-native.md` 的 `/evo` 命令 / `evo_*` 工具 /
> `evo-round` workflow 脚本直接跑这个协议。其他 harness：本文档就是完整手册。

## 快速开始（3 分钟内跑第一圈）

1. **建工作区**（见下节布局）。把目标快照进 `baseline/`，`git init` 打底。
2. **与用户对标准**：写出 `evals/criteria.md`（2–5 条，尽量可判）+ 可选的
   `evals/regression.md`（上一任冠军必须保持的行为）。**标准没确认前不要跑圈。**
3. **跑第一圈**：提议 → 实现 → 评审 → 按结果更新 champion → 记账 + git tag。
4. **汇报 + 问下一步**：给用户短报告（各候选分数、入选者、需要不需要人看），
   问「继续下一圈 / 调整标准 / 停」。

## Evo Workspace（先建它，路径可回溯的地基）

```
<workspace>/                 # 独立目录（建议独立 git 仓库）
├── baseline/                # 进化对象快照 —— 只读！绝不修改（防越描越黑）
├── evals/
│   ├── criteria.md          # 标准：「怎样算更好」（元层+用户共同写）
│   └── regression.md        # 回归探针：上一任冠军必须保持的行为
├── runs/<round>/candidate-<i>/
│   ├── <改动后的文件>
│   ├── CHANGELOG.md         # 改了什么、为什么、对哪条标准
│   └── verdict-*.json       # critic 判分明细（评审落盘）
├── ledger.md                # 决策记录：每圈一节（分数、入选者、需不需要人）
└── (.git + tag evo/round-N) # 每圈一个 checkpoint
```

**champion（冠军）** = ledger 里最近一个入选且未被回归挡下的候选。新候选必须
严格高于 champion 的分数才可能当选（冠军地板）。

初始化步骤（任何 harness 都能做，用你的文件工具即可）：
1. mkdir + 把目标复制进 `baseline/`（目录整树复制；文件则带名复制）。
2. 生成空 `evals/criteria.md`（占位：`## 标准` + 一条 `- （placeholder）`）、
   `evals/regression.md`、`ledger.md`（模板在 `$_S/assets/ledger-template.md`）。
3. `git init && git add -A && git commit -m "evo: init"`（git 不可用就跳过，
   ledger 仍是事实源——但**回滚能力会缺失**，如实告知用户）。
4. 回话里明确下一步：**和用户对标准**。标准示例与写法见 `references/critic-and-fuzzy.md`。

## 回合协议（核心，逐阶段有检查点）

每阶段结束都要核对「检查点」，不通过就不进下一阶段（Pipeline 纪律）。

### Stage 1 — Propose（提议）
产出 2–3 个**互不可见**的具体改进提议。
- 先瞄一眼用户是否已给方向/约束（给了就用用户方向，别空想）。
- 方式 A（默认，成本低）：你自己（元层）读 baseline + 标准 + ledger + 最近候选，
  直接写 2–3 条提议，每条一条话：改什么、为什么、可能的风险。
- 方式 B（更像"进化"）：派 2 个 `subagent`（**无种子上下文**）当 proposer，各读
  baseline/标准/ledger 后输出一条提议（JSON：title/change/rationale/expectedCriteria/risk）。
- **检查点**：提议 ≥1 条；每条都窄（一个可验证的改动，不是重构大礼包）；
  没有一条是"改标准"（那是 L2 门禁）。

### Stage 2 — Act（隔离实现）
每个提议一个 actor `subagent`（独立上下文）。提示词要素：
- 读标准；读 baseline（**只读**）；读**自己的**提议；**不读、不碰任何其他候选**。
- 把 baseline 的目标文件复制进 `runs/<round>/candidate-<i>/` 再改，
  写 `CHANGELOG.md`（改了什么/为什么/对哪条标准）。
- 返回 `{candidateDir, done, note}`。
- **检查点**：每个期望候选目录都存在、内容自洽、CHANGELOG 写了；
  baseline/ 与别的候选目录未被触碰（抽查为证）。

### Stage 3 — Critique（独立评审）
每个候选配 2–3 个独立 critic `subagent`（互不可见）。提示词要素：
- 读标准、baseline（对照）、**这一个**候选（含 CHANGELOG）。
- 输出 verdict（按 `references/critic-and-fuzzy.md` 的 schema）：总体分 0–10、
  verdict（accept/revise/reject）、优势/弱点/风险/回归担忧 数组、逐条标准打分。
- **尽量把 verdict JSON 落盘**到 `runs/<round>/candidate-<i>/verdict-<k>.json`（审计背书）。
- **检查点**：每个候选 ≥2 份 verdict；分数是数字；分歧大（见 Stage 4）要走升级路径。

### Stage 4 — Select（确定性选优，冠军地板）
不用模型自由文本结论，只用数字聚合：
1. 每候选平均分；`reject` 数、`accept` 数、分数极差（spread）。
2. 入选条件（全部满足）：平均分 ≥ threshold（默认 7）且 `reject == 0`
   且 平均分 **严格 > champion 分数**。
3. 无入选 → 本圈无人当选，champion 不变（诚实报告，别硬选）。
4. `needsHuman` 触发：入选者 spread ≥ 3，或 accept/revise 混杂且 spread ≥ 2，
   或 critica 报了回归担忧 → **停下来给人看**。分歧 ≠ 失败，是"标准不清晰"的信号。

### Stage 5 — Regress（回归）
若入选且存在 `evals/regression.md` 探针：对胜者重跑每条探针（可交给 1 个
"回归检查"子代理，逐条给 `{probe, passed, evidence}`）。
- **任一失败** → 标记 regressionFailed：**不采纳**，升级给人复核（"修好 B 弄坏 A"）。
- **检查点**：回归结果落盘（报告里带 PASS/FAIL 表格）。

### Stage 6 — Commit（记账 + 打点）
- ledger 追加一节（模板见 `$_S/assets/ledger-template.md`）：回合号、提议数、
  各候选分数、入选者、needsHuman 原因。needsHuman 的回合也记（记录事实，供回溯）。
- `git add -A -- <工作区相对路径>` → `git commit -m "evo: round N" --only -- <工作区相对路径>` → `git tag <tag>`。
  **路径必须限定到本工作区**：工作区嵌在宿主仓库里时，裸 `git add -A` 会把宿主的无关改动
  （乃至别人的整个未跟踪工作树）扫进这一条提交——真实事故里一次提交扫进 1,105 个文件，
  其中仅 18% 属于本工作区。tag 命名与回滚的完整规则见 `references/anti-degradation.md` §3。
- **检查点**：ledger 可读；`git tag` 列表含本圈（或明确告知 git 不可用）。

一轮到此结束。**汇报 → 问用户下一步**（下一圈 / 调标准 / 停）。别自己一直跑。

## 判分与模糊标准（三条规则）

| 规则 | 内容 |
|---|---|
| 1. 量化为先 | 标准能写成「可观察表现」就写成那样：「句子长短混合、无’首先/其次/最后’套话」优于「更自然」。 |
| 2. 模糊也合法 | 真没法量化的（「更有灵气」「少 AI 味」），critic 用语言理解判分，但**必须给证据行**（引用候选里的具体句子）。 |
| 3. 分歧升级 | critic 分数差 ≥3 → 回元层对话请用户裁定；裁定结果**写回标准**（把模糊转成规则 1 的形态）。标准就是这样被进化出来的。 |

## 防退化（三条硬规则）

1. **冠军地板**：新入选者分数必须 > 上一任 champion；`reject` 一票否决。记住——
   分数是代理指标，所以还要规则 2。
2. **回归账本**：`evals/regression.md` 记录必须保持的行为，每圈对胜者重跑。
   分数升但回归挂 = 出了"看起来更好、实际弄坏旧功能"的退化——必须人复核。
3. **每圈打点**：git tag（工作区即仓库根 → `evo/round-N`；嵌套 → `evo/<工作区名>/round-N`），
   随时回滚。**嵌套工作区不许用 `git reset --hard`**（会丢掉宿主仓库的全部未提交改动），
   改用 `git checkout <tag> -- <工作区相对路径>`。没有 git 就没有回滚，告知用户并建议先解决。
完整机制、边界与预算见 `references/anti-degradation.md`。

## 人类门禁（默认辅助式，不是全自动）

- **默认形态就是你在对话里带着人跑**：跑前对标准、每圈后汇报、分歧升级请人裁定。
- 需要人签收才能动的东西：**改标准**（防 agent 改标准作弊）、**改协议**、
  **改自己的能力**。见 `references/rsi-ladder.md` 的递归阶梯门禁表。

## 递归阶梯（RSI 的"递归"在哪）

| 层 | 改进对象 | 谁批准 |
|---|---|---|
| L1 | 产物（baseline 里的东西） | 冠军地板 + 回归 |
| L2 | 标准（evals/criteria.md） | **人类签收**（防作弊） |
| L3 | 协议（本手册/脚本本身） | 冻结基准 A/B + 双人评审 |
| L4 | agent 自己的能力（工具/技能） | 默认关；只在平台支持可逆热挂载时开 |

每层都是上一层的"产物"之一——这就是递归。普通用户日常到 L1 就够；
L2 偶尔；L3/L4 是工程行为。细节见 `references/rsi-ladder.md`。

## 在 dsh 上跑（有插件就优先插件）

| 你想要的 | dsh 上的做法 |
|---|---|
| 建工作区 | `/evo init <target>` 或 `evo_init` 工具 |
| 跑一回合 | `/evo round` 或 `evo_round` 工具（自动记账+打点） |
| 看状态 | `/evo status` 或 `evo_status` |
| 回滚 | `/evo rollback [n]` 或 `evo_rollback` |
| 自定义参数（提议/人数/阈值） | `evo_round` 工具的参数；或把 `evo-round` workflow 脚本直接喂给官方 workflow 工具 |

其他 harness / 无插件：按本文档手工跑（子代理 + 文件工具 + git 就是全部所需）。
映射与 args 全表见 `references/dsh-native.md`。

## 停止与预算（什么时候收手）

- 连续 2–3 圈无入选者，或胜者分数停滞（Δ < 0.3）→ 大概率到局部平台了：**停**，
  报告并建议改标准（L2）或换方向。
- 每圈 agent 预算默认 ≤ 18（P×C 是主开销）；预算用尽就停。
- 用户叫停 / 目标已达成 → 立刻停。
- 收手时给一页总结：champion 在哪、每圈得分曲线、ledger 位置、回滚方式。

## Gotchas（反直觉的坑，踩过就记下）

- **actor 隔离是铁律**：actor 读了别的候选 = 该候选作废重来（知识泄漏会让"进化"
  退化成"抄答案"）。提醒词里写死，事后抽查。
- **别让 proposer/actor 提议改标准**：标准是 L2，agent 没资格动。发现即拒。
- **分数会骗人**：冠军地板挡住"变差"，但"分数升、回归挂"才是真正的退化形态——
  所以回归账本必须存在，哪怕只有一条事实核对探针。
- **模糊标准分歧大是信号不是失败**：critics 打架 = 标准不清晰，恰好是升级给人、
  顺带细化标准的时机。
- **别对"活产物"直接进化**：正在被编辑/被进程占用的东西先快照进 baseline 再说；
  快照是只读的，反复跑圈才不会越描越黑。
- **没有 git 的进化是裸奔**：ledger 只能证明发生了什么，回滚只能靠 git。
- **成本意识**：P×C 子代理是主要开销；默认小圈（2×2），被挑战的领域再加大。
- **能力层（L4）别在看不见热挂载的平台开**：给自己加工具/技能要能可逆、可查、
  重启可恢复。dsh 的 cordis 热重载可以；裸 CLI 环境默认关。

## 收尾检查清单（每圈结束核对）

- [ ] ledger 追加了本圈记录（含分数/入选者/needsHuman 原因）
- [ ] git tag 存在（工作区即仓库根 → `evo/round-N`；嵌套 → `evo/<工作区名>/round-N`），
      或明确说明 git 不可用
- [ ] checkpoint 提交**只包含本工作区**（`git show --name-only HEAD` 不含宿主仓库的无关路径）
- [ ] 每个候选目录有 CHANGELOG.md；critic 尽量落了 verdict-*.json
- [ ] baseline/ 未被改动（抽查）
- [ ] 标准未被 agent 私改（diff 一下 evals/）
- [ ] 向用户汇报了：结果 + 下一步选项（下一圈 / 调标准 / 停）

## 参考文件（需要时再读）

- `$_S/references/critic-and-fuzzy.md` — verdict JSON schema 全文、聚合规则、模糊→可观察分解示例
- `$_S/references/anti-degradation.md` — 冠军地板/回归账本/checkpoint/预算的完整机制与边界
- `$_S/references/rsi-ladder.md` — L1–L4 递归阶梯、门禁、dsh 能力层对接
- `$_S/references/workspace-layout.md` — 目录/命名/ledger 行格式的规范
- `$_S/references/dsh-native.md` — dsh 三种跑法 + args 全表 + 其他 harness fallback
- `$_S/assets/ledger-template.md` — ledger 小节模板