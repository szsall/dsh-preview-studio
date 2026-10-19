/**
 * Preview Studio — a live, inspectable app window for EXE/APK work.
 *
 * The Host half serves the project's web build on a loopback origin, exposes
 * the preview state to the floating panel, injects selected elements and
 * adjustments into the owning agent, and gates packaging behind the user's
 * confirmation in the panel.
 *
 * @module @local/preview-studio
 */
import { PreviewStudio } from './lib/studio.js'

/** Stable Loader identity. */
export const name = 'preview-studio'

/** Host services used by the preview workflow. */
export const inject = ['webServer', 'tools', 'systemPrompt', 'workingDirectory']

const PROMPT = `Preview Studio policy for desktop (EXE) and Android (APK) apps:
Before packaging an app, show it live. Make its UI runnable as static web assets (production web build; Flutter: \`flutter build web\`; Electron/Tauri: the renderer build; native-only screens: a faithful web render of the same layout), then call preview_studio (action "open") with the build directory, the entry HTML, target "exe" or "apk", and the packaging command you plan to run. Tell the user the live window is open.
The user can select elements or adjust size, position, rotation, text, and color there. Call preview_inspect, edit the reported source locations precisely, then preview_ack. Run packaging only after preview_release returns the user's authorization. Each confirmation approves exactly one build: preview_release consumes it, and the next build needs a fresh confirmation. If the user enables “无需确认 / No confirm” in the panel, packaging is allowed directly until they turn it off.`

const PREVIEW_STATE_PROPERTIES = {
  ok: { type: 'boolean', description: 'Whether the action succeeded.' },
  message: { type: 'string', description: 'Short human-readable outcome.' },
  previewId: { type: 'string' },
  title: { type: 'string' },
  target: { type: 'string', enum: ['exe', 'apk'] },
  url: { type: 'string', description: 'Loopback URL shown in the live window.' },
  root: { type: 'string' },
  revision: { type: 'integer' },
  confirmed: { type: 'boolean' },
  buildAuthorized: { type: 'boolean', description: 'A one-shot confirmation is approved for the next packaging command.' },
  skipConfirmation: { type: 'boolean', description: 'The user enabled “无需确认” and packaging is allowed without per-build confirmation.' },
  built: { type: 'string' },
  selectionCount: { type: 'integer' },
  changeCount: { type: 'integer' },
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Normalize the preview summary into a compact tool value.
 * @param {object | undefined} summary
 */
function toolValue(summary) {
  if (summary === undefined) {
    return { ok: false, message: 'No live preview is open for this Session.' }
  }
  const value = {
    ok: true,
    message: `Live preview "${summary.title}" is served at ${summary.url}`,
    previewId: summary.id,
    title: summary.title,
    target: summary.target,
    url: summary.url,
    root: summary.root,
    revision: summary.revision,
    confirmed: summary.confirmed,
    buildAuthorized: summary.buildAuthorized === true,
    skipConfirmation: summary.skipConfirmation === true,
    selectionCount: summary.selectionCount,
    changeCount: summary.changeCount,
  }
  if (summary.built !== undefined && typeof summary.built.path === 'string' && summary.built.path.length > 0) {
    value.built = summary.built.path
  }
  return value
}

/**
 * @param {object} value
 */
function renderState(_args, value) {
  const lines = [value.message]
  if (value.target !== undefined) lines.push(`Target: ${String(value.target).toUpperCase()}`)
  if (value.root !== undefined) lines.push(`Root: ${value.root}`)
  if (value.revision !== undefined) lines.push(`Revision: ${value.revision}`)
  if (value.selectionCount !== undefined || value.changeCount !== undefined) {
    lines.push(`Selected: ${value.selectionCount ?? 0}; pending adjustments: ${value.changeCount ?? 0}`)
  }
  if (value.confirmed !== undefined) lines.push(`User confirmed: ${value.confirmed ? 'yes (this build only)' : 'no'}`)
  if (value.skipConfirmation === true) lines.push('No-confirm mode: on')
  if (value.buildAuthorized === true) lines.push('Build authorized for the next packaging command')
  if (value.built !== undefined) lines.push(`Artifact: ${value.built}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * Register the preview workflow on this Host composition.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const studio = new PreviewStudio(ctx)
  const registerTool = (tool) => ctx.effect(() => ctx.tools.register(tool), `preview-studio: tool ${tool.name}`)

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/preview-studio',
      handler: (req, res) => studio.handleHttp(req, res),
    }),
    'preview-studio: panel API',
  )

  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'preview-studio', order: 2560, text: PROMPT }),
    'preview-studio: prompt policy',
  )

  ctx.effect(
    () => ctx.tools.guard((execution) => studio.guard(execution)),
    'preview-studio: packaging gate',
  )

  /**
   * Per-agent dynamic context: the panel's selection and adjustments reach
   * the model as runtime context on the next step, without appending a
   * user-role inbox message (format v4 rejects the retired `plugin` source).
   * @type {Map<string, () => void>}
   */
  const previewContexts = new Map()

  /**
   * Register the dynamic preview context on one agent's scoped context.
   * Called for live agents at activation and for every new agent.
   * @param {object} agent
   */
  const registerAgentContext = (agent) => {
    if (!agent || typeof agent.id !== 'string' || !agent.ctx) return
    const previous = previewContexts.get(agent.id)
    if (typeof previous === 'function') {
      try {
        previous()
      } catch {
        // Already disposed with the agent.
      }
    }
    try {
      const dispose = agent.ctx.effect(
        () => agent.ctx.systemPrompt.context({
          name: 'preview-studio',
          order: 250,
          text: () => {
            try {
              return studio.promptContext(agent.id)
            } catch {
              return ''
            }
          },
        }),
        'preview-studio: session context',
      )
      previewContexts.set(agent.id, dispose)
    } catch {
      // A disposed agent scope cannot take new registrations.
    }
  }

  ctx.effect(
    () => ctx.inject(['agents'], (scope) => {
      for (const agent of scope.agents.list()) registerAgentContext(agent)
    }),
    'preview-studio: existing agents',
  )

  ctx.on('agent/created', ({ agent }) => registerAgentContext(agent))

  ctx.on('agent/disposed', ({ agent }) => {
    const dispose = previewContexts.get(agent.id)
    previewContexts.delete(agent.id)
    if (typeof dispose === 'function') {
      try {
        dispose()
      } catch {
        // Agent scope already unwound.
      }
    }
    void studio.closeSession(agent.id)
  })

  ctx.effect(() => () => {
    for (const dispose of previewContexts.values()) {
      try {
        dispose()
      } catch {
        // Agent scope already unwound.
      }
    }
    previewContexts.clear()
  }, 'preview-studio: context cleanup')

  registerTool({
    name: 'preview_studio',
    description: 'Open, refresh, close, or report the live app preview for this Session. Use action "open" before packaging any EXE or APK: it serves the app\'s web build on a loopback origin and shows the floating live window, where the user can try the app, select elements, and adjust layout. Packaging commands stay blocked until the user confirms in that window.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'status', 'refresh', 'close', 'built'],
          description: 'open: start/replace the preview. status: read its state. refresh: reload the window. close: stop it. built: record the produced artifact path.',
        },
        root: {
          type: 'string',
          description: 'Directory containing the web build (or one HTML file). Relative paths use the Session working directory. Required for action "open".',
        },
        entry: {
          type: 'string',
          description: 'Entry HTML relative to root; defaults to index.html.',
        },
        target: {
          type: 'string',
          enum: ['exe', 'apk'],
          description: 'Which final artifact the preview stands in for. Defaults to exe.',
        },
        title: {
          type: 'string',
          description: 'App name shown in the preview window.',
        },
        build: {
          type: 'string',
          description: 'The packaging command planned for after confirmation, for example "flutter build apk --release"; shown in the window and returned by preview_release.',
        },
        artifact: {
          type: 'string',
          description: 'Produced EXE/APK path for action "built".',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: PREVIEW_STATE_PROPERTIES,
        required: ['ok', 'message'],
      },
      render: renderState,
    },
    async execute(args, exec) {
      if (!isRecord(args)) throw new Error('preview_studio expects an arguments object')
      if (exec.agent === undefined) throw new Error('preview_studio requires an agent Session')
      const action = args.action
      switch (action) {
        case 'open': {
          if (typeof args.root !== 'string' || args.root.trim().length === 0) {
            throw new Error('preview_studio open requires `root` (the web build directory or an HTML file)')
          }
          const summary = await studio.open(exec.agent, {
            root: args.root,
            entry: typeof args.entry === 'string' ? args.entry : undefined,
            target: args.target === 'apk' ? 'apk' : 'exe',
            title: typeof args.title === 'string' ? args.title : undefined,
            build: typeof args.build === 'string' ? args.build : undefined,
          })
          const value = toolValue(summary)
          value.message = `Live preview "${summary.title}" is open at ${summary.url}. Invite the user to try it and to use the 选择/调整 modes; packaging remains blocked until they confirm in the window.`
          return value
        }
        case 'status': {
          const summary = studio.forSession(exec.agent.id)
          return toolValue(summary === undefined ? undefined : studio.summary(summary))
        }
        case 'refresh': {
          const preview = studio.forSession(exec.agent.id)
          if (preview === undefined) return { ok: false, message: 'No live preview is open for this Session.' }
          studio.bump(preview)
          return toolValue(studio.summary(preview))
        }
        case 'close': {
          const closed = await studio.closeSession(exec.agent.id)
          return { ok: true, message: closed ? 'Live preview closed.' : 'No live preview was open.' }
        }
        case 'built': {
          const preview = studio.forSession(exec.agent.id)
          if (preview === undefined) return { ok: false, message: 'No live preview is open for this Session.' }
          const summary = studio.markBuilt(exec.agent, typeof args.artifact === 'string' ? args.artifact : '')
          return toolValue(summary)
        }
        default:
          throw new Error(`preview_studio: unknown action ${String(action)}`)
      }
    },
  })

  registerTool({
    name: 'preview_inspect',
    description: 'Read what the user selected and adjusted in the live preview window: every selected element (multi-select supported), DOM selectors, requested size/position/rotation/font-size/text/color changes, and candidate source file locations. Call this when the user refers to a selected element or asks to apply preview adjustments, before editing project files.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        include_code: {
          type: 'boolean',
          description: 'Resolve candidate source locations for changed elements. Defaults to true.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum candidate locations per element, 1 to 10; default 5.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'Preview id, selected elements, and pending changes with candidate source locations.',
      },
      render(_args, value) {
        if (value.ok === false && typeof value.message === 'string') return [{ type: 'text', text: value.message }]
        const lines = []
        const selected = Array.isArray(value.selections)
          ? value.selections
          : value.selection === undefined ? [] : [value.selection]
        if (selected.length > 0) {
          lines.push(`Selected elements (${selected.length}), last one is the adjust-mode primary:`)
          for (const entry of selected.slice(0, 10)) {
            lines.push(`- ${entry.element}`)
            if (Array.isArray(entry.candidates) && entry.candidates.length > 0) {
              lines.push(`  candidates: ${entry.candidates.map((candidate) => `${candidate.path}:${candidate.line}`).join(', ')}`)
            }
            lines.push(`  locator: ${JSON.stringify(entry.locator?.path ?? entry.locator)}`)
          }
        } else {
          lines.push('No element selection recorded.')
        }
        if (Array.isArray(value.changes) && value.changes.length > 0) {
          lines.push(`Pending adjustments (${value.changes.length}):`)
          for (const [index, change] of value.changes.entries()) {
            lines.push(`${index + 1}. ${change.element} — ${change.description}`)
            if (Array.isArray(change.candidates) && change.candidates.length > 0) {
              for (const candidate of change.candidates.slice(0, 3)) {
                lines.push(`   ${candidate.path}:${candidate.line}: ${candidate.text}`)
              }
            }
          }
        } else {
          lines.push('No pending adjustments.')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('preview_inspect requires an agent Session')
      const limit = typeof args?.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(10, Math.trunc(args.limit)))
        : 5
      const inspected = await studio.inspect(exec.agent, { limit })
      if (inspected === undefined) {
        return { ok: false, message: 'No live preview is open for this Session. Call preview_studio (action "open") first.' }
      }
      return JSON.parse(JSON.stringify(inspected))
    },
  })

  registerTool({
    name: 'preview_ack',
    description: 'Confirm that preview adjustments have been applied to the project files. Clears every pending adjustment, or only the listed element paths, and reloads the live window. Call it after editing the files, with a one-line note of what changed. Pass `paths` when only some elements were applied so the other pending adjustments are kept.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: {
          type: 'string',
          description: 'One-line summary of what was changed, shown in the preview panel.',
        },
        paths: {
          type: 'array',
          description: 'Element DOM paths that were applied. Omit to acknowledge every pending adjustment.',
          items: { type: 'string' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          applied: { type: 'integer' },
          remaining: { type: 'integer' },
          revision: { type: 'integer' },
        },
        required: ['ok', 'message'],
      },
      render(_args, value) {
        return [{ type: 'text', text: value.message }]
      },
    },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('preview_ack requires an agent Session')
      const paths = Array.isArray(args?.paths) ? args.paths.filter((path) => typeof path === 'string') : undefined
      const result = studio.acknowledge(exec.agent, typeof args?.note === 'string' ? args.note : undefined, paths)
      if (result === undefined) return { ok: false, message: 'No live preview is open for this Session.' }
      return {
        ok: true,
        message: `Applied ${result.applied} preview adjustment(s); ${result.remaining} still pending.${result.note === undefined ? '' : ` Note: ${result.note}`}`,
        applied: result.applied,
        remaining: result.remaining,
        revision: result.revision,
      }
    },
  })

  registerTool({
    name: 'preview_release',
    description: 'Check and consume the release gate before packaging. Returns confirmed=true for exactly one build after the user clicked “确认生成 / Confirm build”; the confirmation is consumed immediately, so the next build needs a new one. If the user enabled “无需确认”, it returns confirmed=true without consuming anything until they disable it. Also returns the packaging command recorded when the preview opened; packaging commands are blocked otherwise.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          confirmed: { type: 'boolean' },
          skipConfirmation: { type: 'boolean' },
          target: { type: 'string', enum: ['exe', 'apk'] },
          buildCommand: { type: 'string' },
        },
        required: ['ok', 'message', 'confirmed'],
      },
      render(_args, value) {
        return [{ type: 'text', text: value.message }]
      },
    },
    execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('preview_release requires an agent Session')
      const result = studio.release(exec.agent)
      const value = {
        ok: result.ok,
        message: result.message,
        confirmed: result.confirmed === true,
        skipConfirmation: result.skipConfirmation === true,
      }
      if (result.target === 'exe' || result.target === 'apk') value.target = result.target
      if (typeof result.buildCommand === 'string' && result.buildCommand.length > 0) value.buildCommand = result.buildCommand
      return value
    },
  })
}

