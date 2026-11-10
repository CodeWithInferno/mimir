// src/r2d/fonts.chunk.ts: the faces the stage is typeset in (dist/mimir.fonts.js). The runtime loads this chunk
// before anything is measured or drawn, for every scene that shows text; `mimir export` inlines it, so an exported
// file needs no installed font and no network. The module finishes loading only when the faces are usable: nothing
// is ever measured against a fallback font and drawn in the real one.
import { FACES } from './fontdata.ts'

/** Register the embedded faces with the document. Resolves when every one of them can be used (or could not be read). */
export async function registerFonts(doc: Document): Promise<void> {
  if (typeof FontFace === 'undefined' || !doc.fonts) return
  const pending: Promise<unknown>[] = []
  for (const f of FACES) {
    // loading the chunk twice (two viewers in one page) must not register a face twice
    let have = false
    doc.fonts.forEach((x) => { if (x.family.replace(/["']/g, '') === f.family && x.weight === f.weight && x.style === f.style) have = true })
    if (have) continue
    const raw = atob(f.data)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const face = new FontFace(f.family, bytes.buffer, { weight: f.weight, style: f.style, display: 'block' })
    doc.fonts.add(face)
    pending.push(face.load().catch((e) => { console.warn(`[mimir] the embedded font ${f.file} could not be used; text falls back to an installed serif`, e) }))
  }
  await Promise.all(pending)
}
// no document under bun (the build imports every chunk once to read its registrations)
if (typeof document !== 'undefined') await registerFonts(document)
