// hello-2d: three boxes with arrows and text. Placement by relation (row, nextTo, at(target)); a param drives a value.
import { scene, rect, text, arrow, row, write, create, fadeIn, lagged, mix, BLUE, TEAL, GREEN, RED, YELLOW, GREY_B, UP } from 'mimir'

export default scene({ title: 'Requests through a queue' }, (s) => {
  const load = s.param('load', { value: 20, min: 0, max: 100, unit: '%', label: 'Queue load' })

  const title = text('Requests through a queue', { size: 'section' }).at(0, 3.1)

  const client = rect({ id: 'client', width: 2.6, height: 1.5, radius: 0.18, color: BLUE }).fill(BLUE, 0.15)
  const queue = rect({ id: 'queue', width: 2.6, height: 1.5, radius: 0.18, color: () => mix(GREEN, RED, load() / 100) })
    .fill(() => mix(GREEN, RED, load() / 100), 0.15)
  const worker = rect({ id: 'worker', width: 2.6, height: 1.5, radius: 0.18, color: TEAL }).fill(TEAL, 0.15)
  row([client, queue, worker], { gap: 1.6 }).at(0, 0.3)

  const names = [text('Client', { size: 'label' }).at(client), text('Queue', { size: 'label' }).at(queue), text('Worker', { size: 'label' }).at(worker)]
  const send = arrow(client, queue)
  const take = arrow(queue, worker)

  // a bar under the queue whose length is the load, and the number next to it
  const track = rect({ id: 'track', width: 2.6, height: 0.16, radius: 0.08, color: GREY_B, strokeWidth: 1 }).nextTo(queue, 'down', 0.45)
  const level = rect({ id: 'level', width: () => 0.06 + 2.54 * (load() / 100), height: 0.16, radius: 0.08, strokeWidth: 0, fill: () => mix(GREEN, RED, load() / 100) })
    .at(() => [track.left()[0] + (0.06 + 2.54 * (load() / 100)) / 2, track.center()[1]])
  const readout = text(() => `load ${Math.round(load())}%`, { size: 'note', color: GREY_B }).nextTo(track, 'down', 0.25)

  s.step('Three parts', (st) => {
    st.say('A client, a queue and a worker.')
    st.play(write(title))
    st.play(lagged([create(client), create(queue), create(worker)], { lag: 0.3 }))
    st.play(lagged(names.map((n) => fadeIn(n, { shift: UP.map((c) => c * 0.25) })), { lag: 0.2 }))
  })

  s.step('Requests flow', (st) => {
    st.say('Requests wait in the queue until the worker takes them.')
    st.play(create(send), create(take), { lag: 0.5 })
    st.play(fadeIn(track), fadeIn(level), fadeIn(readout))
    st.label(queue, 'waiting requests')
  })

  s.step('Under load', (st) => {
    st.say('When requests arrive faster than they leave, the queue fills up.')
    st.set(load, 92)
    st.play(queue.to.scale(1.12), send.to.color(YELLOW))
    st.focus(queue, names[1], track, level, readout)
  })
})
