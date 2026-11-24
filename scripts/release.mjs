/**
 * Prepare one release: bump the version, append it to the market index, commit,
 * and tag. Pushing the tag is what triggers the GitHub publish workflow.
 *
 * Usage:
 *   node scripts/release.mjs patch          # 1.0.0 -> 1.0.1
 *   node scripts/release.mjs minor --push   # also git push --follow-tags
 *   node scripts/release.mjs major --dry-run
 *
 * The index entry is derived from package.json so the two can never drift.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const PACKAGE_PATH = fileURLToPath(new URL('package.json', ROOT))
const INDEX_PATH = fileURLToPath(new URL('index.json', ROOT))

const args = process.argv.slice(2)
const bump = args.find((arg) => ['patch', 'minor', 'major'].includes(arg)) ?? 'patch'
const dryRun = args.includes('--dry-run')
const push = args.includes('--push')

/**
 * Increment one SemVer version.
 * @param {string} version - current version, e.g. 1.2.3.
 * @param {'patch'|'minor'|'major'} kind - which component to bump.
 * @returns {string} the next version.
 */
function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (match === null) throw new Error(`unsupported version for automatic bump: ${version}`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'))
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
const nextVersion = bumpVersion(pkg.version, bump)

const plugin = index.plugins.find((entry) => entry.name === pkg.name)
if (plugin === undefined) throw new Error(`index.json does not list ${pkg.name}`)
if (plugin.versions.some((entry) => entry.version === nextVersion)) {
  throw new Error(`index.json already lists ${nextVersion}`)
}

const label = `${pkg.name}@${nextVersion}`
if (dryRun) {
  console.log(`dry run: would release ${label} (from ${pkg.version}), then commit + tag v${nextVersion}`)
  process.exit(0)
}

pkg.version = nextVersion
plugin.versions.unshift({
  version: nextVersion,
  publishTimestamp: Math.floor(Date.now() / 1000),
  source: { type: 'npm' },
  engines: { dsh: pkg.engines.dsh },
})

writeFileSync(PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, { cwd: fileURLToPath(ROOT), stdio: 'inherit' })

run('git', ['add', 'package.json', 'index.json'])
run('git', ['commit', '-m', `chore(release): v${nextVersion}`])
run('git', ['tag', '-a', `v${nextVersion}`, '-m', `v${nextVersion}`])
if (push) run('git', ['push', '--follow-tags'])

console.log(`\nreleased ${label}`)
console.log(
  push
    ? 'tag pushed: the publish workflow will run on GitHub Actions'
    : `next: git push --follow-tags   (triggers the publish workflow for v${nextVersion})`,
)
