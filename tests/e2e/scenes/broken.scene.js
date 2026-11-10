// Stub-viewer scene that fails while it is being imported.
import { scene } from 'mimir'

const piston = undefined
piston.at(0, 1, 0)

export default scene({ title: 'never built' }, () => {})
