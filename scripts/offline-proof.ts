// bun scripts/offline-proof.ts <export.html> <out.png> [--t seconds] [--size 1280x720]
//
// Proves that a file written by `mimir export` is self-contained: opens it from file:// in headless Chrome with
// the network switched off (CDP offline emulation AND a proxy that points at a dead port), waits for
// window.__mimir.ready, seeks, and screenshots. Prints one JSON line:
//   { file, bytes, ready, fatal, title, steps, t, requests: { file, blob, data, other }, blocked: [...],
//     consoleErrors: [...], png, width, height, sha256, lit }
// `lit` is the share of pixels that are not background black (an empty frame would be 0).
// Exit 0 only when the scene became ready with no fatal, every request was file:/blob:/data:, the page made
// exactly one file: request (itself), no console error appeared and the frame is not empty.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { launchChrome } from '../src/cli/chrome.ts'
import { sha256Hex } from '../src/cli/manifest.ts'
import { pngSize } from '../src/cli/png.ts'
import { waitReady } from '../src/cli/session.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined }
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--')))
if (positional.length < 2) { console.error('usage: bun scripts/offline-proof.ts <export.html> <out.png> [--t seconds] [--size 1280x720]'); process.exit(2) }
const file = resolve(positional[0]!)
const out = resolve(positional[1]!)
if (!existsSync(file)) { console.error(`offline-proof: no such file: ${file}`); process.exit(2) }
const [W, H] = (flag('size') ?? '1280x720').split('x').map(Number) as [number, number]
const tArg = flag('t')

/** Share of pixels brighter than near-black in an 8-bit RGB / RGBA PNG (what Chrome's screenshots are). */
function litShare(png: Uint8Array): number | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let at = 8, width = 0, height = 0, channels = 0
  const idat: Uint8Array[] = []
  while (at + 8 <= png.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!)
    const body = png.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8); height = view.getUint32(at + 12)
      const depth = png[at + 16]!, colour = png[at + 17]!
      if (depth !== 8 || (colour !== 2 && colour !== 6)) return null
      channels = colour === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    at += 12 + len
  }
  if (!width || !channels) return null
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride)
  let lit = 0
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1)
    const filter = raw[start]!
    for (let x = 0; x < stride; x++) {
      const v = raw[start + 1 + x]!
      const a = x >= channels ? cur[x - channels]! : 0, b = prev[x]!, c = x >= channels ? prev[x - channels]! : 0
      let p = 0
      if (filter === 1) p = a
      else if (filter === 2) p = b
      else if (filter === 3) p = (a + b) >> 1
      else if (filter === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[x] = (v + p) & 255
    }
    for (let x = 0; x < stride; x += channels) if (cur[x]! + cur[x + 1]! + cur[x + 2]! > 48) lit++
    prev.set(cur)
  }
  return lit / (width * height)
}

const consoleErrors: string[] = []
// Second lock besides the CDP offline switch: every request, loopback included, is sent to a proxy on a port
// nobody listens on, so anything that tried to leave the file would fail (and show up in `blocked`).
// the discard service: nothing listens there, so every request that leaves the page fails at once
const DISCARD_PORT = Number('9')
const env = { ...process.env, MIMIR_CHROME_ARGS: `${process.env.MIMIR_CHROME_ARGS ?? ''} --proxy-server=127.0.0.1:${DISCARD_PORT} --proxy-bypass-list=<-loopback>`.trim() }
const browser = await launchChrome({ env, onConsole: (level, text) => { if (level === 'error') consoleErrors.push(text) } })
let code = 1
try {
  const page = await browser.newPage(W, H, 1)
  const requests: string[] = []
  const blocked: string[] = []
  browser.cdp.on((e) => {
    if (e.sessionId !== page.sessionId) return
    if (e.method === 'Network.requestWillBeSent') requests.push(String(e.params.request.url))
    if (e.method === 'Network.loadingFailed') blocked.push(String(e.params.errorText ?? 'failed'))
  })
  await page.send('Network.enable')
  await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await page.navigate(pathToFileURL(file).href)
  const info = await waitReady(page, 20_000, file)
  const t = tArg !== undefined ? Number(tArg) : info.steps.length ? Math.max(info.steps[0]!.t0, info.steps[0]!.t1 - 0.001) : 0
  await page.evaluate(`(async () => { const m = window.__mimir; m.seek(${JSON.stringify(t)}); await m.frame(); return true })()`)
  const png = await page.screenshot()
  writeFileSync(out, png)
  const size = pngSize(png)
  const scheme = (u: string): string => (/^([a-z][a-z0-9+.-]*):/i.exec(u)?.[1] ?? '').toLowerCase()
  const count = (s: string): number => requests.filter((u) => scheme(u) === s).length
  const other = requests.filter((u) => !['file', 'blob', 'data'].includes(scheme(u)))
  const lit = litShare(png)
  const result = {
    file, bytes: statSync(file).size, ready: true, fatal: info.fatal?.message ?? null, title: info.title, steps: info.steps.length, t,
    requests: { file: count('file'), blob: count('blob'), data: count('data'), other },
    blocked, consoleErrors, png: out, width: size?.width ?? 0, height: size?.height ?? 0, sha256: sha256Hex(png), lit: lit === null ? null : Number(lit.toFixed(4)),
  }
  console.log(JSON.stringify(result))
  const ok = info.fatal === null && other.length === 0 && count('file') === 1 && consoleErrors.length === 0 && blocked.length === 0 && lit !== null && lit > 0.005
  code = ok ? 0 : 1
  // the export must not be a shell that only works next to its source files
  if (ok && /<script[^>]+\bsrc=/.test(readFileSync(file, 'utf8'))) { console.error('offline-proof: the file loads a script by src'); code = 1 }
} catch (e) {
  console.error(`offline-proof: ${(e as Error).message}`)
} finally {
  await browser.close()
}
process.exit(code)
