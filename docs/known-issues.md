# 已知问题与最小复现（v0.1 验证后）

> 来源：本插件在一个真实实验仓库（`dsh-evo-lab`，44 批实验 / 130+ 提交）上做端到端验证时发现的全部问题。
> 完整验证记录（含三个工作区轨迹与判决）见
> `dsh-evo-lab/docs/records/evo-plugin-validation.md`。
>
> **一句话判决**：本插件的 L2 面**出厂时从未在真实 profile 里启动过**——
> 4 个 bug 串成一条链（启动即崩 → 功能死 → 冠军每圈丢失 → 产物越界），任何一个都能单独让机制静默失效。

## 0. 快速自检（7 条，跑一遍就知道健康度）

```sh
node --test                                              # 21 项应全过
node --check src/evo.mjs                                 # 语法
node -e "import('./src/index.mjs').then(m=>console.log(m.inject))"   # 必须打印 ['tools','commands']，不是 undefined
grep -rn "ctx.get('workflows')" src/                     # 必须无命中（应为 workflowEngine）
git -C <工作区> show --name-only HEAD | head             # checkpoint 只应含工作区路径
git -C <工作区> tag --list                               # 多工作区时 tag 应带工作区名前缀
git -C <工作区> status --porcelain | grep -v '^??' | head # 宿主仓库的无关改动不应被吃掉
```

## 1. 使插件不可用的 4 处（✅ 已修，附最小复现）

| # | 现象 | 根因 | 最小复现 | 状态 |
|---|---|---|---|---|
| 1 | **启动即崩**：`cannot get property "tools" without inject` | `apply` 里静态访问 `ctx.tools` / `ctx.commands`，但模块没有 `export const inject`。cordis 4 对未声明服务的属性访问直接抛错 ⇒ 整个 entry 装载失败、profile 起不来 | 在任意 profile 挂载本插件并启动；或 `node -e "import('./src/index.mjs')"` 后比对 `m.inject`（旧版为 `undefined`） | ✅ 加 `export const inject = ['tools','commands']` |
| 2 | **功能死**：`no "workflows" service in this profile` | 服务名在 DSH 0.1.2-rc.1 已由 `workflows` 改为 `workflowEngine`；且 headless bundle **不含**该提供者 | 在 headless profile 里跑 `/evo` | ✅ 改名；报错文案改为"请在 profile 补 `@deepseek-ai/dsh-workflow` 的 insert 行" |
| 3 | **冠军每圈丢失**（机制静默失效） | `ledger.mjs` 的 `SELECTED_RE` 只匹配相对路径 `runs/N/candidate-M`，而 ledger 实际写的是**绝对路径** ⇒ `findChampion` 永远返回 null ⇒ 下一圈 `championScore: 0` ⇒ **冠军地板永不生效** | 跑两圈，看第二圈的 `championScore`：旧版恒为 `0`，且 `championDir` 不被用于 act 的起点 | ✅ 正则接受绝对路径；并新增"冠军打底"（`actBaseAbs`）——否则每圈都从 `baseline/` 重来，**没有累积** |
| 4 | **产物写到工作区之外**、无法入账 | 子代理按**自己的 cwd** 解析相对路径 ⇒ 候选落在 `/private/tmp/...` | 跑一圈后 `ls <工作区>/runs/` 为空，而 `/tmp` 下多出 `candidate-*` | ✅ 双保险：引擎回传 `candidateAbs` + 提示词用绝对路径 + 插件侧**吸收**进 `runs/N/` |

> ⚠️ **3 与 4 的因果链值得单独记住**：「相对路径正则 ⇒ 选不出冠军 ⇒ `championScore` 恒 0 ⇒ 地板永不触发」。
> 这条链在日志里**完全看不出来**——每圈都有分、有判决、有 ledger 记录，只是**从不参照前任冠军**。

## 2. 会破坏宿主仓库的 2 处（✅ 已修，本次新增）

工作区经常被放在一个**更大的宿主仓库**里（如 `<lab>/evo-ws/chain-v1`），此时任何不加限定的
git 操作动的都是**别人的仓库**。

| # | 现象 | 根因 | 最小复现 | 状态 |
|---|---|---|---|---|
| 5 | **checkpoint 扫掉整个宿主工作树** | `commitRound` 用无路径范围的 `git add -A` + `git commit` | 建一个宿主仓库 + 嵌一个工作区 + 改一个无关文件，跑一圈；旧版 `git show --name-only HEAD` 会含无关路径 | ✅ `add -A -- <rel>` + `commit --only -- <rel>` |
| 6a | **tag 互相覆盖** | `evo/round-N` 是仓库全局的，多个工作区共用同一命名空间 | 两个工作区各跑 1 圈 → 旧版只剩 1 个 tag | ✅ 嵌套时分区为 `evo/<工作区名>/round-N`；回滚兼容旧扁平名 |
| 6b | **回滚丢掉宿主未提交改动** | `rollbackWorkspace` 用 `git reset --hard` | 嵌套工作区里 `/evo rollback 1` → 旧版把宿主仓库全部未提交改动一起清掉 | ✅ 嵌套时改用 `git checkout <tag> -- <rel>`（只恢复子树；该圈后新增的未跟踪文件保留） |

**真实事故量化**（`dsh-evo-lab`，2026-09）：一次 `evo: round 1` 提交扫进 **1,105 个文件 / 362,698 行**，
其中只有 **194 个（18%）** 属于该工作区；另外 3 个工作区跑 9 圈只留下 **5 个** tag。
`test/git-scope.test.mjs` 把 5 / 6a / 6b 的四种表现全部钉住（5 个回归）。

> 该回归测试**当场抓出了修复代码自己的一个 bug**：`gitLayout` 没取 `realpath`，
> 而 macOS 上 `/var` 是指向 `/private/var` 的符号链接 ⇒ `path.relative` 算出仓库外路径、
> 把 pathspec 打飞。教训：**新写的修复必须带一个会失败的测试**，否则只是换了个 bug。

## 3. 仍未修（接手点）

| # | 问题 | 为什么没修 | 建议修法 |
|---|---|---|---|
| 4r | **产物越界的"根"**：现在靠**回合后吸收**（事后补救），玩家侧仍会越界写盘 | 根治需要让 subagent 在**受限工作目录**里运行——属 DSH 侧能力，不是本插件能单方面解决的 | DSH 支持 per-agent cwd 后，把 actor 的 cwd 钉到工作区；届时可去掉吸收逻辑 |
| 7 | **协议只覆盖 `evo/round-*` 的老命名** | 回滚已兼容两种命名，但 SKILL 里的手动补测配方仍可能被老工作区沿用 | 无需动作；新工作区一律走插件（自动分区） |
| 8 | **σ 未标定就允许启动演化循环** | 引擎不知道 fitness 的噪声水平 ⇒ 当 `σ_fitness` 与遗传差异同阶时，演化会退化成随机游走**且看起来完全正常**（实测：3 代都有"新冠军"、每条轨迹都能讲出故事，实际是噪声） | 建议在 `evo_init` 时要求报 `σ_fitness`（同基因型重复测量）与 MDE；`预算 ÷ 单次评估成本 < 所需 n` 时**拒绝启动**。详见 `dsh-evo-lab/docs/records/project-closure.md` §4.2 |

## 4. 验证结论（供维护者判断优先级）

修完 1–6 后，机制**全部验收**：跨圈冠军传递、冠军地板（含**平局正确否决**）、产物吸收入账、
工作区内可回溯。`node --test` 21/21。

**有效性证据（◇ 弱）**：在一个"评估免费"的环境（AlphaEvolve Math，判分 = 执行代码，0 LLM token）上，
**从冠军出发**的累积出现过一次远超波动的增益：`matmul` 5.82 → 8.89 → **10.00**（第二圈 +1.11 ≫ σ=0.28）。
⚠️ 但同一环境里另一次是**反例**（+0.06/+0.02 < σ），且两次"有效"都伴随**撞天花板**（10.0 = 论文已知最优归一）
⇒ 只能说"**在余量足够的题上至少出现过一次**累积增益"，不能说"能稳定产生实质改进"。单圈成本 ≈ 8 万 token。
