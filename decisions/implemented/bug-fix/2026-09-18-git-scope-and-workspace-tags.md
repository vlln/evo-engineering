# Decision: git 操作限定路径 + 工作区分区 tag（工作区嵌在宿主仓库里）

Status: implemented

## Problem

evo 工作区经常被放在一个**更大的宿主仓库**内部（真实用法：`<实验仓库>/evo-ws/<变体>`）。
此时任何不加限定的 git 操作动的都是**别人的仓库**，实测出三种伤害：

1. **checkpoint 扫掉整个宿主工作树**：`commitRound` 用无路径范围的 `git add -A` + `git commit`
   ⇒ 一次 `evo: round 1` 提交扫进 **1,105 个文件 / 362,698 行**，其中只有 194 个（18%）
   属于该工作区，并且提交到了当时检出的任意分支。
2. **tag 互相覆盖**：`evo/round-N` 是仓库全局命名空间 ⇒ 多个工作区共用，实测 3 个工作区
   跑 9 圈只留下 **5 个** tag，回滚会滚到别的工作区的检查点。
3. **回滚丢掉宿主未提交改动**：`rollbackWorkspace` 用 `git reset --hard` ⇒ 嵌套时把宿主
   仓库的全部未提交改动一起清掉。

## Decision

- **限定路径提交**：`git add -A -- <工作区相对路径>` + `git commit --only -- <路径>`——只提交
  工作区子树，宿主的无关改动与别人的未跟踪工作树都不进这个提交。
- **分区 tag**：工作区就是仓库根时用 `evo/round-N`；嵌套时用 `evo/<工作区目录名>/round-N`。
- **回滚只恢复子树**：嵌套时用 `git checkout <tag> -- <相对路径>`（该圈之后新增的未跟踪文件
  保留），不再用 `reset --hard`。
- `gitLayout` 必须取 **realpath**：macOS 上 `/var` 是指向 `/private/var` 的符号链接，
  不取 realpath 会算出"仓库外"的相对路径、把 pathspec 打飞（这条是回归测试当场抓出来的）。

## Alternatives considered

**要求工作区必须是独立仓库根。** 把成本推给用户，而真实用法就是嵌在实验仓库里（44 批实验
都在同一个宿主仓库内做版本对照）；要求独立仓库会破坏用户的对照工作流。

**用 `git stash` / 临时 worktree 隔离。** 都会动宿主的工作树或引入额外目录；在一台机器上
并发跑多个工作区时不安全。

**继续用全局 `evo/round-N` 但加时间戳。** 可读性与可回滚性都变差（用户要敲的 tag 名不稳定），
且不解决"回滚丢改动"。

## Consequences

- 嵌套成为一等公民：tag 命名与回滚路径都带分区信息；老工作区遗留的扁平 `evo/round-N`
  仍按旧名读取（兼容两种命名）。
- 工作区相对路径成为 checkpoint 的必要输入：工作区被移动/重命名后，历史 tag 仍指向旧路径
  前缀——回滚前需自行核对（已在 SKILL/references 里写明）。
- `test/git-scope.test.mjs` 把三种表现（扫宿主、tag 覆盖、回滚丢改动）全部钉住，
  含 realpath 那个坑。

## Related

- `docs/known-issues.md` §2
- `skills/evo/references/anti-degradation.md`（tag 命名与回滚纪律的用户侧说明）
