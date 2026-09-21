# engineering-notes — 工程备忘录（README 的溢出部分）

本文件写给**改这个插件的人**：验证证据、环境事实、门禁与本地试法。使用者该看的内容在
[README](../README.md)；用户会撞上的边界在 [known-issues](known-issues.md)；架构取舍在
[design](design.md) 与 [decisions/](../decisions/implemented/)。

## 仓库结构

```
evo-engineering/
├── skills/evo/            # L0：便携手册（SKILL.md + references/ + assets/）
├── workflow/              # L1：evo-round 引擎脚本（插件内嵌同一份，单源）
├── src/                   # L2：插件（index.mjs 入口；evo.mjs 工作区/git；ledger.mjs 纯函数）
├── scripts/gates/run.mjs  # 门禁程序（支持按改动面跑子集）
├── test/                  # node --test（零依赖）
├── docs/                  # design / known-issues / engineering-notes（本文件）
├── decisions/implemented/ # 决策记录（feature|bug-fix|simplification|architecture|process|testing）
├── examples/blog-draft/   # 演示目标（AI 味博客草稿 + 人起草的模糊标准）
└── examples/validation/   # 真实两回合的运行存档（ledger + 候选 + verdict）
```

## 本地试法

```sh
node --test                                   # 全部测试（零依赖；SDK 缺席时插件注册组自动跳过并说明原因）
node scripts/gates/run.mjs                    # 全部门禁
node scripts/gates/run.mjs md-links skills     # 按改动面跑最窄证据
node scripts/gates/run.mjs --list             # 列出可用门禁
```

**本仓库刻意没有任何依赖声明**（`dependencies` / `peerDependencies` / `devDependencies` 全空是设计）：
官方 `@deepseek-ai/*` 由 dsh 运行时经 profile 的 pnpm 闭包注入，自己声明会在公共 npm 上解析
不到（`@deepseek-ai/dsh-tools` 自带 cordis/dsh-agent 等 9 个 peer，单独 `npm install` 直接
ERESOLVE）。因此 `npm install` 是空操作。

想让插件注册组（`test/plugin-apply.test.mjs`）也跑起来，就把 SDK 链进 `node_modules`：

```sh
DSH_AI="$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai"   # dsh 安装位置
mkdir -p node_modules/@deepseek-ai
ln -s "$DSH_AI/dsh-tools" node_modules/@deepseek-ai/dsh-tools
node --test        # 插件注册组不再跳过（本机开发树里已如此）
```

## 本地开发安装（改了 Node half 要立刻试）

**必须先链 SDK，再装目录**，否则 profile 起不来：

```sh
DSH_AI="$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
mkdir -p node_modules/@deepseek-ai
ln -s "$DSH_AI/dsh-tools" node_modules/@deepseek-ai/dsh-tools
dsh plugin --profile web add "$PWD"     # 在包目录内 add（dsh 锚定 . 为绝对路径）
```

为什么必须这样（实测）：官方包的真实解析源是 **`$DSH_HOME/profiles/node_modules/`（profiles 层
扁平 fallback，含 `@deepseek-ai/dsh-tools`）**。Node 的 ESM 解析从包的**真实路径**向上逐级找
`node_modules`，所以：

- **git 源安装**：包落在 `<profile>/node_modules/@vlln/evo-engineering` ⇒ 向上能找到
  `profiles/node_modules` ⇒ 解析成功（实测 boot 正常，URL 正常输出）。
- **本地目录安装**：包的真实路径在 profile 树**之外**（如 `/tmp/…`）⇒ 向上永远到不了那个
  fallback ⇒ `Cannot find package '@deepseek-ai/dsh-tools'`，而且这是**装载期抛错**：
  profile 直接起不来（`plugin tree failed to load`，进程退出码 1），不只是插件不可用。

（另：`dsh plugin add` 对 git 源不安装 devDependencies，所以仓库零依赖不影响用户侧安装——
只有本地开发树需要上面那条链接。）

门禁清单与"每个门禁必须能被非法样例拒绝"的自证测试：

| 门禁 | 抓什么 | 自证测试 |
|---|---|---|
| `package-contract` | entry/bundle patch 存在、`cordis.patch.yml` insert 行与包名同源、**不得声明运行时注入的官方包**、`dsh.skills` 若声明须存在 | 6 项 |
| `skills` | frontmatter 齐全、`name` 与目录同名、description 够长（激活靠它）、<500 行 | 4 项 |
| `no-machine-paths` | 入库文件不得含本机绝对路径（发布卫生） | 2 项 |
| `md-links` | 相对链接可解析（死链是发布后最常见的事故） | 3 项 |
| `script-syntax` | 全部 `.mjs` 过 `node --check` | 2 项 |
| `unit-tests` | `node --test` 全绿 | 由测试自身覆盖 |

## 验证证据（两回合真实运行）

`examples/validation/` 是真实引擎跑出来的存档，摘要：

- **Round 1**（propose×2 / act×2 / critique×4 / regress×2 子代理）：`candidate-1` 以 **8.8 当选**
  （> champion 0，无 reject，两条回归探针 PASS）。critic 的判分是量化+取证式的：grep 验证
  禁词零命中、句长极差从 baseline 3.9 倍拉到 9.5 倍；同时主动报了"第一人称 vs 群体口吻"的
  视角回归担忧 → 该回合标 `needsHuman`，照常记账打点。
- **Round 2**（元层读 Round 1 的 critic 意见后提针对性提议）：挑战者 **8.5**，高于阈值、无
  reject，但 **8.5 < 冠军 8.8 → 拒绝采纳，champion 不变**。防退化按设计生效。

**插件面验证（更贵、也更要紧）**：在一个真实实验仓库（44 批实验 / 130+ 提交）上做端到端验证，
发现 v0.1 出厂状态**从未在真实 profile 里启动过**——6 个 bug，4 个使插件完全不可用。详见
[known-issues](known-issues.md) 与 [决策记录](../decisions/implemented/bug-fix/2026-09-18-plugin-face-never-booted.md)。

**教训（写下来免得再犯）**：mock ctx 不施加 cordis 的严格注入门禁，所以"apply 注册成功"的
单测照不出"缺 `inject` 导致启动即崩"；引擎级验证只覆盖 L1，会绕过整个 L2 插件面。
**两层的验证都要有，不能互相代替。**

## 环境事实（dsh 0.1.2-rc.1 实测，基线升级时须重新核实）

- **cordis 4 严格注入**：`apply` 里访问未在 `export const inject` 声明的服务，直接抛
  `cannot get property "..." without inject` ⇒ 整个 entry 组装载失败、profile 起不来。
- **引擎服务名是 `workflowEngine`**（历史上叫 `workflows`）。它由官方基础组合提供，本插件
  故意**不**静态 inject：静态 inject 会让缺该服务的组合里 entry 永久 pending 并拖垮启动。
- **子代理的 cwd 不是工作区**：一切路径要么绝对化，要么由引擎回传后由插件吸收。
- **`dsh.skills` 不被消费**：当前运行时全量搜索零命中；skill 只从文件系统发现——
  `<项目>/.dsh/skills`、`<项目>/.agents/skills`、`$DSH_HOME/skills`、`~/.agents/skills`，
  外加 custom 与 bundled 两类。
- **`dsh plugin add <git 源>` 不安装 `devDependencies`**：所以 devDependencies 里的官方 SDK
  不会污染用户侧；反之本地测试需要 `npm install`。
- **`private: true` 不影响 git 源安装**，但会阻止 npm publish（保留 = 暂不走 npm）。
- 模块解析：profile 侧靠 dsh 生成的 `.dsh-module-fallback` 提供官方包，插件包**不要**声明
  `@deepseek-ai/*` / `cordis`（声明了公共 npm 解析不到，只会给用户带来 peer 警告）。

## 路线

见 [design](design.md) §6：UI 进化页签、探针自动积累、`/evo watch` 持续圈、harbor 类 0–1
判分器当 critic。仍未修的两项（actor cwd 的"根"、σ_fitness 标定门禁）见
[known-issues](known-issues.md) §3。
