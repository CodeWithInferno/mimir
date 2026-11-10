// Stub-viewer scene: 2D only (never loads the 3D chunk), no diagnostics.
import { scene } from 'mimir'

export default scene({ title: 'Clean pipeline' }, (s) => {
  s.param('hue', { value: 120, min: 0, max: 360 })
  s.dot({ id: 'dot', label: 'Token' })
  s.step('Enqueue', 1.5)
  s.step('Process', 2.5)
})
