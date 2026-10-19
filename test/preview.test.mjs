#!/usr/bin/env node
/**
 * Standalone checks for the Preview Studio host core: static preview server,
 * source lookup, state API, adjustment flow, and the packaging gate.
 */
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startPreviewServer } from '../lib/preview-server.js'
import { findSourceCandidates } from '../lib/source-map.js'
import { PreviewStudio } from '../lib/studio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(here, '..', 'demo')

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log(`PASS  ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` 鈥?${detail}`}`)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

const inspectorSource = await fsp.readFile(path.resolve(here, '..', 'preview-inspector.js'), 'utf8')

// --- static preview server -------------------------------------------------
const previewServer = await startPreviewServer({ root: demoRoot, entry: 'index.html', inspectorSource })
const origin = previewServer.origin

const index = await fetch(`${origin}/`)
const indexHtml = await index.text()
check('preview serves index.html', index.status === 200 && indexHtml.includes('Nebula'))
check('preview injects inspector', indexHtml.includes('/__preview_studio/inspector.js'))
check('preview keeps relative assets', indexHtml.includes('./styles.css'))

const css = await fetch(`${origin}/styles.css`)
check('preview serves css', css.status === 200 && (css.headers.get('content-type') ?? '').includes('text/css'))
check('preview sends no-store', (await css.text()).includes(':root'))

const js = await fetch(`${origin}/app.js`)
check('preview serves js', js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'))

const inspectorResponse = await fetch(`${origin}/__preview_studio/inspector.js`)
const inspectorBody = await inspectorResponse.text()
check('inspector route serves script', inspectorResponse.status === 200 && inspectorBody.includes('__PREVIEW_STUDIO_INSPECTOR__'))

const deepLink = await fetch(`${origin}/tasks/board`)
const deepHtml = await deepLink.text()
check('spa deep link falls back to entry', deepLink.status === 200 && deepHtml.includes('Nebula'))

const missing = await fetch(`${origin}/assets/missing.png`)
check('missing asset is 404', missing.status === 404)

const traversal = await fetch(`${origin}/%2e%2e/%2e%2e/package.json`)
check('path traversal is rejected', traversal.status === 403 || traversal.status === 404)

await previewServer.close()

// --- source candidates -----------------------------------------------------
const selection = {
  tag: 'button',
  id: 'add-task',
  classes: ['primary'],
  text: '娣诲姞浠诲姟',
  attrs: { id: 'add-task', class: 'primary' },
  path: 'html>body>div:nth-of-type(1)>main:nth-of-type(1)>section:nth-of-type(2)>button:nth-of-type(1)',
}
const candidates = await findSourceCandidates(demoRoot, selection)
check('source lookup finds the button', candidates.some((entry) => entry.path === 'index.html'), JSON.stringify(candidates.slice(0, 3)))
check('source lookup ranks the definition first', candidates[0]?.path === 'index.html', candidates[0]?.path)

const cssSelection = { tag: 'section', id: 'hero-card', classes: ['hero'], text: '淇濇寔鑺傚锛岄€愪釜鍑荤牬' }
const cssCandidates = await findSourceCandidates(demoRoot, cssSelection)
check('source lookup finds markup', cssCandidates.some((entry) => entry.path === 'index.html'))
check('source lookup finds styles', cssCandidates.some((entry) => entry.path === 'styles.css'))

// --- studio state + gate ---------------------------------------------------
const studio = new PreviewStudio({
  get: () => undefined,
  workingDirectory: { ensure: async () => demoRoot },
})
await studio.initialize()
const agent = { id: 'session-test' }

const api = http.createServer((req, res) => {
  void studio.handleHttp(req, res)
})
const apiPort = await listen(api)
const apiBase = `http://127.0.0.1:${apiPort}`

const opened = await studio.open(agent, {
  root: '.',
  target: 'apk',
  title: 'Nebula 浠诲姟娓呭崟',
  build: 'flutter build apk --release',
})
check('studio opens a preview', opened.id !== undefined && opened.url.startsWith('http://127.0.0.1:'))
check('studio records target', opened.target === 'apk')
check('studio serves the preview url', (await fetch(opened.url)).status === 200)

const stateResponse = await fetch(`${apiBase}/preview-studio/state`)
const stateJson = await stateResponse.json()
check('panel state returns active preview', stateJson.preview?.id === opened.id)
check('panel state starts unconfirmed', stateJson.preview?.confirmed === false)
check('no-confirm mode is off by default', stateJson.preview?.skipConfirmation === false)

const secondSelection = {
  tag: 'p',
  classes: ['city'],
  text: '鍖椾含',
  attrs: {},
  path: 'body>div:nth-of-type(1)>main:nth-of-type(1)>section:nth-of-type(1)>section:nth-of-type(1)>div:nth-of-type(2)>article:nth-of-type(1)>p:nth-of-type(1)',
}

const selectResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    action: 'select',
    previewId: opened.id,
    selections: [selection, secondSelection],
    primaryPath: selection.path,
  }),
})
const selectJson = await selectResponse.json()
check('selection api stores the element set', selectJson.ok === true && selectJson.selectionCount === 2)
check('selection api resolves code candidates', selectJson.candidates.some((entry) => entry.path === 'index.html'))

const changes = [{
  selection,
  values: { x: 24, y: -8, width: 180, height: 44, rotation: 3, fontSize: 18, text: '绔嬪嵆娣诲姞', color: '#ffffff', backgroundColor: '#22c55e' },
}]
const changeResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'changes', previewId: opened.id, changes }),
})
const changeJson = await changeResponse.json()
check('changes api stores adjustments', changeJson.ok === true && changeJson.changeCount === 1)

const inspected = await studio.inspect(agent)
check('inspect returns the primary selection', inspected?.selection?.element?.includes('button'), inspected?.selection?.element)
check('inspect returns every selected element', inspected?.selections?.length === 2, String(inspected?.selections?.length))
check('inspect returns pending changes', inspected?.changes?.length === 1)
check('inspect returns change candidates', inspected?.changes?.[0]?.candidates?.length > 0)
check('inspect describes values', inspected?.changes?.[0]?.description?.includes('width:180px'), inspected?.changes?.[0]?.description)
check('inspect describes font size', inspected?.changes?.[0]?.description?.includes('fontSize:18px'), inspected?.changes?.[0]?.description)

const promptContext = studio.promptContext(agent.id)
check('prompt context reports the selection set', promptContext.includes('Selected elements (2)') && promptContext.includes('add-task'), promptContext)
check('prompt context reports candidates', promptContext.includes('index.html:'))
check('prompt context reports pending adjustments', promptContext.includes('Pending adjustments (1)') && promptContext.includes('width:180px'))
check('prompt context reports font size', promptContext.includes('fontSize:18px'), promptContext)
check('prompt context is empty for another session', studio.promptContext('session-other') === '')

const releaseBefore = studio.release(agent)
check('release is blocked while adjustments are unsaved', releaseBefore.ok === false && releaseBefore.confirmed === false)
check('release explains the unsaved adjustments', releaseBefore.message.includes('preview_ack'), releaseBefore.message)

const blockedExecution = { name: 'bash', arguments: { command: 'flutter build apk --release' }, agent }
check('guard blocks packaging', typeof studio.guard(blockedExecution) === 'string')
check('guard blocks packaging until adjustments are applied', studio.guard(blockedExecution).includes('unsaved adjustments'), studio.guard(blockedExecution))
check('guard ignores unrelated commands', studio.guard({ name: 'bash', arguments: { command: 'npm run build' }, agent }) === undefined)
check('guard ignores non-exec tools', studio.guard({ name: 'read', arguments: { path: 'x' }, agent }) === undefined)

const blockedConfirmResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'confirm', previewId: opened.id }),
})
const blockedConfirmJson = await blockedConfirmResponse.json()
check('panel confirm is refused while adjustments are unsaved', blockedConfirmJson.ok === false && blockedConfirmJson.reason === 'changes-pending')

const acked = studio.acknowledge(agent, 'applied by test')
check('ack clears pending adjustments', acked?.applied === 1)
check('ack bumps the revision', acked?.revision > opened.revision)
check('ack clears prompt context', studio.promptContext(agent.id) === '')

const confirmResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'confirm', previewId: opened.id }),
})
const confirmJson = await confirmResponse.json()
check('panel confirm is accepted after the adjustments are applied', confirmJson.ok === true && confirmJson.confirmed === true)

const releaseAfter = studio.release(agent)
check('release passes after confirmation', releaseAfter.ok === true && releaseAfter.confirmed === true)
check('release returns the build command', releaseAfter.buildCommand === 'flutter build apk --release')
check('guard allows packaging after confirmation', studio.guard(blockedExecution) === undefined)

const consumedState = studio.forSession(agent.id)
check('release consumes the one-shot confirmation', consumedState.confirmed === false)
check('the packaging command consumes the build permit', consumedState.buildPermit === undefined)
check('a second packaging command needs a new confirmation', typeof studio.guard(blockedExecution) === 'string')
check('the next release is blocked without a new confirmation', studio.release(agent).ok === false)

const skipOnResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'skip', previewId: opened.id, enabled: true }),
})
const skipOnJson = await skipOnResponse.json()
check('no-confirm mode can be enabled', skipOnJson.ok === true && skipOnJson.skipConfirmation === true)
const skipRelease = studio.release(agent)
check('skip mode releases without a confirmation', skipRelease.ok === true && skipRelease.skipConfirmation === true)
check('skip mode lets packaging through', studio.guard(blockedExecution) === undefined)

const skipOffResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'skip', previewId: opened.id, enabled: false }),
})
const skipOffJson = await skipOffResponse.json()
check('no-confirm mode can be disabled', skipOffJson.ok === true && skipOffJson.skipConfirmation === false)
check('disabled skip mode requires confirmation again', studio.release(agent).ok === false)

const previewState = studio.forSession(agent.id)
studio.recordChanges(previewState, [{ selection, values: { x: 1 } }])
check('new adjustments invalidate confirmation', previewState.confirmed === false)
check('invalidation blocks release again', studio.release(agent).ok === false)

const revokeResponse = await fetch(`${apiBase}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'revoke', previewId: opened.id }),
})
check('revoke clears confirmation', (await revokeResponse.json()).confirmed === false)

await studio.closeSession(agent.id)
check('studio closes the preview', studio.forSession(agent.id) === undefined)
await new Promise((resolve) => api.close(resolve))

// --- confirmation wakes the owning agent ----------------------------------
const followed = []
const wakeStudio = new PreviewStudio({
  get: (name) => name === 'agents'
    ? { get: () => ({ followup: (message) => followed.push(message) }) }
    : undefined,
  workingDirectory: { ensure: async () => demoRoot },
})
await wakeStudio.initialize()
const wakePreview = await wakeStudio.open({ id: 'session-wake' }, { root: '.', title: 'wake' })
const wakeApi = http.createServer((req, res) => { void wakeStudio.handleHttp(req, res) })
const wakePort = await listen(wakeApi)
await fetch(`http://127.0.0.1:${wakePort}/preview-studio/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'confirm', previewId: wakePreview.id }),
})
check('confirm wakes the owning agent', followed.length === 1)
check('wake message is a complete user message', followed[0]?.role === 'user' && followed[0]?.source?.kind === 'user' && typeof followed[0]?.id === 'string' && Array.isArray(followed[0]?.content), JSON.stringify(followed[0])?.slice(0, 160))
await wakeStudio.dispose()
await new Promise((resolve) => wakeApi.close(resolve))

// --- watcher ---------------------------------------------------------------
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'preview-studio-'))
await fsp.writeFile(path.join(tempRoot, 'index.html'), '<!doctype html><title>watch</title><h1>one</h1>')
const watchStudio = new PreviewStudio({
  get: () => undefined,
  workingDirectory: { ensure: async () => tempRoot },
})
await watchStudio.initialize()
const watched = await watchStudio.open({ id: 'session-watch' }, { root: '.', title: 'watch' })
await sleep(300)
await fsp.writeFile(path.join(tempRoot, 'index.html'), '<!doctype html><title>watch</title><h1>two</h1>')
await sleep(1500)
const after = watchStudio.forSession('session-watch')
check('watcher bumps the revision after a file change', after !== undefined && after.revision > watched.revision, `revision ${watched.revision} -> ${after?.revision}`)
await watchStudio.dispose()
await fsp.rm(tempRoot, { recursive: true, force: true })

// --- summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log(`Failures: ${failures.join(', ')}`)
  process.exitCode = 1
}

