# AGENTS.local.md — evo-engineering 本机作业区上下文（不提交到上游）

本仓库是 **dsh-external 生态的本地作业区**里的独立 git 仓库（`~/Project/dsh-plugins/evo-engineering`），
实现「RSI 作动词」的多级进化工程框架。本文件是本仓库（第 3 层）的本地知识；
第 1 层（dsh 代码层）见 `~/GithubProjects/deepseek-harness/AGENTS.local.md`，
第 2 层（插件作业区导览）见 `~/Project/dsh-plugins/AGENTS.local.md`。

## 仓库地图

| 路径 | 是什么 | 作业类型 |
|---|---|---|
| `skills/evo/` | L0：便携 skill（SKILL.md 手册 + 5 references + assets） | 协议内容维护 |
| `workflow/evo-round.mjs` | L1：workflow 引擎脚本（SCRIPT 字符串导出，被插件内嵌） | 引擎维护（转义纪律，见文件头注释） |
| `src/` | L2：插件（index.mjs=cordis 入口 / evo.mjs=Node 操作 / ledger.mjs=纯函数） | 插件维护 |
| `test/` | node --test：语法/协议/ledger/mock 全流程 | 回归 |
| `docs/design.md` | 架构决策记录 | 每次改协议同步 |
| `examples/` | 演示目标 + 真实进化工作区（.evo-workspace 不入库） | demo |

## 纪律

- **SCRIpt 转义铁律**：`workflow/evo-round.mjs` 的 SCRIPT 会被引擎以
  `(async()=>{body})()` 包裹求值——body 内禁未转义 `${`、禁反引号、
  单引号字符串换行一律 `\\n`（join('\\n') 拼行）。改完必跑
  `node --test`（vm 编译测试会抓住语法错）。
- **协议改动 = L3 动作**：先更新 `skills/evo/SKILL.md` + references +
  `docs/design.md`，再改引擎/插件；跑 mock 测试 + examples 真跑一圈验证。
- **防退化自查**：champion 地板/回归探针/每圈 git tag 是产品承诺，改 select
  逻辑时不要破坏「严格大于 + reject 一票否决」。
- 作业区验证站从公开仓库 master 建（当前无常规站）；插件的完整 UX 验证
  需要 `dsh plugin --profile web add .` + 隔离 DSH_HOME + 随机端口，
  或直接在会话里把 SCRIPT 喂给官方 workflow 工具做引擎级验证。