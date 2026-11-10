// Type on the stage: the font stacks, the CSS variables other modules read, and the metrics of the embedded faces.
// Pure (no DOM): the same numbers are used under bun and in the browser, so a width read while a scene is being
// built is the width that is drawn. The faces themselves live in the lazy chunk ./fonts.chunk.ts.
import { measure } from '../core/index.ts'

/** CSS families the embedded faces are registered under (the names KaTeX uses, so a TeX module can share them). */
export const FONT_FAMILY_TEXT = 'KaTeX_Main'
export const FONT_FAMILY_MATH = 'KaTeX_Math'
/** Text on the stage: Computer Modern, then the math face for Greek, then what a machine may have, then any serif. */
export const FONT_TEXT = `${FONT_FAMILY_TEXT}, ${FONT_FAMILY_MATH}, "CMU Serif", "Latin Modern Roman", "STIX Two Text", "Times New Roman", Times, serif`
/** Variables and symbols: Computer Modern math italic. */
export const FONT_MATH = `${FONT_FAMILY_MATH}, ${FONT_FAMILY_TEXT}, "Latin Modern Math", "STIX Two Math", "Cambria Math", serif`
/** Code and UI-like text are not embedded: the machine's own faces. */
export const FONT_SANS_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif'
export const FONT_MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
/** Custom properties set on the stage element: any module's HTML or SVG text says `font-family: var(--mimir-font-text)`. */
export const FONT_VARS = { text: '--mimir-font-text', math: '--mimir-font-math' } as const
/** Name of the lazy chunk that carries the faces (dist/mimir.fonts.js). A module that draws text of its own asks for it with model.requireChunk(FONT_CHUNK). */
export const FONT_CHUNK = 'fonts'
/** Stacks by the `font` option of text(). */
export const FONTS: Record<string, string> = { serif: FONT_TEXT, math: FONT_MATH, sans: FONT_SANS_STACK, mono: FONT_MONO_STACK }

/**
 * Advance widths and kerning of the embedded faces, in thousandths of an em.
 *   ascii: code points 32..126, two base-36 digits each ('--' = the face has no such glyph)
 *   more:  other code points, hex:width
 *   kern:  value:pairs, every pair two characters
 * Widths are the hmtx tables of the KaTeX ttf files (katex@0.19.1). The KaTeX faces carry no kerning of their own, so
 * the pairs are Computer Modern's: the lig/kern programs of cmr10, cmbx10 and cmti10 (TeX's tfm files, read with
 * tftopl), letters, digits and common punctuation only. Ligatures are not applied (the faces have no ligature glyphs).
 */
const RAW: Record<string, { ascii: string; more: string; kern: string }> = {
  regular: { ascii: "6y7qdwn5dwn5lm7qatatdwlm7q997qdwdwdwdwdwdwdwdwdwdwdw7q7qlmlmlmd4lmkujok2l8ixi5ltkua1ealmhdphkulmixlmkgfgk2kukuskkukugz7qdw7qdwdw--dwfgccfgcc8idwfg7q8ieo7qn5fgdwfgeoawayatfgeok2eoeoccdw7qdwdw", more: "a0:250,a3:769,a7:444,a8:500,ac:667,b0:500,b1:778,b6:611,b8:444,c6:903,d7:778,d8:778,df:500,e6:722,f7:778,f8:500,131:278,152:1014,153:778,237:306,2c6:500,2c7:500,2c9:500,2ca:500,2cb:500,2d8:500,2d9:278,2da:750,2dc:500,2dd:500,393:625,394:833,398:778,39b:694,39e:667,3a0:750,3a3:722,3a5:778,3a6:722,3a8:778,3a9:722,2002:500,2003:999,2004:333,2005:250,2006:167,2009:167,200a:83,2013:500,2014:1000,2018:278,2019:278,201c:500,201d:500,2020:444,2021:444,2026:1172,2032:275,210f:540,2111:722,2113:417,2118:636,211c:722,2135:611,2190:1000,2191:500,2192:1000,2193:500,2194:1000,2195:500,2196:1000,2197:1000,2198:1000,2199:1000,21a6:1000,21a9:1126,21aa:1126,21bc:1000,21bd:1000,21c0:1000,21c1:1000,21cc:1000,21d0:1000,21d1:611,21d2:1000,21d3:611,21d4:1000,21d5:611,2200:556,2202:531,2203:556,2205:500,2207:833,2208:667,220b:667,2212:778,2213:778,2215:500,2216:500,2217:500,2218:500,2219:500,221a:833,221d:778,221e:1000,2220:722,2223:278,2225:500,2227:667,2228:667,2229:667,222a:667,222b:417,223c:778,2240:278,2243:778,2245:778,2248:778,224d:778,2250:778,2261:778,2264:778,2265:778,226a:1000,226b:1000,227a:778,227b:778,2282:778,2283:778,2286:778,2287:778,228e:667,2291:778,2292:778,2293:667,2294:667,2295:778,2296:778,2297:778,2298:778,2299:778,22a2:611,22a3:611,22a4:778,22a5:778,22a8:867,22c4:500,22c5:278,22c6:500,22c8:900,22ee:278,22ef:1172,22f1:1282,2308:444,2309:444,230a:444,230b:444,2322:1000,2323:1000,23b0:412,23b1:412,25b3:889,25b9:500,25bd:889,25c3:500,25ef:1000,2660:778,2661:778,2662:778,2663:778,266d:389,266e:389,266f:389,27e8:389,27e9:389,27ee:412,27ef:412,27f5:1609,27f6:1638,27f7:1859,27f8:1609,27f9:1638,27fa:1858,27fc:1638,2a3f:750,2aaf:778,2ab0:778", kern: "-111:AVAWFALVLWRVRWVAWA|-83:ATAYFaFeFoFrFuLTLYP,P.PARTRYTATaTeToTrTuVaVeVoVrVuWaWeWoWrWuYAYaYeYoYrYuy,y.|-56:kava|-28:ACAGAOAQAUAtDADVDWDXDYFCFGFOFQKCKGKOKQOAOVOWOXOYPaPePoRCRGRORQRURtTyVCVGVOVQWCWGWOWQXCXGXOXQavawaybvbwbxbychckhbhthuhvhwhykckekombmtmumvmwmynbntnunvnwnyovowoxoypvpwpxpytwtyuwvcvevowawcwewoyayeyo|28:IIbcbdbebobqgjocodoeoooqpcpdpepopq|56:ajbjojpj|78:f!f'f)f?|111:'!'?" },
  bold: { ascii: "6y9qgrqmfzqmou8vcfcffzou8van8vfzfzfzfzfzfzfzfzfzfzfz8v8vouououf3ouo5mqn3oil0k4p4p0c4gip1j8ucp0o0luo0nyhrm8olo5x1o5o5jj8vfz8vfzfz--fjhre7hren9rfzhr8v9rgv8vqmhrfzhrgvd6cmcfhrgvn3gvgve7fz8vfzfz", more: "a0:250,a3:869,a8:575,ac:767,b0:575,b1:894,b8:511,c6:1042,d7:894,d8:894,df:597,e6:831,f7:894,f8:575,131:319,152:1169,153:894,237:351,2c6:575,2c7:575,2c9:575,2ca:575,2cb:575,2d8:575,2d9:319,2da:869,2dc:575,2dd:575,393:692,394:958,398:894,39b:806,39e:767,3a0:900,3a3:831,3a5:894,3a6:831,3a8:894,3a9:831,2002:500,2003:999,2004:333,2005:250,2006:167,2009:167,200a:83,2013:575,2014:1150,2018:319,2019:319,201c:603,201d:603,2020:511,2021:511,2026:1295,2032:344,210f:668,2111:831,2113:474,2118:740,211c:831,2135:703,2190:1150,2191:575,2192:1150,2193:575,2194:1150,2195:575,2196:1150,2197:1150,2198:1150,2199:1150,21a6:1150,21a9:1282,21aa:1282,21bc:1150,21bd:1150,21c0:1150,21c1:1150,21cc:1150,21d0:1150,21d1:703,21d2:1150,21d3:703,21d4:1150,21d5:703,2200:639,2202:628,2203:639,2205:575,2207:958,2208:767,220b:767,2212:894,2213:894,2215:575,2216:575,2217:575,2218:575,2219:575,221a:958,221d:894,221e:1150,2220:722,2223:319,2225:575,2227:767,2228:767,2229:767,222a:767,222b:569,223c:894,2240:319,2243:894,2245:894,2248:894,224d:894,2250:894,2261:894,2264:894,2265:894,226a:1150,226b:1150,227a:894,227b:894,2282:894,2283:894,2286:894,2287:894,228e:767,2291:894,2292:894,2293:767,2294:767,2295:894,2296:894,2297:894,2298:894,2299:894,22a2:703,22a3:703,22a4:894,22a5:894,22a8:974,22c4:575,22c5:319,22c6:575,22c8:1000,22ee:319,22ef:1295,22f1:1323,2308:511,2309:511,230a:511,230b:511,2322:1150,2323:1150,25b3:1022,25b9:575,25bd:1022,25c3:575,25ef:1150,2660:894,2661:894,2662:894,2663:894,266d:447,266e:447,266f:447,27e8:447,27e9:447,27f5:1805,27f6:1833,27f7:2126,27f8:1868,27f9:1870,27fa:2126,27fc:1833,2a3f:900,2aaf:894,2ab0:894", kern: "-128:AVAWFALVLWRVRWVAWA|-96:ATAYFaFeFoFrFuLTLYP,P.PARTRYTATaTeToTrTuVaVeVoVrVuWaWeWoWrWuYAYaYeYoYrYuy,y.|-64:kava|-32:ACAGAOAQAUAtDADVDWDXDYFCFGFOFQKCKGKOKQOAOVOWOXOYPaPePoRCRGRORQRURtTyVCVGVOVQWCWGWOWQXCXGXOXQavawaybvbwbxbychckhbhthuhvhwhykckekombmtmumvmwmynbntnunvnwnyovowoxoypvpwpxpytwtyuwvcvevowawcwewoyayeyo|32:IIbcbdbebobqgjocodoeoooqpcpdpepopq|64:ajbjojpj|109:f!f'f)f?|128:'!'?" },
  italic: { ascii: "6y8jeamq--mqlb8jbdbde7lb8j9y8je7e7e7e7e7e7e7e7e7e7e78j8j--lb--e7lbknjkjwkziui5liknaqelldhfoxknlbiulbk9fmjwknknrrknknh18j--8je7e7--e7cscse7cs8jcse78j8jcs74mqfme7e7csbqbd98excsigcwdibd------e7", more: "a0:250,a8:511,b0:511,b8:460,c6:883,d8:767,df:537,e6:716,f8:511,131:307,152:985,153:716,237:332,2c6:511,2c7:511,2c9:511,2ca:511,2cb:511,2d8:511,2d9:307,2da:831,2dc:511,2dd:511,393:627,394:818,398:767,39b:692,39e:664,3a0:743,3a3:716,3a5:767,3a6:716,3a8:767,3a9:716,2013:511,2014:1022,2018:307,2019:307,201c:514,201d:514,210f:540", kern: "-102:AVAWFALVLWRVRWVAn'|-77:ATAYFaFeFoFrFuLTLYPARTRYTATaTeToTrTuTyVaVeVoVrVuWAYAYaYeYoYrYu|-51:AaAcAdAeAgAoAqLaLcLdLeLgLoLqRaRcRdReRgRoRqbabcbdbebgbobqcacccdcecgcocqeaecedeeegeoeqoaocodoeogoooqpapcpdpepgpopqrarcrdrergrorq|-26:ACAGAOAQAUAbAhAiAkAlAmAnArAtAuAvAwDADVDWDXDYFCFGFOFQKCKGKOKQOAOVOWOXOYRCRGRORQRURbRhRiRkRlRmRnRrRtRuRvRwVCVGVOVQXCXGXOXQ|51:dlllwl|102:'!'?|104:f!f'f)f?" },
  math: { ascii: "6y------------------------------dwdwdwdwdwdwdwdwdwdw--------------kul3jvn0kihvlun3c8ffnlixqymbl7hulzl3h1g8izg7q8n0g5iz------------epbxc1egcydmd9g09lbgeh8aoegodhdzcecjd1a1fwdhjwfwdmcx--------", more: "a0:250,393:615,394:833,398:763,39b:694,39e:742,3a0:831,3a3:780,3a5:583,3a6:667,3a8:612,3a9:772,3b1:640,3b2:566,3b3:518,3b4:444,3b5:466,3b6:438,3b7:497,3b8:469,3b9:354,3ba:576,3bb:583,3bc:603,3bd:494,3be:438,3bf:485,3c0:570,3c1:517,3c2:363,3c3:571,3c4:437,3c5:540,3c6:654,3c7:626,3c8:651,3c9:622,3d1:591,3d5:596,3d6:828,3f1:517,3f5:406", kern: "" },
}

interface Table { width: Map<number, number>; kern: Map<string, number> }
const tables = new Map<string, Table>()
function tableOf(name: string): Table {
  let t = tables.get(name)
  if (t) return t
  const raw = RAW[name]!
  t = { width: new Map(), kern: new Map() }
  for (let i = 0; i * 2 < raw.ascii.length; i++) { const s = raw.ascii.slice(i * 2, i * 2 + 2); if (s !== '--') t.width.set(32 + i, parseInt(s, 36)) }
  for (const e of raw.more.split(',')) { const [c, w] = e.split(':'); if (c && w) t.width.set(parseInt(c, 16), Number(w)) }
  for (const group of raw.kern ? raw.kern.split('|') : []) {
    const at = group.indexOf(':', 1)
    const v = Number(group.slice(0, at)), pairs = group.slice(at + 1)
    for (let i = 0; i + 1 < pairs.length; i += 2) t.kern.set(pairs.slice(i, i + 2), v)
  }
  tables.set(name, t)
  return t
}

/** One face of a font: what the SVG text is set in and how its strings are measured. */
export interface Face {
  /** CSS font-family list */
  family: string
  weight: 'normal' | 'bold'
  italic: boolean
  /** tables to read widths from, first hit wins; empty for faces that are not embedded (measured by the browser) */
  tables: string[]
  /** the table whose kerning pairs apply, or null */
  kern: string | null
}
/** The face for text() options. `font`: 'serif' | 'math' | 'sans' | 'mono'. */
export function faceOf(font: unknown, weight: unknown, italic: unknown): Face {
  const bold = weight === 'bold', it = italic === true
  if (font === 'sans' || font === 'mono') return { family: FONTS[font]!, weight: bold ? 'bold' : 'normal', italic: it, tables: [], kern: null }
  // the math face is one italic cut; what it lacks (punctuation) comes from the text face, as in the font stack
  if (font === 'math') return { family: FONT_MATH, weight: 'normal', italic: true, tables: ['math', 'regular'], kern: null }
  const own = bold ? 'bold' : it ? 'italic' : 'regular'
  return { family: FONT_TEXT, weight: bold ? 'bold' : 'normal', italic: it, tables: own === 'regular' ? ['regular', 'math'] : [own, 'regular', 'math'], kern: own }
}
/** `font` shorthand of a face for a canvas or CSS: 'italic bold' / 'normal' … (style then weight). */
export const faceStyle = (f: Face): string => `${f.italic ? 'italic ' : ''}${f.weight}`

export interface LineMetrics {
  /** advance of the whole line in em, kerning included */
  width: number
  /** kerning before each UTF-16 unit of the line in em (the SVG `dx` list), or null when there is none */
  dx: number[] | null
}
const lineCache = new Map<string, LineMetrics>()
/** Maximum number of measured strings kept (a counter that changes every frame must not grow the cache without end). */
export const LINE_CACHE_SIZE = 2000
/**
 * Width and kerning of one line of text in a face. Glyphs of the embedded faces are read from their tables, so the
 * answer is the same with and without a browser; anything else (another font, a character the faces lack) is asked
 * of the core measurer (a canvas in the browser, an estimate under bun).
 */
export function lineMetrics(text: string, face: Face): LineMetrics {
  if (!face.tables.length) return { width: text ? measure(text, faceStyle(face), face.family).width : 0, dx: null }
  const key = face.tables[0]! + (face.kern ? 'k' : '') + '\n' + text
  const hit = lineCache.get(key)
  if (hit) return hit
  const tabs = face.tables.map(tableOf)
  const kern = face.kern ? tableOf(face.kern).kern : null
  let width = 0
  let dx: number[] | null = null
  let unknown = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!
    let w: number | undefined
    for (const t of tabs) { w = t.width.get(code); if (w !== undefined) break }
    if (w === undefined) unknown += String.fromCodePoint(code)
    else width += w / 1000
    if (kern && i > 0) {
      const k = kern.get(text[i - 1]! + text[i]!)
      if (k) { (dx ??= new Array<number>(text.length).fill(0))[i] = k / 1000; width += k / 1000 }
    }
    if (code > 0xffff) i++
  }
  if (unknown) width += measure(unknown, faceStyle(face), face.family).width
  const out = { width, dx }
  if (lineCache.size >= LINE_CACHE_SIZE) lineCache.clear()
  lineCache.set(key, out)
  return out
}
/** For tests and for a measurer that changed (the browser's replaces the estimate once the fonts are in). */
export const clearLineCache = (): void => lineCache.clear()
