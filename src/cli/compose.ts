// Pictures the CLI composes itself (story sheets, filmstrips, the legend of --debug ids): a static page built from
// frames that were already captured, served from memory by the session's server and screenshotted in a second page
// of the same browser. No scripts in those pages; their geometry is fixed by the caller or measured once.
import { CliError } from './errors.ts'
import type { Page } from './chrome.ts'
import { pngSize } from './png.ts'
import { timeoutFromEnv, type Session } from './session.ts'

export interface Composed { png: Uint8Array; width: number; height: number }

export class Composer {
  private page: Page | null = null
  private count = 0

  constructor(private session: Session) {}

  /**
   * Screenshot `html` at `width` CSS px. `assets` are served next to it (the html refers to them by the names given,
   * relative). With `height: null` the page's own height is measured and used.
   */
  async render(html: string, assets: Record<string, Uint8Array>, width: number, height: number | null, scale = 1): Promise<Composed> {
    const { server, browser } = this.session
    const timeoutMs = timeoutFromEnv()
    const base = `/__mimir/compose/${++this.count}/`
    for (const [name, bytes] of Object.entries(assets)) server.put(base + name, bytes, 'image/png')
    server.put(base + 'index.html', html, 'text/html; charset=utf-8')
    try {
      // a window of its own: a second tab in the scene's window would take the animation frames away from the scene
      this.page ??= await browser.newPage(width, height ?? 200, scale, { window: true })
      const page = this.page
      await page.setViewport(width, height ?? 200, scale)
      await page.navigate(`${server.origin}${base}index.html`, timeoutMs)
      const settle = `(async () => {
  while (document.readyState !== 'complete') await new Promise((r) => setTimeout(r, 5));
  await Promise.all([...document.images].map((i) => i.decode()));
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return Math.ceil(document.documentElement.scrollHeight);
})()`
      const measured = await page.evaluate<number>(settle, timeoutMs)
      const h = height ?? Math.max(1, measured)
      if (height === null) {
        await page.setViewport(width, h, scale)
        await page.evaluate(settle, timeoutMs)
      }
      const png = await page.screenshot(timeoutMs)
      const size = pngSize(png)
      const want = { width: Math.round(width * scale), height: Math.round(h * scale) }
      if (!size || size.width !== want.width || size.height !== want.height) {
        throw new CliError(`a composed picture came out ${size?.width}x${size?.height}, expected ${want.width}x${want.height}`)
      }
      return { png, width: size.width, height: size.height }
    } finally {
      server.drop(base)
    }
  }

  async close(): Promise<void> {
    if (this.page) await this.page.close()
    this.page = null
  }
}
