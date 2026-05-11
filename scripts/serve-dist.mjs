import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist', import.meta.url))
const port = Number(process.env.PORT || 5174)
const host = process.env.HOST || '127.0.0.1'

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname)
  const requested = normalize(join(root, pathname))

  if (!requested.startsWith(root)) {
    return join(root, 'index.html')
  }

  if (existsSync(requested) && statSync(requested).isFile()) {
    return requested
  }

  return join(root, 'index.html')
}

createServer((request, response) => {
  const filePath = resolvePath(request.url)
  const contentType = types[extname(filePath)] || 'application/octet-stream'

  response.writeHead(200, { 'Content-Type': contentType })
  createReadStream(filePath).pipe(response)
}).listen(port, host, () => {
  console.log(`Code Brown is running at http://${host}:${port}/`)
})
