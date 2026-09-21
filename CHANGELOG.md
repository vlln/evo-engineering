# Changelog

本项目遵循语义化版本；每一条都对应仓库里可复跑的证据（测试 / 存档 / 最小复现）。

## [0.1.0] — 首次公开发布

三层一体的「RSI 作动词」框架，首次发布即包含验证后修复（无历史包袱）：

- **L0 便携 skill** `skills/evo/`：SKILL.md 手册 + 5 篇 references + ledger 模板。
  任何 harness 可加载，不依赖 dsh API。
- **L1 引擎脚本** `workflow/evo-round.mjs`：propose → act → critique → select →
  regress 的确定性回合，schema 校验输出、actor/critic 上下文隔离、失败优雅降级。
- **L2 插件** `src/`：`/evo` 命令 + `evo_init/evo_round/evo_status/evo_rollback`
  四个工具；Node 侧做 ledger 追加 + git checkpoint，支持回滚。
- **验证存档** `examples/validation/`：真实引擎两回合（胜出 8.8 / 挑战者 8.5 被
  冠军地板拒绝）。
- **测试** 26 项（`node --test`，零依赖）：协议片段、vm 编译、ledger 纯函数、
  mock 引擎全流程、git 提交范围、插件注册与 inject 纪律。

### 发布前的验证修复（v0.1 出厂状态曾不可用，已全部修好并带回归测试）

在一个真实实验仓库（44 批实验 / 130+ 提交）上做端到端验证时发现 6 个 bug：

- **修复 · 启动即崩**：模块缺 `export const inject`，cordis 4 对未声明服务的属性
  访问直接抛错 ⇒ 整个 entry 装载失败。现声明 `['tools','commands']`。
- **修复 · 功能死**：引擎服务名在 DSH 0.1.2-rc.1 已由 `workflows` 改为
  `workflowEngine`。现按新名惰性读取（并保持不静态 inject 的纪律）。
- **修复 · 冠军地板静默失效**：ledger 解析只认相对路径、实际写的是绝对路径
  ⇒ 选不出前任冠军 ⇒ 每圈 `championScore` 恒 0。现已接受绝对路径，并新增
  「冠军打底」——否则每圈都从 `baseline/` 重来、没有累积。
- **修复 · 产物越界**：子代理按自身 cwd 解析相对路径，候选写到工作区之外。
  现双保险：提示词用绝对路径 + 引擎回传 `candidateAbs` + 插件侧吸收进 `runs/N/`。
- **修复 · 误伤宿主仓库（两处）**：`git add -A`/`commit` 无路径范围 ⇒ 一次
  checkpoint 曾扫进 1,105 文件 / 362,698 行（仅 18% 属于本工作区）；tag
  `evo/round-N` 是仓库全局的 ⇒ 多工作区互相覆盖（实测 9 圈只剩 5 个 tag），
  回滚用 `reset --hard` ⇒ 丢掉宿主未提交改动。现改为限定路径的
  `add -A --` / `commit --only --`、嵌套时分区 tag `evo/<工作区名>/round-N`、
  回滚改用 `checkout <tag> -- <rel>`。

未修（记录在 `docs/known-issues.md` §3）：actor 越界的"根"（需 DSH 侧 per-agent
cwd）；σ_fitness 未标定就允许启动演化循环。
