// scripts/gates/run.mjs — 本仓库的门禁程序（机械检查 + 自证测试）。
//
// 用法：
//   node scripts/gates/run.mjs                 # 跑全部门禁
//   node scripts/gates/run.mjs package-contract # 按改动面只跑最窄证据
//   node scripts/gates/run.mjs --list          # 列出可用门禁
//
// 纪律（plugin-registry make-dsh-plugin / dev-conventions）：
//   - 每个门禁都有非法样例测试证明它**会拒绝**（test/gates.test.mjs）。
//   - 门禁清单的权威就是本文件；按改动面跑最窄证据，不默认全套。
//   - 门禁只做机械可判定的事；判不了的不写进来（假门禁比没门禁更坏）。
//
// 每个 gate 是 (options) => { ok, failures, note }；options.root 可注入
// （自证测试用它指向临时夹具仓库），默认本仓库根。

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(HERE, '..', '..')

/** 官方包由运行时注入——本仓库不得声明（make-dsh-plugin/bundle-plugins.md）。 */
const RUNTIME_INJECTED = [/^@deepseek-ai\//, /^cordis$/, /^@deepseek-ai\/cordis$/]

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/** git 跟踪的文本文件清单（自证测试可注入 files 绕过）。 */
export async function trackedFiles(root = repoRoot) {
  return new Promise((resolve) => {
    execFile('git', ['ls-files'], { cwd: root, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve([])
        return
      }
      resolve(String(stdout).split('\n').filter(Boolean))
    })
  })
}

// ── gate: package-contract ───────────────────────────────────────────────────
/** package.json 的 dsh 契约：入口存在、bundle patch 指向真实文件、insert 行点名自身、不声明官方依赖。 */
export async function gatePackageContract({ root = repoRoot } = {}) {
  const failures = []
  const pkgPath = path.join(root, 'package.json')
  if (!(await exists(pkgPath))) return { ok: false, failures: ['package.json 不存在'], note: '契约门禁' }
  const pkg = await readJson(pkgPath)

  // 入口：main / exports["."] 必须指向真实文件
  const entry = pkg.exports?.['.'] ?? pkg.main
  if (typeof entry !== 'string') failures.push('main / exports["."] 缺失：entry 未声明')
  else if (!(await exists(path.join(root, entry)))) failures.push(`main/exports["."] 指向不存在的文件：${entry}`)

  // bundle：dsh.bundle.patch 指向真实 patch 文件
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    failures.push('dsh.bundle.patch 缺失：不是 bundle 形态（bundle 需声明组合层）')
  } else {
    const patchPath = path.join(root, patch)
    if (!(await exists(patchPath))) {
      failures.push(`dsh.bundle.patch 指向不存在的文件：${patch}`)
    } else if (typeof pkg.name === 'string') {
      // insert 行必须点名自身（name 三处同源：package.json / cordis.patch.yml / profile bundles）
      const text = await fs.readFile(patchPath, 'utf8')
      if (!text.includes(`'${pkg.name}'`) && !text.includes(`"${pkg.name}"`) && !text.includes(`: ${pkg.name}`)) {
        failures.push(`cordis.patch.yml 未 insert 自身包名（${pkg.name}）：组合层与包名不同源`)
      }
      if (!/- insert:/.test(text)) failures.push('cordis.patch.yml 缺 `- insert:` 行')
    }
  }

  // exports 契约面：bundle patch 应可解析（规范里的 exports["./cordis.patch.yml"]）
  if (patch !== undefined && pkg.exports?.['./cordis.patch.yml'] === undefined) {
    failures.push('exports 缺 "./cordis.patch.yml"（entry 契约要求可解析组合层）')
  }

  // 运行时注入的官方包不得声明
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (RUNTIME_INJECTED.some((re) => re.test(dep))) {
        failures.push(`${field} 声明了官方包 ${dep}：官方运行时经 profile pnpm 闭包注入，声明了公共 npm 解析不到反而失败`)
      }
    }
  }

  // dsh.skills 声明的路径必须真实存在
  const skills = pkg.dsh?.skills
  if (skills !== undefined) {
    if (!Array.isArray(skills) || skills.some((s) => typeof s !== 'string')) {
      failures.push('dsh.skills 必须是字符串数组（相对包根路径）')
    } else {
      for (const rel of skills) {
        if (!(await exists(path.join(root, rel)))) failures.push(`dsh.skills 指向不存在的文件：${rel}`)
      }
    }
  }

  return { ok: failures.length === 0, failures, note: `entry=${entry ?? '?'} bundle=${patch ?? '?'}` }
}

// ── gate: skills ─────────────────────────────────────────────────────────────
/** 每个 skills/<name>/SKILL.md：frontmatter 有 name/description、name 与目录同名、<500 行。 */
export async function gateSkills({ root = repoRoot, files } = {}) {
  const failures = []
  const list = files ?? await trackedFiles(root)
  const skillFiles = list.filter((f) => /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(f))
  if (skillFiles.length === 0) return { ok: true, failures: [], note: '无 skill（跳过）' }
  for (const rel of skillFiles) {
    const text = await fs.readFile(path.join(root, rel), 'utf8')
    const dirName = path.basename(path.dirname(rel))
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)
    if (fm === null) {
      failures.push(`${rel}: 缺 frontmatter`)
      continue
    }
    const nameMatch = /^name:\s*(\S+)/m.exec(fm[1])
    if (nameMatch === null) failures.push(`${rel}: frontmatter 缺 name`)
    else if (nameMatch[1] !== dirName) failures.push(`${rel}: name(${nameMatch[1]}) 与目录名(${dirName}) 不一致`)
    const desc = /^description:\s*>?\s*\n?([\s\S]*?)(?=\n[a-z-]+:|\n*$)/m.exec(fm[1])
    const descText = desc === null ? '' : desc[1].replace(/\s+/g, ' ').trim()
    if (descText.length < 40) failures.push(`${rel}: description 过短或无（激活靠它，需说清何时使用）`)
    const lines = text.split('\n').length
    if (lines >= 500) failures.push(`${rel}: ${lines} 行 ≥500（应 progressive disclosure 到 references/）`)
  }
  return { ok: failures.length === 0, failures, note: `${skillFiles.length} 个 skill` }
}

// ── gate: no-machine-paths ───────────────────────────────────────────────────
/** 入库文件不得含本机绝对路径（/Users/… 、/private/tmp）——发布卫生。 */
export async function gateNoMachinePaths({ root = repoRoot, files } = {}) {
  const failures = []
  const list = files ?? await trackedFiles(root)
  for (const rel of list) {
    if (!/\.(md|mjs|json|yml|yaml|txt)$/.test(rel)) continue
    const text = await fs.readFile(path.join(root, rel), 'utf8')
    const hits = text.match(/\/(?:Users|private\/tmp|home)\/[A-Za-z0-9._-]+/g)
    if (hits !== null) failures.push(`${rel}: 含本机绝对路径 ${[...new Set(hits)].slice(0, 2).join(', ')}`)
  }
  return { ok: failures.length === 0, failures, note: `${list.length} 个文件` }
}

// ── gate: md-links ───────────────────────────────────────────────────────────
/** 入库 md 的相对链接必须能在仓库内解析（死链是发布后最常见的事故）。 */
export async function gateMdLinks({ root = repoRoot, files } = {}) {
  const failures = []
  const list = (files ?? await trackedFiles(root)).filter((f) => f.endsWith('.md'))
  for (const rel of list) {
    const text = await fs.readFile(path.join(root, rel), 'utf8')
    const re = /\[[^\]]*\]\(([^)\s]+)\)/g
    let m
    while ((m = re.exec(text)) !== null) {
      const target = m[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const clean = target.split('#')[0]
      if (clean === '') continue
      const resolved = path.resolve(path.dirname(path.join(root, rel)), clean)
      if (!(await exists(resolved))) failures.push(`${rel}: 死链 ${target}`)
    }
  }
  return { ok: failures.length === 0, failures, note: `${list.length} 个 md` }
}

// ── gate: script-syntax ──────────────────────────────────────────────────────
/** 所有 .mjs（src/workflow/scripts/test）的语法检查。 */
export async function gateScriptSyntax({ root = repoRoot, files } = {}) {
  const failures = []
  const list = (files ?? await trackedFiles(root)).filter((f) => f.endsWith('.mjs'))
  for (const rel of list) {
    const result = await new Promise((resolve) => {
      execFile(process.execPath, ['--check', path.join(root, rel)], (error, _o, stderr) => {
        resolve(error ? String(stderr || error.message).split('\n')[0] : null)
      })
    })
    if (result !== null) failures.push(`${rel}: ${result}`)
  }
  return { ok: failures.length === 0, failures, note: `${list.length} 个 .mjs` }
}

// ── gate: unit-tests ─────────────────────────────────────────────────────────
/** 单元/回归测试（node --test，零依赖）。 */
export async function gateUnitTests({ root = repoRoot } = {}) {
  const result = await new Promise((resolve) => {
    execFile(process.execPath, ['--test'], { cwd: root, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      resolve({ error, stdout: String(stdout ?? '') })
    })
  })
  const pass = /# pass (\d+)/.exec(result.stdout)
  const fail = /# fail (\d+)/.exec(result.stdout)
  const failures = []
  if (result.error) failures.push(`node --test 失败：pass=${pass?.[1] ?? '?'} fail=${fail?.[1] ?? '?'}`)
  return { ok: failures.length === 0, failures, note: `pass=${pass?.[1] ?? '?'} fail=${fail?.[1] ?? '?'}` }
}

export const gates = {
  'package-contract': gatePackageContract,
  'skills': gateSkills,
  'no-machine-paths': gateNoMachinePaths,
  'md-links': gateMdLinks,
  'script-syntax': gateScriptSyntax,
  'unit-tests': gateUnitTests,
}

/** 子集选择：按改动面跑最窄证据。 */
export async function runGates(names, options = {}) {
  const picked = names !== undefined && names.length > 0 ? names : Object.keys(gates)
  const results = []
  for (const name of picked) {
    const gate = gates[name]
    if (gate === undefined) {
      results.push({ name, ok: false, failures: [`未知门禁：${name}`], note: '' })
      continue
    }
    results.push({ name, ...(await gate(options)) })
  }
  return results
}

const isCli = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const args = process.argv.slice(2)
  if (args.includes('--list')) {
    console.log(Object.keys(gates).join('\n'))
    process.exit(0)
  }
  const results = await runGates(args)
  let failed = 0
  for (const r of results) {
    const mark = r.ok ? '✅' : '❌'
    console.log(`${mark} ${r.name}${r.note !== '' ? `  (${r.note})` : ''}`)
    for (const f of r.failures) console.log(`     - ${f}`)
    if (!r.ok) failed += 1
  }
  console.log(failed === 0 ? `\n门禁全绿（${results.length} 项）` : `\n${failed}/${results.length} 项门禁未过`)
  process.exit(failed === 0 ? 0 : 1)
}
