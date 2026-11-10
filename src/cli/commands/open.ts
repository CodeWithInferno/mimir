// mimir open <scene> [--port n] [--no-open]: dev server with live reload on a free port of 127.0.0.1. Runs until interrupted.
import type { OpenOptions } from '../args.ts'
import { onCleanup } from '../chrome.ts'
import type { Io } from '../io.ts'
import { ensureViewer, resolveScene } from '../paths.ts'
import { extraExtensions, startServer, type MimirServer } from '../server.ts'

/**
 * The port `mimir open` listens on when --port is not given: MIMIR_PORT when it is a port number, else 0, which asks
 * the operating system for any free port. There is no fixed default: the address is printed, and two servers never
 * fight over a number.
 */
export function preferredPort(env: Record<string, string | undefined>): number {
  const n = Number(env.MIMIR_PORT)
  return env.MIMIR_PORT !== undefined && env.MIMIR_PORT !== '' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 0
}

/**
 * The command that opens a URL in the person's default browser on a platform, or null when there is none.
 * `which` finds a program on PATH (injected so the choice can be tested without the programs).
 */
export function browserOpener(platform: string, url: string, which: (name: string) => string | null): string[] | null {
  if (platform === 'darwin') { const bin = which('open'); return bin ? [bin, url] : null }
  if (platform === 'win32') {
    // rundll32 hands the URL to the default handler without a shell, so nothing in the URL is parsed as a command
    const bin = which('rundll32.exe') ?? which('rundll32')
    return bin ? [bin, 'url.dll,FileProtocolHandler', url] : null
  }
  for (const name of ['xdg-open', 'gio', 'wslview']) {
    const bin = which(name)
    if (bin) return name === 'gio' ? [bin, 'open', url] : [bin, url]
  }
  return null
}

function launchBrowser(url: string, io: Io): void {
  const argv = browserOpener(process.platform, url, (name) => Bun.which(name, { PATH: io.env.PATH ?? '' }))
  if (!argv) {
    io.log(`no program to open a browser was found on this machine; open ${url} yourself`)
    return
  }
  try {
    Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  } catch (e) {
    io.log(`could not open the browser (${(e as Error).message}); open ${url} yourself`)
  }
}

export async function open(opts: OpenOptions, io: Io): Promise<number> {
  const scene = resolveScene(opts.scene, io.cwd, 'open')
  const viewer = await ensureViewer(io.env, io.log)
  // --port wins, then MIMIR_PORT, then any free port. A port that was asked for and is taken is an error that says so:
  // silently moving to another one would leave the person looking at the wrong address
  const server: MimirServer = startServer({ viewerRoot: viewer.dir, sceneDir: scene.dir, watch: true, liveReload: true, extensions: extraExtensions(io.env), port: opts.port ?? preferredPort(io.env) })
  onCleanup(() => server.stop())
  const url = `${server.origin}/viewer.html?scene=${encodeURIComponent(scene.url)}`
  io.out(io.json ? JSON.stringify({ url, port: server.port, scene: scene.path }) + '\n' : url + '\n')
  io.log(`serving ${scene.file} with live reload; press Ctrl+C to stop`)
  if (opts.open) launchBrowser(url, io)
  // keep running until a signal arrives (handled by the cleanup hooks)
  await new Promise<never>(() => {})
  return 0
}
