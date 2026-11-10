// Lazy chunk dist/mimir.texams.js: the AMS face: blackboard bold and the AMS symbols.
// Loaded only by scenes whose formulas need it (src/tex/index.ts: fontGroups); the export inlines it like any chunk,
// so an exported scene needs no network and no installed font. The module is ready when the faces can be drawn with.
import { installFaces } from './index.ts'
import { FACES } from './fonts/ams.ts'

await installFaces(FACES)
