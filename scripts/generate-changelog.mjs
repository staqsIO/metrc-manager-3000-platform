#!/usr/bin/env node
/**
 * Changelog entry generator — reads git log and produces ChangelogEntry objects.
 *
 * Usage:
 *   node scripts/generate-changelog.mjs              # stdout, last 7 days
 *   node scripts/generate-changelog.mjs --days 14    # last 14 days
 *   node scripts/generate-changelog.mjs --write      # insert into changelog.ts
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHANGELOG_PATH = resolve(__dirname, '../src/shared/constants/changelog.ts')

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const writeMode = args.includes('--write')
const daysIdx = args.indexOf('--days')
const days = daysIdx !== -1 && args[daysIdx + 1] ? Number(args[daysIdx + 1]) : 7

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalise a string to lowercase words for fuzzy matching. */
function words(str) {
  return str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
}

/** True when >60 % of the words in `a` appear in `b`. */
function fuzzyMatch(a, b) {
  const wa = words(a)
  const wb = new Set(words(b))
  if (wa.length === 0) return false
  const hits = wa.filter((w) => wb.has(w)).length
  return hits / wa.length > 0.6
}

/** Map conventional-commit type prefix to ChangelogEntryType. */
function commitType(prefix) {
  if (prefix === 'feat') return 'feature'
  if (prefix === 'fix') return 'fix'
  return 'improvement'
}

/** Format a commit message into a human-readable title. */
function humanTitle(scope, message) {
  // Capitalise first letter, trim trailing period
  let title = message.charAt(0).toUpperCase() + message.slice(1)
  title = title.replace(/\.$/, '')
  if (scope) {
    const prettyScope = scope.charAt(0).toUpperCase() + scope.slice(1)
    // Only prepend scope when it isn't already in the message
    if (!title.toLowerCase().includes(scope.toLowerCase())) {
      title = `${prettyScope}: ${title}`
    }
  }
  return title
}

// ── Read existing entries for de-duplication ────────────────────────────────

const changelogSrc = readFileSync(CHANGELOG_PATH, 'utf-8')

/** Collect titles + descriptions already in changelog.ts */
function existingTexts() {
  const texts = []
  const titleRe = /title:\s*['"`](.+?)['"`]/g
  const descRe = /description:\s*\n?\s*['"`](.+?)['"`]/g
  let m
  while ((m = titleRe.exec(changelogSrc))) texts.push(m[1])
  while ((m = descRe.exec(changelogSrc))) texts.push(m[1])
  return texts.join(' ')
}

const existingBlob = existingTexts()

// ── Read git log ────────────────────────────────────────────────────────────

const since = `${days}.days.ago`
const format = '%H||%ai||%s' // hash || author-date || subject
const raw = execSync(`git log --since="${since}" --format="${format}"`, {
  encoding: 'utf-8',
  cwd: resolve(__dirname, '..'),
}).trim()

if (!raw) {
  console.log(`No commits found in the last ${days} days.`)
  process.exit(0)
}

const conventionalRe = /^(feat|fix|refactor|perf|chore|docs|style|test|ci)(?:\(([^)]*)\))?:\s*(.+)/

const entries = []

for (const line of raw.split('\n')) {
  const [, dateIso, subject] = line.split('||')
  if (!subject) continue
  const match = subject.match(conventionalRe)
  if (!match) continue

  const [, prefix, scope, message] = match

  // Only surface features and fixes in the changelog
  if (prefix !== 'feat' && prefix !== 'fix') continue

  // Strip ticket refs like (FOR-123)
  const cleanMsg = message.replace(/\s*\(FOR-\d+\)\s*/g, '').trim()
  if (!cleanMsg) continue

  const title = humanTitle(scope, cleanMsg)
  const date = dateIso.slice(0, 10) // YYYY-MM-DD

  // De-duplicate against existing changelog
  if (fuzzyMatch(title, existingBlob)) continue

  // De-duplicate against entries we already collected in this run
  if (entries.some((e) => fuzzyMatch(e.title, title))) continue

  entries.push({
    date,
    title,
    description: cleanMsg.charAt(0).toUpperCase() + cleanMsg.slice(1),
    type: commitType(prefix),
  })
}

if (entries.length === 0) {
  console.log('No new changelog entries to add (all commits already represented).')
  process.exit(0)
}

// ── Output ──────────────────────────────────────────────────────────────────

/** Render one ChangelogEntry as TypeScript source text. */
function renderEntry(e) {
  const esc = (s) => s.replace(/'/g, "\\'")
  const lines = [
    `  {`,
    `    date: '${e.date}',`,
    `    title: '${esc(e.title)}',`,
    `    description:`,
    `      '${esc(e.description)}',`,
    `    type: '${e.type}',`,
    `  },`,
  ]
  return lines.join('\n')
}

const rendered = entries.map(renderEntry).join('\n')

if (!writeMode) {
  console.log(`\n// ${entries.length} new entries found — paste at the top of CHANGELOG_ENTRIES:\n`)
  console.log(rendered)
  console.log()
  process.exit(0)
}

// ── Write mode: insert at top of CHANGELOG_ENTRIES array ────────────────────

// Find the opening bracket of the array
const insertMarker = 'export const CHANGELOG_ENTRIES: ChangelogEntry[] = ['
const idx = changelogSrc.indexOf(insertMarker)
if (idx === -1) {
  console.error('ERROR: Could not find CHANGELOG_ENTRIES array in changelog.ts')
  process.exit(1)
}

const insertPos = idx + insertMarker.length
const before = changelogSrc.slice(0, insertPos)
const after = changelogSrc.slice(insertPos)

const updated = before + '\n' + rendered + after

writeFileSync(CHANGELOG_PATH, updated, 'utf-8')
console.log(`Wrote ${entries.length} new entries to changelog.ts`)
entries.forEach((e) => console.log(`  + [${e.date}] ${e.title}`))
