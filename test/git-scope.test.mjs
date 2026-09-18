// git-scope.test.mjs — 回归：checkpoint/回滚**只能**作用于本工作区。
//
// 背景（真实事故，见 dsh-evo-lab 的 docs/records/evo-plugin-validation.md）：
// 工作区经常被放在一个更大的宿主仓库里（如 `<lab>/evo-ws/chain-v1`）。旧实现用
// 无路径范围的 `git add -A` + `git commit`，于是：
//   1) 把宿主仓库里**与本工作区无关**的改动、乃至别人的整个未跟踪工作树，全部扫进
//      一条 `evo: round N` 提交（实测一次扫进 1,105 个文件 / 362,698 行，其中仅 18% 属于该工作区）；
//   2) 提交落在"当时检出的任意分支"上；
//   3) tag `evo/round-N` 是仓库全局的 ⇒ 多个工作区互相覆盖（实测 9 圈只留 5 个 tag）；
//   4) 回滚用 `git reset --hard` ⇒ 会把宿主仓库的**全部未提交改动**一起丢掉。
//
// 本文件把四条都钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { commitRound, rollbackWorkspace } = await import(path.join(here, '..', 'src', 'evo.mjs'))

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function mkTemp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

/** 建一个宿主仓库，里面嵌一个工作区 ws/，并制造"无关的脏改动"。 */
async function setupHostWithNestedWorkspace() {
  const host = await mkTemp('evo-scope-host-')
  git(host, 'init', '-q')
  git(host, 'config', 'user.email', 't@example.com')
  git(host, 'config', 'user.name', 'test')
  await fs.mkdir(path.join(host, 'unrelated'), { recursive: true })
  await fs.writeFile(path.join(host, 'unrelated', 'a.txt'), 'base\n')
  git(host, 'add', '-A')
  git(host, 'commit', '-q', '-m', 'init')

  const ws = path.join(host, 'ws')
  await fs.mkdir(ws, { recursive: true })
  await fs.writeFile(path.join(ws, 'criteria.md'), 'criteria\n')
  await fs.writeFile(path.join(ws, 'ledger.md'), '# ledger\n')

  // 无关的脏改动（已跟踪的修改 + 未跟踪的新文件）
  await fs.appendFile(path.join(host, 'unrelated', 'a.txt'), 'dirty-tracked\n')
  await fs.writeFile(path.join(host, 'unrelated', 'b.txt'), 'dirty-untracked\n')
  return { host, ws }
}

const entry = (round) => ({ round, date: '2026-09-18', selected: null })

test('嵌套工作区：checkpoint 只提交工作区，宿主无关改动原样保留', async () => {
  const { host, ws } = await setupHostWithNestedWorkspace()
  const res = await commitRound(ws, entry(1))
  assert.equal(res.committed, true)

  const committed = git(host, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean)
  assert.deepEqual(committed.sort(), ['ws/criteria.md', 'ws/ledger.md'])

  // 宿主的无关改动必须**仍未提交**（这正是旧实现会吃掉的东西）
  const status = git(host, 'status', '--porcelain')
  assert.match(status, /unrelated\/a\.txt/)
  assert.match(status, /unrelated\/b\.txt/)
  assert.equal(committed.some((f) => f.startsWith('unrelated/')), false)
  assert.equal(res.scopedTo, 'ws')
})

test('嵌套工作区：tag 按工作区名分区，两个工作区不互相覆盖', async () => {
  const { host, ws } = await setupHostWithNestedWorkspace()
  const ws2 = path.join(host, 'ws2')
  await fs.mkdir(ws2, { recursive: true })
  await fs.writeFile(path.join(ws2, 'ledger.md'), '# ledger 2\n')

  const r1 = await commitRound(ws, entry(1))
  const r2 = await commitRound(ws2, entry(1))
  assert.equal(r1.tag, 'evo/ws/round-1')
  assert.equal(r2.tag, 'evo/ws2/round-1')
  const tags = git(host, 'tag', '--list').split('\n').filter(Boolean).sort()
  assert.deepEqual(tags, ['evo/ws/round-1', 'evo/ws2/round-1'])
})

test('嵌套工作区：回滚只恢复工作区子树，宿主未提交改动不丢', async () => {
  const { host, ws } = await setupHostWithNestedWorkspace()
  await commitRound(ws, entry(1))
  const before = await fs.readFile(path.join(host, 'unrelated', 'a.txt'), 'utf8')

  // 第 2 圈改坏工作区内的文件并打点
  await fs.writeFile(path.join(ws, 'criteria.md'), 'BROKEN\n')
  const r2 = await commitRound(ws, entry(2))
  assert.equal(r2.tag, 'evo/ws/round-2')

  const back = await rollbackWorkspace(ws, 1)
  assert.equal(back.ok, true)
  assert.match(back.text, /subtree|工作区/, '回滚提示必须说明作用范围')
  assert.equal(await fs.readFile(path.join(ws, 'criteria.md'), 'utf8'), 'criteria\n', '工作区内容应回到第 1 圈')

  // 关键断言：宿主仓库的无关改动没有被 `reset --hard` 吃掉
  assert.equal(await fs.readFile(path.join(host, 'unrelated', 'a.txt'), 'utf8'), before)
  const status = git(host, 'status', '--porcelain')
  assert.match(status, /unrelated\/a\.txt/)
  assert.match(status, /unrelated\/b\.txt/)
})

test('工作区即仓库根：保持整树提交 + 扁平 tag 名（不破坏既有语义）', async () => {
  const root = await mkTemp('evo-scope-root-')
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@example.com')
  git(root, 'config', 'user.name', 'test')
  await fs.writeFile(path.join(root, 'ledger.md'), '# ledger\n')
  await fs.writeFile(path.join(root, 'candidate.py'), 'x = 1\n')

  const res = await commitRound(root, entry(1))
  assert.equal(res.committed, true)
  assert.equal(res.tag, 'evo/round-1')
  assert.equal(res.scopedTo, null)
  const committed = git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort()
  assert.deepEqual(committed, ['candidate.py', 'ledger.md'])

  const back = await rollbackWorkspace(root)
  assert.equal(back.ok, true)
  assert.match(back.text, /evo\/round-1/)
})

test('非 git 仓库：commitRound 不炸，明确报错', async () => {
  const dir = await mkTemp('evo-scope-plain-')
  await fs.writeFile(path.join(dir, 'ledger.md'), '# ledger\n')
  // macOS 上 os.tmpdir() 有可能位于某个仓库内；显式确认它在仓库外
  let inRepo = true
  try { git(dir, 'rev-parse', '--is-inside-work-tree'); } catch { inRepo = false }
  if (inRepo) return // 环境把 tmp 放进了仓库：跳过（不伪造通过）
  const res = await commitRound(dir, entry(1))
  assert.equal(res.committed, false)
  assert.equal(res.git, 'not a git repo')
})
