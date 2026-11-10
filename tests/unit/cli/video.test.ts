import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { PageError, type Page } from '../../../src/cli/chrome.ts'
import { CliError } from '../../../src/cli/errors.ts'
import { FFMPEG_MISSING, encodeVideo, ffmpegArgs, findFfmpeg, findFfprobe, partsDir, spokenSeconds, videoParts, videoTimes, type PagePool, type VideoOptions } from '../../../src/cli/video.ts'

describe('export --mp4: frames and the encoder', () => {
  test('frame i shows the story at from + i / fps; the count is the length times the rate', () => {
    expect(videoTimes(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75])
    expect(videoTimes(2, 3, 2)).toEqual([2, 2.5])
    expect(videoTimes(0, 16.2673, 30).length).toBe(488)
    // never past the end, never empty
    expect(Math.max(...videoTimes(0, 0.99, 30))).toBeLessThanOrEqual(0.99)
    expect(videoTimes(0, 0.001, 30)).toEqual([0])
    // the same call gives the same times: nothing depends on a clock
    expect(videoTimes(1, 9, 30)).toEqual(videoTimes(1, 9, 30))
  })
  test('ffmpeg reads PNGs from stdin and writes H.264 that plays everywhere', () => {
    const a = ffmpegArgs(30, 16, '/tmp/out.mp4')
    const at = (flag: string): string => a[a.indexOf(flag) + 1]!
    expect(a.slice(a.indexOf('-f'), a.indexOf('-f') + 2)).toEqual(['-f', 'image2pipe'])
    expect(at('-framerate')).toBe('30')
    expect(at('-i')).toBe('-')
    expect(at('-crf')).toBe('16')
    expect(at('-pix_fmt')).toBe('yuv420p')
    expect(at('-movflags')).toBe('+faststart')
    expect(a).toContain('libx264')
    expect(a[a.length - 1]).toBe('/tmp/out.mp4')
    expect(a).toContain('-y') // never waits for an answer
  })
  test('ffmpeg is looked for, never assumed: MIMIR_FFMPEG, then PATH, else null with a message that says what to do', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-ffmpeg-'))
    try {
      expect(findFfmpeg({ PATH: dir })).toBeNull()
      const fake = join(dir, 'ffmpeg')
      writeFileSync(fake, '#!/bin/sh\nexit 0\n')
      chmodSync(fake, 0o755)
      expect(findFfmpeg({ PATH: dir })).toBe(fake)
      expect(findFfmpeg({ PATH: '', MIMIR_FFMPEG: fake })).toBe(fake)
      expect(() => findFfmpeg({ MIMIR_FFMPEG: join(dir, 'nope') })).toThrow(CliError)
      expect(() => findFfmpeg({ MIMIR_FFMPEG: join(dir, 'nope') })).toThrow('MIMIR_FFMPEG points to a file that does not exist')
      // ffprobe: beside the ffmpeg in use first
      expect(findFfprobe(fake, { PATH: '' })).toBeNull()
      writeFileSync(join(dir, 'ffprobe'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(dir, 'ffprobe'), 0o755)
      expect(findFfprobe(fake, { PATH: '' })).toBe(join(dir, 'ffprobe'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(FFMPEG_MISSING).toContain('MIMIR_FFMPEG=')
    expect(FFMPEG_MISSING).toContain('brew install ffmpeg')
    expect(FFMPEG_MISSING).toContain('do not need it')
  })
})

// ── a long video is made in parts, a slow frame is tried again, a run that stopped is continued ─────────────────
// (what two scene authors hit: one screenshot that took over 30 s on a busy machine aborted a 2763-frame video, four
// times, and nothing was kept). The pages are stand-ins that hand out real PNGs; the encoder is the real ffmpeg.
describe('export --mp4: parts, retries and resuming', () => {
  const ffmpeg = findFfmpeg()
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer)
    view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8); view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  /** a 16 x 16 picture of one grey level: a different picture for every story time */
  const png = (level: number): Uint8Array => {
    const W = 16, H = 16, raw = new Uint8Array(H * (1 + W * 3))
    for (let y = 0; y < H; y++) raw.fill(level & 255, y * (1 + W * 3) + 1, (y + 1) * (1 + W * 3))
    const head = new Uint8Array(13), hv = new DataView(head.buffer)
    hv.setUint32(0, W); hv.setUint32(4, H); head[8] = 8; head[9] = 2
    return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))]))
  }
  /** a pool of stand-in pages; `fail(frame, attempt)` says which step of which try of a frame does not come back */
  const pool = (fail: (frame: number, attempt: number) => 'seek' | 'screenshot' | 'throw' | null = () => null): PagePool & { opened: number; closed: number } => {
    const attempts = new Map<number, number>()
    const p = {
      opened: 0, closed: 0,
      async open() {
        p.opened++
        let frame = 0, verdict: ReturnType<typeof fail> = null
        return {
          async evaluate(expression: string) {
            frame = Math.round(Number(/m\.seek\(([\d.]+)\)/.exec(expression)![1]) * 10)
            attempts.set(frame, (attempts.get(frame) ?? 0) + 1)
            verdict = fail(frame, attempts.get(frame)!)
            if (verdict === 'throw') throw new PageError('TypeError: boom in the scene')
            if (verdict === 'seek') throw new CliError('timed out after 100 ms waiting for the browser to answer Runtime.evaluate')
          },
          async screenshot() {
            if (verdict === 'screenshot') throw new CliError('timed out after 100 ms waiting for the browser to answer Page.captureScreenshot')
            return png(frame * 20)
          },
        } as unknown as Page
      },
      async close() { p.closed++ },
    }
    return p
  }
  const options = (dir: string, over: Partial<VideoOptions> = {}): VideoOptions & { said: string[] } => {
    const said: string[] = []
    return { out: join(dir, 'out.mp4'), ffmpeg: ffmpeg!, ffprobe: findFfprobe(ffmpeg!), fps: 10, crf: 20, size: { width: 16, height: 16 }, from: 0, to: 1.2, sets: [], jobs: 2, fingerprint: 'scene-a', partFrames: 4, timeoutMs: 100, log: (m) => said.push(m), said, ...over }
  }
  const work = (): string => mkdtempSync(join(realpathSync(tmpdir()), 'mimir-video-'))

  test('videoParts cuts the frames into parts of one size, the last one shorter', () => {
    expect(videoParts(12, 4).map((p) => [p.first, p.count])).toEqual([[0, 4], [4, 4], [8, 4]])
    expect(videoParts(10, 4).map((p) => [p.first, p.count])).toEqual([[0, 4], [4, 4], [8, 2]])
    expect(videoParts(3, 150)).toEqual([{ index: 0, first: 0, count: 3 }])
    expect(spokenSeconds(59)).toBe('59 s')
    expect(spokenSeconds(80)).toBe('1 min 20 s')
  })

  test.skipIf(!ffmpeg)('a frame that does not come back is tried again on a fresh page, and the video is the same', async () => {
    const dir = work()
    try {
      const clean = await encodeVideo(pool(), options(dir, { jobs: 1 }))
      expect(clean.probe?.frames ?? 12).toBe(12)
      expect(clean.timing).toMatchObject({ rendered: 12, resumed: 0, retried: 0 })
      expect(existsSync(partsDir(join(dir, 'out.mp4')))).toBe(false) // the parts are joined and gone
      const flaky = pool((frame, attempt) => (frame === 5 && attempt === 1 ? 'screenshot' : frame === 9 && attempt <= 2 ? 'seek' : null))
      const o = options(dir, { jobs: 3 })
      const again = await encodeVideo(flaky, o)
      expect(again.frames_sha256).toBe(clean.frames_sha256)
      expect(again.timing.retried).toBe(3)
      expect(flaky.closed).toBeGreaterThanOrEqual(3) // a page that did not answer is given back, never used again
      expect(o.said.filter((m) => m.includes('trying again on a fresh page')).length).toBe(3)
      expect(o.said.some((m) => /video: frame \d+ of 12 \(100 %\)/.test(m))).toBe(true) // progress goes to the log (stderr)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test.skipIf(!ffmpeg)('a run that gives up names the slow step and keeps its finished parts; the same command continues from them', async () => {
    const dir = work()
    try {
      const clean = await encodeVideo(pool(), options(dir, { out: join(dir, 'clean.mp4') }))
      // frame 7 (the second part) never comes back
      const stuck = options(dir, { jobs: 1 })
      let message = ''
      try { await encodeVideo(pool((frame) => (frame === 6 ? 'screenshot' : null)), stuck) } catch (e) { message = (e as Error).message }
      expect(message).toContain('video frame 7 of 12 (t=0.6s) failed 3 times, each on a fresh page')
      expect(message).toContain('The slow step was the screenshot (Page.captureScreenshot)')
      expect(message).toContain('MIMIR_TIMEOUT')
      expect(message).toContain('1 of 3 parts are finished and kept')
      expect(existsSync(join(dir, 'out.mp4'))).toBe(false)
      expect(readdirSync(partsDir(join(dir, 'out.mp4'))).sort()).toEqual(['part-00001.json', 'part-00001.mp4'])
      // the same command again: the first part is not rendered a second time, and the video is the one an unbroken run makes
      const second = pool()
      const o = options(dir, { jobs: 2 })
      const resumed = await encodeVideo(second, o)
      expect(resumed.timing).toMatchObject({ rendered: 8, resumed: 4 })
      expect(resumed.frames_sha256).toBe(clean.frames_sha256)
      expect(resumed.probe?.frames ?? 12).toBe(12)
      expect(o.said[0]).toContain('continuing: 4 of 12 frames (1 of 3 parts) are kept from an earlier run')
      expect(existsSync(partsDir(join(dir, 'out.mp4')))).toBe(false)
      // parts of ANOTHER video (the scene changed) are never used
      try { await encodeVideo(pool((frame) => (frame === 6 ? 'screenshot' : null)), options(dir, { jobs: 1, out: join(dir, 'b.mp4') })) } catch { /* kept part 1 */ }
      const changed = await encodeVideo(pool(), options(dir, { out: join(dir, 'b.mp4'), fingerprint: 'scene-b' }))
      expect(changed.timing).toMatchObject({ rendered: 12, resumed: 0 })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test.skipIf(!ffmpeg)('a scene that throws in a frame fails at once: the same frame would throw on any page', async () => {
    const dir = work()
    try {
      const p = pool((frame) => (frame === 2 ? 'throw' : null))
      let message = ''
      try { await encodeVideo(p, options(dir, { jobs: 1 })) } catch (e) { message = (e as Error).message }
      expect(message).toContain('video frame 3 of 12 (t=0.2s) failed: the scene threw')
      expect(message).toContain('boom in the scene')
      expect(p.opened).toBe(1)
      expect(existsSync(partsDir(join(dir, 'out.mp4')))).toBe(false) // nothing finished: nothing left behind
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
