# design — evo-engineering 架构决策记录

本文档是技能仓库的第三受众（skill 开发者）阅读的技术说明：架构、层间契约、
关键决策与理由、已知边界与路线。不重复 README 的使用说明。

## 1. 一句话定位

**evo-engineering 把 RSI（递归自我改进）做成一个使用动词**：用户对任意产物说
「进化它」，元层（会话+人）确定标准，任务层（actor/critic 子代理）在确定性
协议下反复产生/评估/采纳改进，防退化三件套保证单调与可回溯。

## 2. 三层结构（分层即产品）

| 层 | 文件 | 受众 | 核心契约 |
|---|---|---|---|
| L0 skill（便携手册） | `skills/evo/` | 任何 harness 的 agent | SKILL.md 是"动作手册"：工作区布局 + 六阶段回合协议 + 防退化 + 递归门禁；不绑定 dsh |
| L1 workflow（确定性引擎） | `workflow/evo-round.mjs` | dsh 会话/插件 | SCRIPT（引擎脚本体）+ ROUND_META + ROUND_ARGS_DOC；propose→act→critique→select→regress 全在 engine 内，select 是纯函数聚合 |
| L2 plugin（UX） | `src/` + `cordis.patch.yml` | dsh 用户 | `/evo` 命令 + evo_init/evo_round/evo_status/evo_rollback 工具；Node 侧做 ledger 追加 + git checkpoint |

**分层原则**：协议不依赖载体。其他 harness 的用户只加载 L0 就能跑；
dsh 用户按 L0→L1→L2 递进获得确定性、并发、UX。同一份 SCRIPT 同时在
L1（直喂 workflow 工具）与 L2（插件内嵌）使用——单源。

## 3. 回合协议（六阶段）与关键决策

阶段：Propose → Act → Critique → Select → Regression → Commit。（编排图见
`skills/evo/SKILL.md`。）

关键设计决策（D=决策，含理由与备选）：

- **D1 select 是确定性纯函数聚合，不信任模型自由文本**。理由：进化循环里
  "谁赢"用语言判断会漂移；数字+阈值+一票否决可复现。备选（拒绝）：让 meta
  对候选做自由文本裁决——省成本但不可复现，且给"作弊窗口"。
  schema 输出：`agent(prompt, {schema})` 引擎侧校验。
- **D2 actor/critic 上下文隔离（知识泄漏防护）**。actor 只见自己的 proposal +
  标准 + baseline；critic 只见一个候选 + 标准 + baseline；proposer 只见
  公共上下文。理由：元层不参与 actor 任务（用户笔记里的原话），防止
  "进化"退化成"抄最好的答案"。
- **D3 冠军地板（champion floor）**：`score >= threshold(7) && rejects==0 &&
  score > championScore`。严格大于，宁缺毋滥；reject 一票否决。
- **D4 模糊标准走语言理解 + 分歧升级**：critic 必须给证据行；入选者
  spread≥3 → needsHuman 升级到元层对话，人裁定后写回标准。这是"标准被
  进化的机制"（L2），也是用户笔记里 skill 实验的机制化。
- **D5 每圈 git checkpoint（tag evo/round-N）+ ledger 追加**：可回溯地基。
  ledger 是追加型（不篡改历史），git 提供回滚。
- **D6 预算控制**：maxAgents 默认 18，超出先砍 critic；收敛判据（连续无胜者/
  分数停滞/预算尽）——防"进化停不下来"。

## 4. 插件实现要点（抄自生态先例）

- **workflows 服务惰性读取**（`ctx.get('workflows')`，不静态 inject）：静态
  inject 在无 workflows 的组合里会让 entry 永久 pending 并拖垮 profile 启动
  （dsh-inspect 的教训，注释里写了完整链路）。
- 命令 handler 支持 async（`CommandResult | Promise<CommandResult>`），
  `/evo round` 走完整 workflow + ledger + tag。
- 插件是 **plain ESM JS、零构建**（`main: ./src/index.mjs`）——对照组是
  dsh-inspect 的 native TS + tsx hook；JS 免去 tsconfig project references
  的 sibling 路径依赖，`node --check` 即可验证。
- 工具输出统一 `{ok, text}` schema + render 纯文本；报告含"next"提示，
  引导元层下一步（符合"汇报→问用户"纪律）。

## 5. 递归阶梯（RSI 的"递归"）

改进对象逐层上移，每层独立门禁：
L1 产物（冠军地板+回归）→ L2 标准（**人类签收**，防作弊）→ L3 协议（冻结
基准 A/B + 双人评审）→ L4 能力（默认关，平台可逆热挂载才开；dsh 生态参照
dsh-evolve / dsh-memory-evolve）。详见 `skills/evo/references/rsi-ladder.md`。

## 6. 已知边界与路线（v0.1 不含，后续选项）

- **UI 面板**：当前只有命令/工具文本输出；未来可做「进化页签」（类 dsh-autofork
  分叉树：回合节点 + verdict 可点开 + 一键回滚）。
- **回归探针积累自动化**：目前靠人维护 evals/regression.md 与传参；未来可把
  每圈 champion 的关键行为自动固化成探针。
- **持续运行**：接 dsh-loop 的定时语义（`/evo watch` 每 N 分钟跑一圈，
  直到收敛）。
- **criteria 起草半自动**：evo_init 目前给 placeholder + 提示词；未来可用
  一个"标准起草"子代理产出初稿再给人改。
- **多目标/黑盒基准对接**：harbor 等 0–1 自动判分器可直接充当 critic
  （量化优先，规则 1 的极限形态）。

## 7. 验证

- `test/`：ledger 纯函数单测、SCRIPT vm 编译 + 协议片段断言、mock 引擎
  全流程跑（select 逻辑/冠军地板/reject 一票否决/回归失败路径）、
  全部 `node --check`。`node --test` 零依赖全绿。
- 真实引擎验证（examples/blog-draft，AI 味博客草稿，模糊标准×4 条）：
  - **Round 1**（真实 propose×2/act×2/critique×4/regress×2 子代理）：
    candidate-1 以 8.8 当选（> champion 0），critic 用 grep 验证禁词零命中、
    量化句长极差 9.5 倍（baseline 3.9 倍），两条回归探针 PASS；
    critic 对"第一人称 vs 群体口吻"的视角回归提出 concern → 自动
    needsHuman（人可介入），照常记账打点。
  - **Round 2**（meta 显式提议修复 critic 指出的叙事自洽瑕疵）：候选 8.5，
    高于阈值、无 reject，但 **8.5 < 冠军地板 8.8 → 拒绝采纳，champion 不变**——
    防退化按设计生效。
  - 全过程存档于 `examples/blog-draft.evo-workspace/`（ledger + runs/
    candidate-*/verdict-*.json + git tag evo/round-1/2，逐步可回滚）。
- 插件完整的 profile 安装验证（`dsh plugin --profile web add .` + 隔离
  DSH_HOME）留待验证站；引擎级路径已通过上述 workflow 工具验证（与
  插件内嵌路径同一条 ctx.workflows.start 链路）。