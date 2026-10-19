/**
 * Static preview server for one project build output.
 *
 * A preview gets its own loopback origin so the app's absolute asset paths
 * (`/assets/app.js`) resolve exactly as they do in production, and so the
 * previewed app stays isolated from the Harness web origin. Every HTML
 * response is instrumented with the inspector script.
 *
 * @module @local/preview-studio/preview-server
 */
import http from 'node:http'
import path from 'node:path'
import { createReadStream, promises as fsp } from 'node:fs'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
}

const INSPECTOR_ROUTE = '/__preview_studio/inspector.js'

function isInside(root, candidate) {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function statFile(file) {
  try {
    return await fsp.stat(file)
  } catch {
    return undefined
  }
}

/**
 * Insert the inspector script into one HTML document.
 * @param {string} html - raw document.
 * @returns {string} instrumented document.
 */
function injectInspector(html) {
  const tag = `<script src="${INSPECTOR_ROUTE}" data-preview-studio></script>`
  if (html.includes('data-preview-studio')) return html
  const body = html.search(/<\/body\s*>/i)
  if (body >= 0) return `${html.slice(0, body)}${tag}${html.slice(body)}`
  const fin = html.search(/<\/html\s*>/i)
  if (fin >= 0) return `${html.slice(0, fin)}${tag}${html.slice(fin)}`
  return html + tag
}

/**
 * Start a loopback static server rooted at `root`.
 * @param {{ root: string, entry: string, inspectorSource: string }} options
 * @returns {Promise<{ server: http.Server, port: number, origin: string, close: () => Promise<void> }>}
 */
export async function startPreviewServer({ root, entry, inspectorSource }) {
  const entryPath = entry.split('/').join(path.sep)

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === undefined) throw new Error('missing url')
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname === INSPECTOR_ROUTE) {
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(inspectorSource)
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Method not allowed')
        return
      }

      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith('/')) rel += entryPath
      rel = rel.replace(/^\/+/, '')

      let file = path.resolve(root, rel)
      if (!isInside(root, file)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Forbidden')
        return
      }

      let info = await statFile(file)
      if (info?.isDirectory()) {
        file = path.join(file, entryPath)
        info = await statFile(file)
      }
      if (!info?.isFile() && path.extname(file) === '') {
        // SPA deep link: serve the entry document and let the app route.
        file = path.resolve(root, entryPath)
        info = await statFile(file)
      }
      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`Not found: ${url.pathname}`)
        return
      }

      const ext = path.extname(file).toLowerCase()
      if (ext === '.html' || ext === '.htm') {
        const html = await fsp.readFile(file, 'utf8')
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(injectInspector(html))
        return
      }

      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'content-length': info.size,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(file)
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500)
        res.destroy()
      })
      stream.pipe(res)
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`Preview server error: ${error instanceof Error ? error.message : String(error)}`)
      } else {
        res.destroy()
      }
    }
  })

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('preview server did not bind a TCP port')
  }

  return {
    server,
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
