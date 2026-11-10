// real-viewer fixture: parses, but imports ./lib/bad.js, which does not.
import { scene, rect } from 'mimir'
import { steps } from './lib/bad.js'
export default scene({ title: 'Nested' }, (s) => { rect({ width: 2, height: 1 }) })
