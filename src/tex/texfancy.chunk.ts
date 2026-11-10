// Lazy chunk dist/mimir.texfancy.js: the rarer alphabets: Fraktur (regular and bold) and Script.
// Loaded only by scenes whose formulas need it (src/tex/index.ts: fontGroups); the export inlines it like any chunk,
// so an exported scene needs no network and no installed font. The module is ready when the faces can be drawn with.
import { installFaces } from './index.ts'
import { FACES } from './fonts/fancy.ts'

await installFaces(FACES)
