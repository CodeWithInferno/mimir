// The modules together: a kit mechanism in the 3D panel (left), a plot driven by the same param with a guide tie
// (right), a readout, a formula, narration whose spans land on 3D parts and on 2D objects, verbs, a chapter break,
// a small graph with tokens, flow particles, and the 2D camera. Every number shown is read back from the mechanism.
import { scene, kit, crankSlider, axes, guide, readout, tex, text, graph, edge, tokens, flow, write, create, derive, fadeIn, fadeOut, lagged, BLUE, TEAL, YELLOW, GOLD, GREY_B } from 'mimir'

export default scene({ title: 'A crank, a rod, a piston' }, (s) => {
  const mm = 0.02
  const bore = 86 * mm, stroke = 86 * mm, rodLength = 139 * mm
  const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°', label: 'Crank angle' })
  s.viewport('left', 0.42)

  // ── the model (left): kit parts, assembled by the mechanism ────────────────────────────────────────
  const crankshaft = kit.crankshaft({ id: 'crankshaft', throw: stroke / 2, journal: 55 * mm, crankpin: 45 * mm, pinLength: 26 * mm, webThickness: 18 * mm, overhung: true, material: 'iron' })
  const rod = kit.conRod({ id: 'rod', length: rodLength, bigEnd: 46 * mm, smallEnd: 22.5 * mm, thickness: 22 * mm, material: 'aluminium' })
  const piston = kit.piston({ id: 'piston', bore, pin: 22 * mm, color: BLUE })
  const cylinder = kit.liner({ id: 'cylinder', bore, height: 150 * mm, cut: 'half' }).at(0, 151 * mm, 0)
  const slide = crankSlider({ id: 'slide', crank: crankshaft, rod, slider: piston, axis: 'up', angle: crank })
  const model = [crankshaft, rod, piston, cylinder]

  // ── the plot (right): the piston's travel against the crank angle, traced by the mechanism itself ───
  const side = s.area()
  const title = text('Turning becomes sliding', { id: 'title', size: 'section' }).at(side.center[0], side.top - 0.35).hud() // a heading: the 2D camera does not move it
  const plot = axes({ id: 'plot', x: [0, 360], y: [0, 100], width: 5.4, height: 2.6, xUnit: '°', yUnit: '%', ticks: { x: 90, y: 50 } }).at(side.center[0] + 0.15, 1.05)
  const travel = () => 100 * slide.fraction()
  const curve = plot.trail(() => [crank(), travel()], { id: 'curve', color: BLUE, strokeWidth: 3 })
  const cursor = plot.dot(() => [crank(), travel()], { id: 'cursor', color: YELLOW })
  cursor.allow('TINY') // a dot is small by nature: the pointer and its ring make it findable
  const tie = guide(piston.anchor('crown'), cursor, { id: 'tie' })
  const reading = readout('travel', travel, { id: 'reading', unit: '%', decimals: 1, size: 'label' }).nextTo(plot, 'down', 0.45)
  const law = tex(String.raw`x(\theta) = r\cos\theta + \sqrt{l^2 - r^2\sin^2\theta}`, { id: 'law', size: 'label', colors: { [String.raw`\theta`]: YELLOW } }).nextTo(reading, 'down', 0.4)

  // ── chapter 2: what the motion is for ──────────────────────────────────────────────────────────────
  const chain = graph({
    id: 'chain',
    nodes: { gas: { label: 'gas', color: GOLD }, push: 'piston', turn: { label: 'crank', color: TEAL }, out: 'wheels' },
    edges: [['gas', 'push'], ['push', 'turn'], ['turn', 'out']],
    width: 5.6, height: 1.6,
  }).at(side.center[0], 1.6)
  const work = lagged([tokens(chain.edge('gas', 'push'), { id: 'workIn', count: 2, speed: 0.9, color: GOLD }), tokens(chain.edge('push', 'turn'), { id: 'workMid', count: 2, speed: 0.9, color: BLUE }), tokens(chain.edge('turn', 'out'), { id: 'workOut', count: 2, speed: 0.9, color: TEAL })].map((t) => fadeIn(t)), { lag: 0.2 })
  // the push reaches the model: an edge from a node of the diagram to a point of the 3D piston, with tokens on it (over the 3D panel)
  const link = edge(chain.node('push').top, piston.anchor('crown'), { id: 'link', dashed: true, color: GREY_B, bend: -0.25 })
  const pushes = tokens(link, { id: 'pushes', count: 2, speed: 1.4, color: GOLD })
  // a stream of particles under the diagram
  const charge = flow([[side.left + 0.2, -1.5], [side.right - 0.2, -1.5]], { id: 'charge', count: 40, speed: 1.4, spread: 0.28, size: 0.06, color: GOLD })
  const chargeName = text('pressure in, rotation out', { id: 'chargeName', size: 'note', color: GREY_B }).at(side.center[0], -2.3)

  s.chapter('The mechanism')
  s.step('The parts', (st) => {
    st.say('A [crankshaft](crankshaft) turns, and a [connecting rod](label:rod) ties its pin to a [piston](ring:piston).')
    st.play(lagged(model.map((part) => create(part)), { lag: 0.25 }), write(title))
    st.label(cylinder, 'cylinder, cut open')
  })
  s.step('Travel against angle', (st) => {
    st.say('Plot how far the piston has [travelled](cursor) against the crank angle. The [dashed line](tie) carries its height across.')
    st.play(create(plot), fadeIn(cursor), fadeIn(tie), fadeIn(curve), { lag: 0.2 })
    st.play(fadeIn(reading))
    st.set(crank, 180, { duration: 4 })
  })
  s.step('The law behind the curve', (st) => {
    st.say('The curve is not a plain cosine: the leaning rod adds a [square root](ring:law).')
    st.play(derive(curve, law, { duration: 1.5 }))
    st.set(crank, 360, { duration: 4 })
    st.focus(piston, rod, curve, cursor, tie, law)
  })

  s.chapter('What it is for', { keep: [...model, title] })
  s.step('Pressure becomes rotation', (st) => {
    st.say('In an engine the motion runs the other way: [gas](gas) pushes the piston, and the [crank](ring:turn) turns the wheels.')
    st.play(chain.draw())
    st.play(work, fadeIn(charge), fadeIn(chargeName))
    st.play(create(link), fadeIn(pushes))
    st.set(crank, 720 - 360, { duration: 5 })
  })
  s.step('A closer look', (st) => {
    st.say('Every token is a push handed on: from the gas to the piston, to the crank, to the road.')
    st.play(fadeOut(charge), fadeOut(chargeName))
    st.zoom(chain, { margin: 1.25 })
    st.set(crank, 180, { duration: 4 })
  })
})
