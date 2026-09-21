// gates.test.mjs — 门禁的自证测试：**每个门禁都要有一个非法样例证明它会拒绝**。
// 这是 dev-conventions 的硬要求：假门禁（只会绿的检查）比没有门禁更坏。
// 夹具建在临时目录里，用 gate 的 {root, files} 注入口喂进去——文件扫描类门禁
// 必须显式传 files（临时目录不是 git 仓库，trackedFiles() 会返回空表）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import {
  gatePackageContract, gateSkills, gateNoMachinePaths, gateMdLinks, gateScriptSyntax,
} from '../scripts/gates/run.mjs'

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evo-gate-'))
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  }
  return root
}

const NAME = 'demo-plugin'
const legalPkg = () => ({
  name: NAME,
  version: '0.1.0',
  type: 'module',
  main: './index.mjs',
  exports: { '.': './index.mjs', './cordis.patch.yml': './cordis.patch.yml', './package.json': './package.json' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
})

const LEGAL_PATCH = "- insert:\n    - id: demo-plugin\n      name: 'demo-plugin'\n"

async function pkgFixture(pkg) {
  return fixture({
    'package.json': JSON.stringify(pkg, null, 2),
    'index.mjs': 'export const name = "demo-plugin"\n',
    'cordis.patch.yml': LEGAL_PATCH,
  })
}

// ── package-contract ────────────────────────────────────────────────────────
test('package-contract: 合法 bundle 包通过', async () => {
  const r = await gatePackageContract({ root: await pkgFixture(legalPkg()) })
  assert.equal(r.ok, true, r.failures.join('; '))
})

test('package-contract: 拒绝（entry 指向不存在的文件）', async () => {
  const pkg = legalPkg()
  pkg.main = './missing.mjs'
  pkg.exports['.'] = './missing.mjs'
  const r = await gatePackageContract({ root: await pkgFixture(pkg) })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /不存在的文件/)
})

test('package-contract: 拒绝（cordis.patch.yml 未点名自身包名）', async () => {
  const root = await fixture({
    'package.json': JSON.stringify(legalPkg(), null, 2),
    'index.mjs': 'export const name = "demo-plugin"\n',
    'cordis.patch.yml': "- insert:\n    - id: other\n      name: 'other-plugin'\n",
  })
  const r = await gatePackageContract({ root })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /未 insert 自身包名/)
})

test('package-contract: 拒绝（声明了运行时注入的官方包）', async () => {
  const pkg = legalPkg()
  pkg.peerDependencies = { '@deepseek-ai/dsh-tools': '^0.0.1' }
  const r = await gatePackageContract({ root: await pkgFixture(pkg) })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /官方包/)
})

test('package-contract: 拒绝（dsh.skills 指向不存在的文件，若声明了）', async () => {
  const pkg = legalPkg()
  pkg.dsh.skills = ['./skills/ghost/SKILL.md']
  const r = await gatePackageContract({ root: await pkgFixture(pkg) })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /dsh\.skills 指向不存在/)
})

test('package-contract: 拒绝（缺 dsh.bundle.patch）', async () => {
  const pkg = legalPkg()
  delete pkg.dsh
  const r = await gatePackageContract({ root: await pkgFixture(pkg) })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /dsh\.bundle\.patch/)
})

// ── skills ──────────────────────────────────────────────────────────────────
test('skills: 合法 SKILL.md 通过', async () => {
  const root = await fixture({ 'skills/foo/SKILL.md': '---\nname: foo\ndescription: Use this skill when the agent must do a specific thing well.\n---\n\n# foo\n' })
  const r = await gateSkills({ root, files: ['skills/foo/SKILL.md'] })
  assert.equal(r.ok, true, r.failures.join('; '))
})

test('skills: 拒绝（缺 frontmatter）', async () => {
  const root = await fixture({ 'skills/foo/SKILL.md': '# foo\n没有 frontmatter\n' })
  const r = await gateSkills({ root, files: ['skills/foo/SKILL.md'] })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /缺 frontmatter/)
})

test('skills: 拒绝（name 与目录名不一致）', async () => {
  const root = await fixture({ 'skills/foo/SKILL.md': '---\nname: bar\ndescription: Use this skill when the agent must do a specific thing well.\n---\n' })
  const r = await gateSkills({ root, files: ['skills/foo/SKILL.md'] })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /不一致/)
})

test('skills: 拒绝（description 过短——激活靠它）', async () => {
  const root = await fixture({ 'skills/foo/SKILL.md': '---\nname: foo\ndescription: 短\n---\n' })
  const r = await gateSkills({ root, files: ['skills/foo/SKILL.md'] })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /description 过短/)
})

// ── no-machine-paths ────────────────────────────────────────────────────────
test('no-machine-paths: 干净文本通过', async () => {
  const root = await fixture({ 'a.md': '路径写成 <工作区>/runs 即可\n' })
  assert.equal((await gateNoMachinePaths({ root, files: ['a.md'] })).ok, true)
})

test('no-machine-paths: 拒绝（含本机绝对路径）', async () => {
  // 路径在运行时拼出，避免本文件自身触发 no-machine-paths 门禁
  const fakeMachinePath = ['', 'Users', 'someone', 'project', 'runs'].join('/')
  const root = await fixture({ 'a.md': `候选落在 ${fakeMachinePath} 下\n` })
  const r = await gateNoMachinePaths({ root, files: ['a.md'] })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /本机绝对路径/)
})

// ── md-links ────────────────────────────────────────────────────────────────
test('md-links: 可解析链接通过', async () => {
  const root = await fixture({ 'a.md': '[x](docs/b.md)\n', 'docs/b.md': '# b\n' })
  assert.equal((await gateMdLinks({ root, files: ['a.md', 'docs/b.md'] })).ok, true)
})

test('md-links: 拒绝（死链）', async () => {
  const root = await fixture({ 'a.md': '[x](docs/missing.md)\n' })
  const r = await gateMdLinks({ root, files: ['a.md'] })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /死链/)
})

test('md-links: http 与锚点链接不算死链', async () => {
  const root = await fixture({ 'a.md': '[x](https://example.com/y) [z](#section)\n' })
  assert.equal((await gateMdLinks({ root, files: ['a.md'] })).ok, true)
})

// ── script-syntax ───────────────────────────────────────────────────────────
test('script-syntax: 合法 .mjs 通过', async () => {
  const root = await fixture({ 'a.mjs': 'export const x = 1\n' })
  assert.equal((await gateScriptSyntax({ root, files: ['a.mjs'] })).ok, true)
})

test('script-syntax: 拒绝（语法错误）', async () => {
  const root = await fixture({ 'bad.mjs': 'export const x = (\n' })
  const r = await gateScriptSyntax({ root, files: ['bad.mjs'] })
  assert.equal(r.ok, false)
  assert.match(r.failures.join(' '), /bad\.mjs/)
})
