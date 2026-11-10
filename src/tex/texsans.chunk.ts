// Lazy chunk dist/mimir.texsans.js: the sans-serif faces and the typewriter face.
// Loaded only by scenes whose formulas need it (src/tex/index.ts: fontGroups); the export inlines it like any chunk,
// so an exported scene needs no network and no installed font. The module is ready when the faces can be drawn with.
import { installFaces } from './index.ts'
import { FACES } from './fonts/sans.ts'

await installFaces(FACES)
