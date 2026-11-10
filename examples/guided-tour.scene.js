// guided-tour: a well windlass (a 3D assembly from primitives) beside a 2D diagram of why it is easy to turn,
// told in four steps that use every guide verb: point (the default), ring, label, arrow, glow and focus.
// The narration is the clock: the pointer leaves early enough to land on a part as its words are spoken.
import { scene, box, cylinder, tube, between, circle, rect, text, line, BLUE, YELLOW, TEAL, GOLD, GREY_B, GREY_C } from 'mimir'

export default scene({ title: 'How a windlass lifts a bucket' }, (s) => {
  s.viewport('right', 0.56)
  const turn = s.param('turn', { value: 0, min: 0, max: 450, unit: '°', label: 'Crank turn' })
  const DRUM_RADIUS = 0.45
  const DRUM_LENGTH = 3.2
  const ARM = 1.5 // the crank arm: three and a third drum radii
  // rope wound in = angle (in turns) x the drum's circumference; s.probe exposes it to check
  const rise = () => (turn() / 360) * 2 * Math.PI * DRUM_RADIUS

  // ── the windlass ───────────────────────────────────────────────────────────────────────────────────
  // the drum lies along x (a cylinder's axis is y: turned 90 degrees about z) and spins about its own axis
  const drum = cylinder({ id: 'drum', radius: DRUM_RADIUS, height: DRUM_LENGTH, color: YELLOW })
    .at(0, 2.2, 0)
    .rotate({ about: 'z', deg: 90 })
    .rotate({ about: 'x', deg: turn })
  drum.define('hub', [0, DRUM_LENGTH / 2 + 0.25, 0]) // just outside the drum's end, on its axis
  drum.define('grip', [0, DRUM_LENGTH / 2 + 0.36, ARM - 0.12]) // the far end of the arm
  const arm = box({ id: 'arm', width: 0.22, height: 0.22, depth: ARM, material: 'iron' }).attach(drum, { my: 'back', to: 'hub' })
  const handle = cylinder({ id: 'handle', radius: 0.13, height: 0.95, color: BLUE }).attach(drum, { my: 'bottom', to: 'grip' })
  const postLeft = box({ id: 'postLeft', width: 0.4, height: 5.2, depth: 0.5, material: 'aluminium' }).at(-1.35, 0, 0)
  const postRight = box({ id: 'postRight', width: 0.4, height: 5.2, depth: 0.5, material: 'aluminium' }).at(1.35, 0, 0)
  const wall = tube({ id: 'wall', radius: 1.9, thickness: 0.3, height: 1.1, material: 'glass' }).at(0, -3.1, 0)
  const bucket = tube({ id: 'bucket', radius: 0.5, thickness: 0.07, height: 0.8, color: TEAL }).at(0, () => -2.7 + rise(), 0)
  const rope = between(drum, bucket, { id: 'rope', radius: 0.05, color: GOLD })
  // declared for check: the drum turns in the two posts that carry it, and a rope that winds in gets shorter
  drum.allow('INTERPENETRATE', postLeft).allow('INTERPENETRATE', postRight)
  rope.allow('MECH-OPEN')
  s.probe('rise', rise)

  // ── the diagram: the hand goes round a wide circle, the rope winds on a small one ───────────────────
  const CX = -3.9
  const CY = 1.0
  const handPath = circle({ id: 'handPath', radius: 1.5, color: BLUE }).at(CX, CY)
  const drumPath = circle({ id: 'drumPath', radius: 0.45, color: YELLOW, fill: YELLOW, fillOpacity: 0.15 }).at(CX, CY)
  const spoke = line([CX, CY], handPath.right, { color: GREY_C })
  const push = rect({ id: 'push', width: 2.0, height: 0.8, color: BLUE }).at(CX - 1.5, -1.7)
  const pushText = text('long, light push', { size: 'note', color: GREY_B }).at(push)
  const pull = rect({ id: 'pull', width: 2.0, height: 0.8, color: GOLD }).at(CX + 1.5, -1.7)
  const pullText = text('short, strong pull', { size: 'note', color: GREY_B }).at(pull)

  s.step('The parts', (st) => {
    st.say('A [drum](drum) lies across two [posts](ring:postLeft+postRight).')
    st.say('A [rope](label:rope) hangs from it and carries the [bucket](label:bucket).')
  })

  s.step('Winding', (st) => {
    st.say('Turn the [handle](label:handle) and the [drum](glow:drum) winds the rope in.')
    st.say('Turn by turn, the [bucket](bucket) climbs out of the well.')
    st.set(turn, 450)
  })

  s.step('Two circles', (st) => {
    st.say('The hand travels round a [wide circle](ring:handPath).')
    st.say('The rope winds onto a [small one](glow:drumPath), a third as far.')
    st.label(spoke, 'crank arm')
  })

  s.step('The trade', (st) => {
    st.say('So a [long, light push](arrow:push->pull) turns into a short, strong pull.')
    st.say('That pull is what [lifts the water](focus:bucket).')
  })
})
