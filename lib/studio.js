/**
 * Preview Studio state: one live preview per agent Session, its loopback
 * server, file watcher, element selections, pending adjustments, and the
 * user-confirmed release gate.
 *
 * @module @local/preview-studio/studio
 */
import path from 'node:path'
import crypto from 'node:crypto'
import { watch, promises as fsp } from 'node:fs'
import { startPreviewServer } from './preview-server.js'
import { findSourceCandidates } from './source-map.js'

const WATCH_IGNORES = ['node_modules', '.git', '.hg', '.dsh', '.dsh-preview']
const MAX_CHANGES = 20
const MAX_INJECT_ITEMS = 6

const PACKAGING_PATTERN = new RegExp(
  [
    'electron-builder', 'electron-forge', 'electron-packager', '@electron/packager',
    'tauri\\s+build', 'cargo\\s+tauri', 'flutter\\s+build\\s+(apk|appbundle|aab|windows|ios|ipa)',
    'gradlew(?:\\.bat)?\\s+(assemble|bundle)', 'gradle\\s+(assemble|bundle)',
    'pyinstaller', 'nuitka', 'makensis', 'iscc(?:\\.exe)?', 'dotnet\\s+publish',
    'msbuild', 'expo\\s+build', 'eas\\s+build', 'capacitor\\s+build',
    'build\\.ps1', 'build\\.bat', 'build\\.cmd',
  ].join('|'),
  'i',
)

const EXEC_TOOLS = new Set(['bash', 'pwsh', 'terminal_open', 'terminal_send', 'terminal_write'])

/**
 * Read a JSON request body with a hard size limit.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 */
async function readJson(req, limit = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function short(value, length = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function elementLabel(selection) {
  if (!selection || typeof selection !== 'object') return 'element'
  const tag = typeof selection.tag === 'string' ? selection.tag : 'element'
  const id = typeof selection.id === 'string' && selection.id.length > 0 ? `#${selection.id}` : ''
  const classes = Array.isArray(selection.classes) ? selection.classes.slice(0, 2).map((name) => `.${name}`).join('') : ''
  const text = typeof selection.text === 'string' && selection.text.length > 0 ? ` "${short(selection.text, 40)}"` : ''
  return `${tag}${id}${classes}${text}`
}

function describeChanges(values) {
  if (!values || typeof values !== 'object') return 'no values'
  const parts = []
  if (Number.isFinite(values.x) && values.x !== 0) parts.push(`x:${values.x > 0 ? '+' : ''}${values.x}px`)
  if (Number.isFinite(values.y) && values.y !== 0) parts.push(`y:${values.y > 0 ? '+' : ''}${values.y}px`)
  if (Number.isFinite(values.width)) parts.push(`width:${values.width}px`)
  if (Number.isFinite(values.height)) parts.push(`height:${values.height}px`)
  if (Number.isFinite(values.rotation) && values.rotation !== 0) parts.push(`rotation:${values.rotation}deg`)
  if (Number.isFinite(values.fontSize)) parts.push(`fontSize:${values.fontSize}px`)
  if (typeof values.text === 'string') parts.push(`text:${JSON.stringify(short(values.text, 80))}`)
  if (typeof values.color === 'string') parts.push(`color:${values.color}`)
  if (typeof values.backgroundColor === 'string') parts.push(`background:${values.backgroundColor}`)
  return parts.length > 0 ? parts.join(' ') : 'no values'
}

/**
 * Recursively freeze one detached value, mirroring the Host's message helper.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Build one complete, identified user-role message for an agent inbox.
 *
 * `agent.inject()` and `agent.followup()` take a `UserMessage`, not just its
 * content: the inbox keys pending work by the message id and reads the role,
 * so a bare `{ content, source }` is not enough. The source must also be
 * producer-owned: format v4 rejects the retired V3 `{ kind: 'plugin', plugin }`
 * shape, and a plugin's pushed context is a `runtime-context` source instead.
 *
 * @param {string} text
 * @param {Record<string, unknown> & { kind: string }} source
 */
function agentMessage(text, source) {
  return deepFreeze(structuredClone({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }))
}

/**
 * Owns every live preview in this Host process.
 */
export class PreviewStudio {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   */
  constructor(ctx) {
    this.ctx = ctx
    /** @type {Map<string, object>} */
    this.previews = new Map()
    /** @type {string[]} */
    this.order = []
    this.activeId = undefined
    this.inspectorSource = ''
    this.disposed = false
  }

  /** Load the injected inspector script once. */
  async initialize() {
    const url = new URL('../preview-inspector.js', import.meta.url)
    this.inspectorSource = await fsp.readFile(url, 'utf8')
  }

  /** Preview for one agent Session. */
  forSession(sessionId) {
    for (const preview of this.previews.values()) {
      if (preview.sessionId === String(sessionId)) return preview
    }
    return undefined
  }

  /** The preview the floating panel currently shows. */
  active() {
    if (this.activeId === undefined) return undefined
    return this.previews.get(this.activeId)
  }

  byId(id) {
    return this.previews.get(String(id))
  }

  /**
   * Open (or replace) the live preview for one agent Session.
   * @param {object} agent - the calling Agent.
   * @param {{ root?: string, entry?: string, target?: 'exe'|'apk', title?: string, build?: string }} args
   */
  async open(agent, args) {
    if (this.disposed) throw new Error('preview studio is disposed')
    // Re-read the inspector on every open so inspector updates apply without
    // reloading the Host plugin.
    await this.initialize()
    const sessionId = String(agent.id)

    let root = args.root === undefined ? '' : String(args.root).trim()
    if (root.length === 0) throw new Error('preview_studio open requires `root`: the directory that contains the web build (or an HTML file).')
    const cwd = await this.ctx.workingDirectory.ensure(agent)
    let absolute = path.isAbsolute(root) ? path.normalize(root) : path.resolve(cwd, root)

    let entry = typeof args.entry === 'string' && args.entry.trim().length > 0 ? args.entry.trim() : 'index.html'
    let info = await fsp.stat(absolute).catch(() => undefined)
    if (info?.isFile()) {
      if (!/\.html?$/i.test(absolute)) throw new Error(`preview_studio expects a directory or an HTML file, got: ${root}`)
      entry = path.basename(absolute)
      absolute = path.dirname(absolute)
    } else if (!info?.isDirectory()) {
      throw new Error(`preview_studio root not found: ${root} (resolved to ${absolute})`)
    }

    entry = entry.split('\\').join('/').replace(/^\/+/, '')
    const entryPath = path.resolve(absolute, entry)
    if (!(await fsp.stat(entryPath).catch(() => undefined))?.isFile()) {
      const fallback = path.resolve(absolute, 'index.html')
      if ((await fsp.stat(fallback).catch(() => undefined))?.isFile()) {
        entry = 'index.html'
      } else {
        throw new Error(`preview_studio entry HTML not found: ${entry} under ${absolute}. Build the web assets first (for example "flutter build web" or the renderer's production build).`)
      }
    }

    const previous = this.forSession(sessionId)
    if (previous !== undefined) await this.closePreview(previous)

    const server = await startPreviewServer({
      root: absolute,
      entry,
      inspectorSource: this.inspectorSource,
    })

    const preview = {
      id: crypto.randomUUID(),
      sessionId,
      title: typeof args.title === 'string' && args.title.trim().length > 0 ? args.title.trim() : path.basename(absolute),
      target: args.target === 'apk' ? 'apk' : 'exe',
      root: absolute,
      entry,
      origin: server.origin,
      port: server.port,
      server: server.server,
      closeServer: server.close,
      url: `${server.origin}/${entry.split('/').map(encodeURIComponent).join('/')}`,
      revision: 1,
      confirmed: false,
      confirmedAt: undefined,
      // One-shot build permit created by release() and consumed by the tool
      // guard when the packaging command actually runs.
      buildPermit: undefined,
      // User-controlled bypass. Off by default; never persists across previews.
      skipConfirmation: false,
      built: undefined,
      buildCommand: typeof args.build === 'string' && args.build.trim().length > 0 ? args.build.trim() : undefined,
      selection: undefined,
      selections: [],
      changes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      watcher: undefined,
      watchTimer: undefined,
    }

    try {
      preview.watcher = watch(absolute, { recursive: true }, (_event, filename) => {
        if (this.disposed) return
        const name = typeof filename === 'string' ? filename.split(path.sep).join('/') : ''
        if (name.length > 0 && WATCH_IGNORES.some((part) => name.includes(part))) return
        clearTimeout(preview.watchTimer)
        preview.watchTimer = setTimeout(() => this.bump(preview, true), 450)
      })
      preview.watcher.on('error', () => {})
    } catch {
      // File watching is an enhancement; preview keeps working without it.
    }

    this.previews.set(preview.id, preview)
    this.order = this.order.filter((id) => id !== preview.id)
    this.order.push(preview.id)
    this.activeId = preview.id
    return this.summary(preview)
  }

  /**
   * Close the Session's preview.
   * @param {string} sessionId
   */
  async closeSession(sessionId) {
    const preview = this.forSession(sessionId)
    if (preview === undefined) return false
    await this.closePreview(preview)
    return true
  }

  /** Close one preview and every resource it owns. */
  async closePreview(preview) {
    clearTimeout(preview.watchTimer)
    try {
      preview.watcher?.close()
    } catch {
      // Already closed.
    }
    try {
      await preview.closeServer()
    } catch {
      // Already closed.
    }
    this.previews.delete(preview.id)
    this.order = this.order.filter((id) => id !== preview.id)
    if (this.activeId === preview.id) this.activeId = this.order[this.order.length - 1]
  }

  /**
   * Drop any approval and any unused one-shot build permit.
   * @param {object} preview
   */
  clearConfirmation(preview) {
    preview.confirmed = false
    preview.confirmedAt = undefined
    preview.buildPermit = undefined
  }

  /**
   * Bump the preview revision so connected panels reload it. A source change
   * or a saved adjustment invalidates the user's previous build confirmation:
   * the artifact would no longer match what they approved.
   * @param {object} preview
   * @param {boolean} [invalidateConfirmation]
   */
  bump(preview, invalidateConfirmation = false) {
    preview.revision += 1
    preview.updatedAt = Date.now()
    if (invalidateConfirmation) {
      this.clearConfirmation(preview)
    }
  }

  /** One model-facing summary of a preview. */
  summary(preview) {
    return {
      id: preview.id,
      title: preview.title,
      target: preview.target,
      entry: preview.entry,
      root: preview.root,
      url: preview.url,
      revision: preview.revision,
      confirmed: preview.confirmed,
      buildAuthorized: preview.buildPermit !== undefined,
      skipConfirmation: preview.skipConfirmation === true,
      built: preview.built,
      buildCommand: preview.buildCommand,
      sessionId: preview.sessionId,
      selectionCount: Array.isArray(preview.selections) ? preview.selections.length : preview.selection === undefined ? 0 : 1,
      changeCount: preview.changes.length,
      createdAt: preview.createdAt,
    }
  }

  /**
   * Record the panel's selection set, resolve candidate source locations for
   * each element, and keep the panel's primary element addressable.
   * @param {object} preview
   * @param {object[]} selections
   * @param {string} [primaryPath]
   */
  async recordSelections(preview, selections, primaryPath) {
    const list = []
    for (const selection of Array.isArray(selections) ? selections.slice(0, 20) : []) {
      if (!selection || typeof selection !== 'object') continue
      const candidates = await findSourceCandidates(preview.root, selection, { limit: 3 }).catch(() => [])
      list.push({ ...selection, candidates, at: Date.now() })
    }
    preview.selections = list
    preview.selection = list.find((entry) => entry.path === primaryPath) ?? list[list.length - 1]
    preview.updatedAt = Date.now()
    return list
  }

  /**
   * Backward-compatible single-selection entry.
   * @param {object} preview
   * @param {object} selection
   */
  async recordSelection(preview, selection) {
    const list = await this.recordSelections(preview, [selection])
    return list[0]
  }

  /**
   * Record adjustments made in the preview panel.
   * @param {object} preview
   * @param {Array<{ selection: object, values: object }>} changes
   */
  recordChanges(preview, changes) {
    const normalized = []
    for (const change of Array.isArray(changes) ? changes : []) {
      if (!change || typeof change !== 'object') continue
      if (!change.selection || typeof change.selection !== 'object') continue
      if (!change.values || typeof change.values !== 'object') continue
      normalized.push({ selection: change.selection, values: change.values })
      if (normalized.length >= MAX_CHANGES) break
    }
    preview.changes = normalized
    preview.updatedAt = Date.now()
    if (normalized.length > 0) {
      // A new visual change means the previously approved build is stale.
      this.clearConfirmation(preview)
    }
  }

  /**
   * Build the per-Session dynamic prompt context describing the current
   * preview selection and adjustments. Registered through `systemPrompt`
   * on each agent's scoped context, so it reaches the model as runtime
   * context on the next step without writing an inbox message.
   * @param {string} sessionId
   * @returns {string} context text, or an empty string when there is nothing to report.
   */
  promptContext(sessionId) {
    const preview = this.forSession(sessionId)
    if (preview === undefined) return ''
    const selections = Array.isArray(preview.selections) && preview.selections.length > 0
      ? preview.selections
      : preview.selection === undefined ? [] : [preview.selection]
    const hasSelection = selections.length > 0
    const hasChanges = preview.changes.length > 0
    if (!hasSelection && !hasChanges) return ''

    const gate = preview.skipConfirmation
      ? 'no-confirm mode is ON (the user allows packaging directly)'
      : preview.confirmed
        ? 'confirmed for exactly one build'
        : 'pending (one confirmation per build)'
    const lines = [
      `[Preview Studio] Live preview "${preview.title}" (${preview.target.toUpperCase()}) is open. User build confirmation: ${gate}.`,
    ]
    if (hasSelection) {
      lines.push(`Selected elements (${selections.length}); the last one is the adjust-mode primary:`)
      for (const selection of selections.slice(0, 6)) {
        lines.push(`- ${elementLabel(selection)} · selector: ${selection.path ?? '(unknown)'}`)
        const candidates = Array.isArray(selection.candidates) ? selection.candidates.slice(0, 3) : []
        if (candidates.length > 0) {
          lines.push(`  sources: ${candidates.map((entry) => `${entry.path}:${entry.line}`).join(', ')}`)
        }
      }
      if (selections.length > 6) lines.push(`…and ${selections.length - 6} more; call preview_inspect for the full list.`)
    }
    if (hasChanges) {
      lines.push(`Pending adjustments (${preview.changes.length}); project files are not updated yet:`)
      for (const change of preview.changes.slice(0, MAX_INJECT_ITEMS)) {
        const candidate = change.selection?.candidates?.[0]
        const location = candidate === undefined ? '' : ` @ ${candidate.path}:${candidate.line}`
        lines.push(`- ${elementLabel(change.selection)}${location}: ${describeChanges(change.values)}`)
      }
      lines.push('Apply these at the code level, preserve the rest of the design, then call preview_ack.')
    } else {
      lines.push("The user will describe the change; call preview_inspect for full locators before editing.")
    }
    return lines.join('\n')
  }

  /**
   * Wake the owning agent after the user confirms in the panel.
   * @param {object} preview
   */
  wakeForConfirmation(preview) {
    const agent = this.ctx.get('agents')?.get(preview.sessionId)
    if (agent === undefined || typeof agent.followup !== 'function') return false
    try {
      agent.followup(agentMessage(
        `用户已在实时预览窗口点击“确认生成”。预览「${preview.title}」已确认，本次生成有效；请先调用 preview_release 获取状态和打包命令，然后执行一次打包。生成后需要用户再次确认。`,
        { kind: 'user' },
      ))
      return true
    } catch {
      return false
    }
  }

  /**
   * Build the model-facing inspection payload for the calling Session.
   * @param {object} agent
   */
  async inspect(agent, options = {}) {
    const preview = this.forSession(agent.id)
    if (preview === undefined) return undefined
    const limit = Number.isInteger(options.limit) ? Math.max(1, Math.min(10, options.limit)) : 5
    const changes = []
    for (const change of preview.changes) {
      let candidates = change.selection?.candidates
      if (!Array.isArray(candidates) || candidates.length === 0) {
        candidates = await findSourceCandidates(preview.root, change.selection, { limit }).catch(() => [])
      }
      changes.push({
        element: elementLabel(change.selection),
        selector: change.selection?.path,
        values: change.values,
        description: describeChanges(change.values),
        candidates: candidates ?? [],
      })
    }
    const selections = Array.isArray(preview.selections) && preview.selections.length > 0
      ? preview.selections
      : preview.selection === undefined ? [] : [preview.selection]
    return {
      ...this.summary(preview),
      selection: preview.selection === undefined
        ? undefined
        : {
            element: elementLabel(preview.selection),
            locator: preview.selection,
            candidates: preview.selection.candidates ?? [],
          },
      selections: selections.map((entry) => ({
        element: elementLabel(entry),
        locator: entry,
        candidates: entry.candidates ?? [],
      })),
      changes,
    }
  }

  /**
   * Mark pending adjustments as applied and refresh the panel. With `paths`,
   * only those elements are acknowledged and every other pending adjustment
   * stays pending for the user.
   * @param {object} agent
   * @param {string} [note]
   * @param {string[]} [paths]
   */
  acknowledge(agent, note, paths) {
    const preview = this.forSession(agent.id)
    if (preview === undefined) return undefined
    const count = preview.changes.length
    if (Array.isArray(paths) && paths.length > 0) {
      const acknowledged = new Set(paths.filter((path) => typeof path === 'string' && path.length > 0))
      preview.changes = preview.changes.filter((change) => !acknowledged.has(change.selection?.path))
    } else {
      preview.changes = []
      preview.selection = undefined
      preview.selections = []
    }
    const applied = count - preview.changes.length
    this.clearConfirmation(preview)
    this.bump(preview, false)
    if (typeof note === 'string' && note.trim().length > 0) {
      preview.lastNote = note.trim()
    }
    return {
      applied,
      remaining: preview.changes.length,
      revision: preview.revision,
      note: preview.lastNote,
    }
  }

  /**
   * Return the release gate state for the calling Session.
   * @param {object} agent
   */
  release(agent) {
    const preview = this.forSession(agent.id)
    if (preview === undefined) {
      return {
        ok: false,
        confirmed: false,
        message: 'No live preview is open for this Session. Open one with preview_studio before packaging.',
      }
    }
    if (preview.changes.length > 0) {
      return {
        ok: false,
        previewId: preview.id,
        target: preview.target,
        buildCommand: preview.buildCommand,
        confirmed: false,
        message: `Packaging is blocked: ${preview.changes.length} preview adjustment(s) are still not written into the project files. Call preview_inspect, edit the source, then preview_ack; after the preview reloads with the saved result, the user can confirm.`,
      }
    }
    if (preview.skipConfirmation) {
      return {
        ok: true,
        previewId: preview.id,
        target: preview.target,
        buildCommand: preview.buildCommand,
        confirmed: true,
        authorized: true,
        skipConfirmation: true,
        message: 'No-confirm mode is on (the user enabled “无需确认”). Run the planned packaging command now; no per-build confirmation is required while this mode stays on.',
      }
    }
    if (!preview.confirmed) {
      return {
        ok: false,
        previewId: preview.id,
        target: preview.target,
        buildCommand: preview.buildCommand,
        confirmed: false,
        skipConfirmation: false,
        message: 'Packaging is blocked: each build needs a fresh confirmation. Ask the user to click “确认生成 / Confirm build” in the preview panel, then call preview_release again.',
      }
    }
    // Consume the one-shot confirmation now. buildPermit lets the actual
    // packaging command pass the guard; the guard clears it after one run.
    preview.confirmed = false
    preview.confirmedAt = undefined
    preview.buildPermit = Date.now()
    preview.updatedAt = Date.now()
    return {
      ok: true,
      previewId: preview.id,
      target: preview.target,
      buildCommand: preview.buildCommand,
      confirmed: true,
      authorized: true,
      skipConfirmation: false,
      consumed: true,
      message: 'The user confirmed this single build, and the confirmation has been consumed. Run the planned packaging command now; the next build needs a new confirmation.',
    }
  }

  /** Record a produced artifact so the panel can show it. */
  markBuilt(agent, artifact) {
    const preview = this.forSession(agent.id)
    if (preview === undefined) return undefined
    preview.built = { path: artifact ?? '', at: Date.now() }
    this.clearConfirmation(preview)
    preview.updatedAt = Date.now()
    return this.summary(preview)
  }

  /**
   * Deny packaging commands while the preview is unconfirmed.
   * @param {import('@deepseek-ai/dsh-tools').ToolExecution} execution
   */
  guard(execution) {
    if (!EXEC_TOOLS.has(execution.name)) return undefined
    const preview = execution.agent === undefined ? undefined : this.forSession(execution.agent.id)
    if (preview === undefined) return undefined
    const args = execution.arguments
    if (args === null || typeof args !== 'object') return undefined
    const text = [args.command, args.input, args.data, args.script, args.cmd, args.text]
      .filter((value) => typeof value === 'string')
      .join('\n')
    if (!PACKAGING_PATTERN.test(text)) return undefined
    if (preview.changes.length > 0) {
      return 'Preview Studio: the preview still has unsaved adjustments. Apply them to the project files, call preview_ack, and only then package.'
    }
    if (preview.skipConfirmation) return undefined
    if (preview.buildPermit !== undefined) {
      const age = Date.now() - preview.buildPermit
      preview.buildPermit = undefined
      preview.updatedAt = Date.now()
      if (age <= 5 * 60 * 1000) return undefined
    }
    if (preview.confirmed) {
      // The user confirmed and the model ran the packaging command without
      // calling release first: honor that one confirmation, then consume it.
      preview.confirmed = false
      preview.confirmedAt = undefined
      preview.updatedAt = Date.now()
      return undefined
    }
    return 'Preview Studio blocks packaging: each build needs its own confirmation. Ask the user to click “确认生成 / Confirm build” in the live preview window (or enable “无需确认”), then call preview_release and run the command it returns.'
  }

  /** HTTP surface used by the floating preview panel (same origin as the app). */
  async handleHttp(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/preview-studio/state' && (req.method === 'GET' || req.method === 'HEAD')) {
        const preview = this.active()
        sendJson(res, 200, {
          ok: true,
          preview: preview === undefined
            ? null
            : { ...this.summary(preview), changes: preview.changes },
        })
        return
      }
      if (url.pathname !== '/preview-studio/api') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Method not allowed')
        return
      }
      const body = await readJson(req)
      const action = typeof body.action === 'string' ? body.action : ''
      const preview = body.previewId === undefined ? this.active() : this.byId(body.previewId)

      if (action === 'state') {
        sendJson(res, 200, {
          ok: true,
          preview: preview === undefined
            ? null
            : { ...this.summary(preview), changes: preview.changes },
        })
        return
      }
      if (preview === undefined) {
        sendJson(res, 404, { ok: false, reason: 'no-active-preview' })
        return
      }

      switch (action) {
        case 'select': {
          const list = Array.isArray(body.selections)
            ? body.selections
            : body.selection !== null && typeof body.selection === 'object'
              ? [body.selection]
              : null
          if (list === null) {
            sendJson(res, 400, { ok: false, reason: 'invalid-selection' })
            return
          }
          const selections = await this.recordSelections(preview, list, body.primaryPath)
          const primary = selections.find((entry) => entry.path === body.primaryPath)
            ?? selections[selections.length - 1]
          sendJson(res, 200, {
            ok: true,
            selectionCount: selections.length,
            candidates: primary?.candidates ?? [],
          })
          return
        }
        case 'changes': {
          this.recordChanges(preview, body.changes)
          sendJson(res, 200, { ok: true, changeCount: preview.changes.length, revision: preview.revision })
          return
        }
        case 'confirm': {
          if (preview.changes.length > 0) {
            sendJson(res, 409, {
              ok: false,
              reason: 'changes-pending',
              changeCount: preview.changes.length,
            })
            return
          }
          if (!preview.confirmed) {
            preview.confirmed = true
            preview.confirmedAt = Date.now()
            preview.buildPermit = undefined
            preview.updatedAt = Date.now()
            if (!preview.skipConfirmation) this.wakeForConfirmation(preview)
          }
          sendJson(res, 200, {
            ok: true,
            confirmed: true,
            skipConfirmation: preview.skipConfirmation === true,
            target: preview.target,
          })
          return
        }
        case 'skip': {
          const enabled = body.enabled === true
          preview.skipConfirmation = enabled
          // Toggling either way drops any stale approval or unused permit:
          // turning it off must never inherit the "skip" behavior.
          this.clearConfirmation(preview)
          preview.updatedAt = Date.now()
          sendJson(res, 200, {
            ok: true,
            skipConfirmation: enabled,
            confirmed: false,
          })
          return
        }
        case 'revoke': {
          this.clearConfirmation(preview)
          preview.updatedAt = Date.now()
          sendJson(res, 200, { ok: true, confirmed: false })
          return
        }
        case 'reload': {
          this.bump(preview)
          sendJson(res, 200, { ok: true, revision: preview.revision })
          return
        }
        case 'close': {
          await this.closePreview(preview)
          sendJson(res, 200, { ok: true })
          return
        }
        default:
          sendJson(res, 400, { ok: false, reason: `unknown action: ${action}` })
      }
    } catch (error) {
      try {
        sendJson(res, 500, { ok: false, reason: error instanceof Error ? error.message : String(error) })
      } catch {
        res.destroy()
      }
    }
  }

  /** Release every preview server and watcher. */
  async dispose() {
    this.disposed = true
    const previews = [...this.previews.values()]
    this.previews.clear()
    this.order = []
    this.activeId = undefined
    await Promise.allSettled(previews.map((preview) => this.closePreview(preview)))
  }
}
