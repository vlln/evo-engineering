# Decision: evo 的三层架构（skill + workflow 引擎 + dsh 插件）

Status: implemented

## Problem

把「递归自我改进（RSI）」做成普通人能用的东西，研究圈的默认做法（全自监督、损失驱动、
不可介入）不适用：真实用户要的是**看得见、能喊停、能回滚**的改进循环，而且标准往往是
模糊的（"去掉 AI 味"），写不成损失函数。同时生态里存在多种 agent harness——协议如果
绑死在某一个 harness 的插件机制上，就只对那一个 harness 的用户有意义。

## Decision

同一套协议分三层交付，**协议不依赖载体**：

| 层 | 载体 | 受众 | 依赖 |
|---|---|---|---|
| L0 便携手册 | `skills/evo/SKILL.md` + references | 任何 harness 的 agent | 无（只用子代理/文件/git 这类通用能力） |
| L1 确定性引擎 | `workflow/evo-round.mjs` 的引擎脚本 | 任何带官方 workflow 引擎的 dsh 会话 | 官方 workflow 引擎服务 |
| L2 UX 与持久化 | `src/`（`/evo` 命令 + 4 个工具） | dsh 用户 | L1 + profile 的 pnpm 闭包 |

回合协议固定为 propose → act → critique → select → regress → commit，并有三条不可让步的
性质：

1. **select 是确定性聚合**：只按 schema 校验过的数字（均分、reject 数、与冠军的差）决策，
   不信任模型的自由文本结论。
2. **actor/critic 上下文隔离**：actor 只见自己的提议，critic 只见一个候选；避免"进化"
   退化成"抄最好的答案"。
3. **防退化三件套**：冠军地板（严格大于上届）、回归账本（每圈重跑探针）、每圈 checkpoint
   （可回滚）。

L1 与 L2 共用同一份引擎脚本字符串（单源），避免两条路径漂移。

## Alternatives considered

**只做 dsh 插件。** 协议绑死在单一 harness 的插件 API 上；其他 harness 的用户拿不到任何
东西，而"标准可以由人定、循环可以由 agent 跑"这部分价值与 harness 无关。

**只做 skill（不加引擎）。** 全靠元层手工串子代理：select 退化成自由文本裁量（不可复现、
给作弊留窗口），并发与预算没有确定性上限，成本与结果都随会话状态漂移。

**让元层（会话）对候选做自由文本裁决。** 省一个 schema 层，但"谁赢"变成不可复现的判断；
同一组候选在不同会话里可能选出不同胜者，冠军地板也就失去意义。

## Consequences

- 协议改动要三处对齐（手册/引擎/插件）——用「改协议 = L3 动作」纪律约束（先改手册与
  design，再改引擎与插件，跑门禁 + 真跑一圈）。
- 插件面必须自己承担 ledger 与 git 持久化（引擎脚本按约束不做 IO）。
- 模糊标准下 critic 分歧会**经常**触发人介入（`needsHuman`）——这是刻意的代价交换：
  用一部分自动化换可控与可解释。
- 跨 harness 的完整性取决于 L0 手册是否真的只依赖通用能力；新增 harness 特有优化时
  必须回看这一条。

## Related

- `decisions/implemented/bug-fix/2026-09-18-plugin-face-never-booted.md`（三层里的 L2 曾整体不可用）
- `skills/evo/references/rsi-ladder.md`（递归阶梯与各层门禁）
