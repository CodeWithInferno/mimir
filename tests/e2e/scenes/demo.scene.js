// Stub-viewer scene: three steps, a WebGL triangle, a dot, one parameter that changes the picture,
// and two deliberately reported diagnostics (one error, one warning).
import { scene } from 'mimir'

export default scene({ title: 'Stub engine' }, (s) => {
  const hue = s.param('hue', { value: 200, min: 0, max: 360 })
  s.param('speed', { value: 1, min: 0, max: 4 })
  s.triangle({ id: 'tri', label: 'Rotor' })
  s.dot({ id: 'dot', label: 'Token' })
  s.step('Intake', 2)
  s.step('Compression', 2)
  s.step('Power', 2)
  s.probe('hue', () => hue())
  s.diag({
    code: 'TEXT-TINY', severity: 'warn', step: 1, t: 1, ids: ['caption'], line: 9, measured: 11, limit: 14,
    what: 'label #caption is 11 px tall at 1280x720; the minimum is 14 px.',
    fix: ['text(…, { size: "label" })'],
  })
  s.diag({
    code: 'OFF-FRAME', severity: 'error', step: 2, t: 3.5, ids: ['tri'], line: 8, measured: 38, limit: 0,
    what: '#tri extends 38 px past the right edge of the frame.',
    fix: ['tri.nextTo(dot, "left")', 'tri.shift(-0.5, 0)'],
  })
})
