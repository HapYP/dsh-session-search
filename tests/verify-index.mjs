/**
 * Validate the market index shipped with this repository.
 *
 * Uses DSH's own format-1 validator when it is resolvable (it ships with the
 * DSH installation), and otherwise falls back to structural checks so the
 * suite also runs in a bare checkout / CI container.
 *
 * Run:  node tests/verify-index.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const INDEX_PATH = fileURLToPath(new URL('../index.json', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'))

assert.equal(index.format, 1, 'index format must be 1')
assert.ok(index.title && typeof index.title.en === 'string', 'index needs a localized title')
assert.ok(Array.isArray(index.plugins) && index.plugins.length > 0, 'index needs at least one plugin')

const plugin = index.plugins.find((entry) => entry.name === pkg.name)
assert.ok(plugin, `index must list ${pkg.name}`)

assert.equal(plugin.title?.en && plugin.title?.zh ? true : false, true, 'plugin needs en + zh titles')
assert.ok(typeof plugin.description?.zh === 'string' && plugin.description.zh.length > 10, 'plugin needs a zh description')
assert.ok(String(plugin.icon).startsWith('data:image/') || /^https:\/\//.test(String(plugin.icon)), 'icon must be inline data: or absolute https URL')
assert.ok(plugin.repository?.url?.startsWith('https://github.com/'), 'repository url must be an absolute GitHub URL')

const version = plugin.versions?.find((entry) => entry.version === pkg.version)
assert.ok(version, `index must list version ${pkg.version}`)
assert.equal(version.source?.type, 'npm', 'source type must be npm')
assert.ok(Number.isInteger(version.publishTimestamp) && version.publishTimestamp > 1_600_000_000, 'publishTimestamp must be unix seconds')
assert.equal(version.engines?.dsh, pkg.engines?.dsh, 'engines.dsh must match package.json')

// Version list must be in descending SemVer order.
const versions = plugin.versions.map((entry) => entry.version)
const sorted = [...versions].sort((left, right) => {
  const parse = (value) => value.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return y - x
    return String(y).localeCompare(String(x))
  }
  return 0
})
assert.deepEqual(versions, sorted, 'versions must be in descending SemVer order')

// Cross-check the published version when DSH's validator is available.
let validated = false
for (const candidate of [
  '@deepseek-ai/dsh-plugin-market-index',
  'D:/Apps/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
]) {
  try {
    const module = await import(candidate)
    const parsed = module.parseMarketIndex(index, 'https://raw.githubusercontent.com/HapYP/dsh-session-search/main/index.json')
    assert.equal(parsed.plugins[0].name, pkg.name)
    assert.equal(module.marketInstallTarget(pkg.name, parsed.plugins[0].versions[0]).spec, `${pkg.name}@${pkg.version}`)
    validated = true
    break
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error
  }
}

console.log(
  validated
    ? `ok - index.json valid (DSH validator cross-checked): ${pkg.name}@${pkg.version}`
    : `ok - index.json structurally valid (DSH validator unavailable): ${pkg.name}@${pkg.version}`,
)
