// A fixture for tests/unit/r3d/browser.test.ts: a ball bearing cut through its middle, seen from the front.
// Its races are one mesh, its balls are copies of one sphere (an instanced mesh): both must show a section face.
import { scene, kit } from 'mimir'

export default scene({ title: 'cut copies' }, (s) => {
  // bore 1.4 (a diameter), outside radius 1.6: the balls run on the circle half way between, at radius 1.15
  const bearing = kit.bearing({ id: 'bearing', bore: 1.4, radius: 1.6, width: 0.9, balls: 8 })
  s.step('whole', (st) => { st.camera({ view: 'front', fit: [bearing], duration: 0 }); st.wait(1) })
  s.step('cut', (st) => { st.cutaway({ axis: 'z', at: 0, parts: [bearing] }, { duration: 1 }); st.wait(1) })
})
