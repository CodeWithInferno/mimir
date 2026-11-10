// Stub-viewer scene that imports a sibling module by a relative path.
import { scene } from 'mimir'
import { STEPS } from './lib/steps.js'

export default scene({ title: 'Modular CPU' }, (s) => {
  s.dot()
  for (const [title, seconds] of STEPS) s.step(title, seconds)
})
