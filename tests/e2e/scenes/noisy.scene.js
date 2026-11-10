// Stub-viewer scene that writes to the console; the CLI must forward errors to stderr, never to stdout.
import { scene } from 'mimir'

console.error('boom from the scene console')

export default scene({ title: 'Noisy' }, (s) => {
  s.dot()
  s.step('One', 1)
})
