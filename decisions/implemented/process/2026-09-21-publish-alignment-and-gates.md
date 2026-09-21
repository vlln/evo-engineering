# Decision: 按 make-dsh-plugin 规范发布：不声明官方依赖、加门禁、README 只留使用者内容

Status: implemented

## Problem

首次公开发布前，仓库有四处与生态规范（`plugin-registry/skills/make-dsh-plugin`）不符，
且有一处需要先核实事实：

1. `peerDependencies` 声明了 `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-workflow` / `cordis`
   —— 规范明确：「官方包由 profile 的 pnpm 闭包在挂载时注入，**不要声明**（声明了公共 npm
   解析不到反而失败）」。实测该声明只产出一条 pnpm peer 警告，安装仍成功——即"能装但违反
   契约，且把警告留给用户"。
2. 没有门禁程序（规范要求 `scripts/gates/run.mjs`），仓库只有 `npm test`。
3. README 承担了工程备忘录的职责（验证证据、bug 复盘、架构取舍、测试计数、死链指向被
   ignore 目录）——规范点名这是"最常见的跑偏"。
4. 仓库 description 与 topics 不符合发现规范（description 里塞了包名/生态术语，topics 有
   8 个且含泛词）。
5. **待核实的假设**：skill 是否需要通过插件机制注册（规范提到 `dsh.skills` 字段）。

## Decision

- **不声明官方依赖**。需要这些包才能跑的本地测试改放 `devDependencies`（精确钉
  `@deepseek-ai/dsh-tools@0.1.2-rc.1`，即开发实际使用的版本）；`dependencies`/`peerDependencies`
  保持为空是设计。测试在 SDK 缺席时**优雅跳过**并写明原因，于是裸 clone 的 `node --test`
  也能跑出有意义的结果。
- **加门禁** `scripts/gates/run.mjs`：`package-contract`（entry/bundle patch/insert 行同源/
  不得声明官方包/dsh.skills 若声明则须存在）、`skills`（frontmatter、name 与目录同名、
  description 够长、<500 行）、`no-machine-paths`（入库文件不得含本机绝对路径）、
  `md-links`（相对链接可解析）、`script-syntax`、`unit-tests`。**每个门禁配非法样例自证测试**
  （`test/gates.test.mjs`，17 项），支持按改动面只跑子集：`node scripts/gates/run.mjs md-links`。
- **README 只留使用者内容**：是什么 / 为什么需要（含与相邻方案的区别）/ 怎么装 / 用起来是什么
  样 / 能力面表 / 参数 / 已知限制 / 插件管理节 / 许可；工程备忘录（验证证据、bug 复盘、架构
  取舍、测试计数）移到 `docs/engineering-notes.md`，README 只留一句指针。
- **skill 保持文件系统分发，不依赖 `dsh.skills`**：SKILL.md 是跨 harness 的规范，落位方式是
  复制/链接进发现根，README 给出可直接复制的命令。
- 仓库 description 改成一句话「是什么 + 能干什么」；topics 收敛为 2 个生态身份词
  （`dsh-plugin`、`deepseek-harness`）+ 功能词。

## Alternatives considered

**保留 `peerDependencies`（跟 dsh-loop 等兄弟插件一致）。** 兄弟插件多带 client half（需要
react 等 peer 才能构建），本插件是纯 Node half、零构建，声明只会把 pnpm peer 警告带给用户，
并在公共 npm 上解析不到。

**声明 `dsh.skills` 让运行时注册 skill。** 核实结果：**当前 dsh 0.1.2-rc.1 全量搜索
`dsh.skills` 零命中**——没有任何消费方。skill 的真实发现路径是文件系统根：
`<项目>/.dsh/skills`、`<项目>/.agents/skills`、`$DSH_HOME/skills`、`~/.agents/skills`，
外加 custom 与 bundled 两类。声明了也不会生效，反而会让安装说明误导用户；等运行时支持后
再补声明即可（门禁已支持校验该字段）。

**给 skill 做插件注册（把 skill 塞进插件的能力面）。** 把"跨 harness 的规范"耦合到单一
harness 的注册通道上，正好抵消 L0 的全部价值。

**不加门禁，靠 review。** 本次对齐本身就是"规范条款＋机械检查"的产物——比如
`no-machine-paths` 门禁第一次跑就抓出 `docs/known-issues.md` 里的本机路径残留。

## Consequences

- `npm run gate` 成为提交前/发布前动作；CI 未接入（当前手动跑，属已知缺口）。
- `devDependencies` 钉在开发版本（0.1.2-rc.1）而非 npm `latest`（0.0.1-rc.1）：**版本升级时
  必须同步更新这里**，否则本地测试跑在旧 API 上。
- README 与 `docs/engineering-notes.md` 的读者分离成为常驻约束：新增内容先问"读者是用它的人
  还是改它的人"。
- 环境事实（记此备查）：`dsh plugin --profile web add` 对 git 源安装不安装 `devDependencies`，
  因此 `devDependencies` 不会污染用户侧；`private: true` 不影响 git 源安装，但会阻止 npm
  publish（保留该字段 = 暂不走 npm）。

## Testing

`node scripts/gates/run.mjs`（六项全绿）+ `node --test`（含 17 项门禁自证测试）。

## Related

- `decisions/implemented/architecture/2026-09-13-evo-three-layer-architecture.md`
- `docs/engineering-notes.md`（工程备忘录的新家）
