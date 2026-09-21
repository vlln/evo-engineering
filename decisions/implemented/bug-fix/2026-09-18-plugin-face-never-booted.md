# Decision: 修复 L2 出厂即不可用的四个 bug，并立"插件面必须真启动"纪律

Status: implemented

## Problem

v0.1 的插件面（L2）**从未在真实 profile 里启动过**。首次端到端验证（一个 44 批实验的
真实仓库）暴露四个 bug，串成一条链，任何一个都能让机制静默失效：

1. 模块缺 `export const inject` —— `apply` 里静态访问 `ctx.tools`/`ctx.commands`，cordis 4
   对未声明服务的属性访问直接抛错 ⇒ **启动即崩**，整个 entry 组装载失败。
2. 引擎服务名写成 `workflows` —— DSH 0.1.2-rc.1 已改名 `workflowEngine` ⇒ **功能死**。
3. `ledger.mjs` 的解析正则只认相对路径 `runs/N/candidate-M`，而 ledger 实际写的是
   绝对路径 ⇒ `findChampion` 永远返回 null ⇒ 下一圈 `championScore: 0` ⇒ **冠军地板
   永不触发**（日志里完全看不出来：每圈都有分、有判决、有记录，只是从不参照前任冠军）。
4. actor 按**自己的 cwd** 解析相对路径 ⇒ 候选写到工作区之外、无法入账。

根因不是某一行写错，而是**验证面选错**：出厂时只有引擎面（L1）验证，而 mock ctx 不施加
cordis 的严格注入门禁——所以单测"注册成功"照不出 #1。

## Decision

逐条修复，且每条都要有一个**会失败的测试**钉住：

- #1/#2 由 `test/plugin-apply.test.mjs` 钉死（断言 `inject` 存在且含 `tools`/`commands`、
  不含 `workflowEngine`；断言缺引擎时的报错文案点明 `workflowEngine`）。
- #3 由 `test/ledger.test.mjs` 钉死（解析同时接受绝对与相对两种形态）；并新增"冠军打底"
  （下一圈的 act 起点是上一任冠军，否则每圈从 `baseline/` 重来、没有累积）。
- #4 双保险：提示词一律给绝对路径 + 引擎回传 `candidateAbs` + 插件侧把产物**吸收**进
  `runs/N/`。

纪律：**插件面的改动必须在真实 profile 里启动过**（装 → 挂载 → boot 无错 → 调一次工具）。
mock/单测只能证明"逻辑对"，不能证明"装得上、起得来"。

## Alternatives considered

**只在引擎面验证（出厂做法）。** 正是它漏掉了全部四个 bug——引擎面走的是
`workflowEngine.start` 直通路径，绕过了 `inject`、服务名解析、插件侧持久化。

**靠人工 code review 兜。** #3 的因果链在运行时日志里**没有任何异常**：有分数、有
selected、有 ledger 记录，只是冠军恒为 0。review 抓不到"机制静默失效"。

**只修不补测试。** 修一次不钉住，下一次重构会以同样的方式再坏一次——这类 bug 的特征就是
"看起来一切正常"。

## Consequences

沉淀为环境事实（0.1.2-rc.1，后续基线升级时**必须重新核实**）：

- cordis 4 严格注入：未在 `inject` 声明的服务，属性访问即抛错。
- 引擎服务名是 `workflowEngine`（历史上叫 `workflows`）；它**不**静态 inject，缺提供者时
  只在调用时报错，以免整个 entry 组永久 pending。
- 子代理的 cwd **不是**工作区：一切文件路径都必须绝对化或由引擎回传后吸收。
- 覆盖缺口（已知未修）：actor 越界的"根"要靠 DSH 侧 per-agent cwd 才能根治，当前是
  事后吸收；σ_fitness 未标定就允许启动循环时，演化可能退化成随机游走且看起来正常
  （见 `docs/known-issues.md` §3）。

## Testing

`node --test`（含上述钉死用例）；发布前额外跑一次真实 profile 安装冒烟。

## Related

- `docs/known-issues.md`（含每条的最小复现）
- `decisions/implemented/bug-fix/2026-09-18-git-scope-and-workspace-tags.md`（同一次验证发现的另两个 bug）
