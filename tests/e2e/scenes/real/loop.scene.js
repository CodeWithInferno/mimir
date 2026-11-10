// a scene that never finishes building: the page cannot answer at all
import { scene, rect } from 'mimir'
export default scene({ title: 'loop' }, (s) => {
  rect({ id: 'a' })
  while (true) { /* forever */ }
})
