/**
 * Best-effort source lookup for an element selected in the live preview.
 *
 * The preview renders a built app, so exact source maps are not guaranteed.
 * This module ranks source lines that contain the element's identifying
 * strings (text, id, test id, classes, attributes). The agent uses the
 * candidates as starting points and confirms them by reading the files.
 *
 * @module @local/preview-studio/source-map
 */
import path from 'node:path'
import { promises as fsp } from 'node:fs'

const SOURCE_EXTENSIONS = new Set([
  '.html', '.htm', '.vue', '.svelte', '.jsx', '.tsx', '.js', '.mjs', '.cjs', '.ts',
  '.css', '.scss', '.sass', '.less', '.styl', '.dart', '.kt', '.kts', '.java', '.xml',
  '.swift', '.cs', '.xaml', '.razor', '.qml', '.ui', '.py', '.go', '.rs', '.json',
])

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', '.dart_tool', '.gradle', '.idea', '.vscode',
  'target', 'Pods', '.next', '.nuxt', 'build', 'dist', 'out', 'obj', 'bin', '__pycache__',
  'coverage', '.dsh-preview', '.dsh',
])

const MAX_FILES = 4000
const MAX_FILE_BYTES = 1_000_000
const MAX_CANDIDATES = 6

/**
 * Collect source lines that plausibly define the selected element.
 * @param {string} root - project directory.
 * @param {object} selection - the inspector's selection descriptor.
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array<{ path: string, line: number, text: string, score: number }>>}
 */
export async function findSourceCandidates(root, selection, options = {}) {
  const limit = options.limit ?? MAX_CANDIDATES
  const needles = buildNeedles(selection)
  if (needles.length === 0) return []

  /** @type {Array<{ file: string, text: string }>} */
  const files = []
  await collectFiles(root, root, files, MAX_FILES)
  if (files.length === 0) return []

  const ranked = []
  for (const file of files) {
    if (!needles.some((needle) => file.text.includes(needle.value) || file.text.toLowerCase().includes(needle.value.toLowerCase()))) continue
    const lines = file.text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (line.length > 600) continue
      let score = 0
      let matched = 0
      for (const needle of needles) {
        if (!line.includes(needle.value)) continue
        score += needle.weight
        matched++
      }
      if (matched === 0) continue
      ranked.push({
        path: path.relative(root, file.file).split(path.sep).join('/'),
        line: index + 1,
        text: line.trim().slice(0, 240),
        score,
      })
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
  const output = []
  const seen = new Set()
  for (const candidate of ranked) {
    const key = `${candidate.path}:${candidate.line}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(candidate)
    if (output.length >= limit) break
  }
  return output
}

/**
 * Build weighted search needles from a selection descriptor.
 * @param {object} selection
 */
function buildNeedles(selection) {
  const needles = []
  const push = (value, weight) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length < 2 || trimmed.length > 120) return
    if (trimmed.includes('\n')) return
    if (needles.some((entry) => entry.value === trimmed)) return
    needles.push({ value: trimmed, weight })
  }

  const attrs = selection?.attrs ?? {}
  for (const key of ['data-source', 'data-dsh-source', 'data-testid', 'data-test', 'data-qa']) {
    push(attrs[key], 8)
  }
  push(attrs.id ?? selection?.id, 6)
  push(attrs.name, 4)
  push(attrs.placeholder, 4)
  push(attrs['aria-label'], 4)
  push(selection?.text, 5)

  if (Array.isArray(selection?.classes)) {
    for (const name of selection.classes.slice(0, 3)) {
      if (typeof name !== 'string' || name.length < 3 || name.length > 40) continue
      if (/^(css-|sc-|jsx-|svelte-|_)[\w-]*$/i.test(name)) continue
      push(name, 2)
    }
  }

  const href = attrs.href ?? attrs.src
  if (typeof href === 'string') {
    const base = href.split(/[?#]/)[0].split('/').pop()
    if (base !== undefined && base.length >= 3 && base.length <= 60) push(base, 1)
  }

  return needles
}

/**
 * Walk the project, collecting small text files, skipping generated trees.
 * @param {string} root
 * @param {string} directory
 * @param {Array<{ file: string, text: string }>} output
 * @param {number} maxFiles
 */
async function collectFiles(root, directory, output, maxFiles) {
  if (output.length >= maxFiles) return
  let entries
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (output.length >= maxFiles) return
    if (entry.name.startsWith('.') && entry.name !== '.env') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      await collectFiles(root, full, output, maxFiles)
      continue
    }
    if (!entry.isFile()) continue
    const extension = path.extname(entry.name).toLowerCase()
    if (!SOURCE_EXTENSIONS.has(extension)) continue
    try {
      const info = await fsp.stat(full)
      if (info.size === 0 || info.size > MAX_FILE_BYTES) continue
      const text = await fsp.readFile(full, 'utf8')
      if (text.includes('\u0000')) continue
      output.push({ file: full, text })
    } catch {
      // Unreadable files are not candidates.
    }
  }
}
