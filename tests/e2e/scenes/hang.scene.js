// Stub-viewer scene that never finishes loading (top-level await that never settles).
import { scene } from 'mimir'

await new Promise(() => {})

export default scene({ title: 'never ready' }, () => {})
