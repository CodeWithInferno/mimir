// Stub-viewer scene that reports 12 diagnostics: ten warnings first, two errors last.
import { scene } from 'mimir'

export default scene({ title: 'Many diagnostics' }, (s) => {
  s.dot()
  s.step('Only step', 2)
  for (let i = 1; i <= 10; i++) {
    s.diag({ code: 'TEXT-OVERLAP', severity: 'warn', step: 1, t: 2, ids: [`label${i}`], line: 10 + i, measured: i, limit: 0,
      what: `label #label${i} overlaps its neighbour by ${i} px.`, fix: [`label${i}.nextTo(label${i - 1}, "down")`] })
  }
  s.diag({ code: 'FLOATING', severity: 'error', step: 1, t: 2, ids: ['valve'], line: 30, measured: 0.4, limit: 0.01,
    what: '#valve touches nothing; the nearest part is 0.4 units away.', fix: ['valve.attach(head)'] })
  s.diag({ code: 'DEAD-PARAM', severity: 'error', ids: ['rpm'], line: 31, what: 'parameter rpm changes nothing on screen.', fix: ['use rpm() in a dynamic prop'] })
})
