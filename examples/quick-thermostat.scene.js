// How a bimetal thermostat switches: a strip clamped at one end bends as it warms until its tip closes a contact.
// Nothing here is a kit part; the strip is one extrude() whose origin is its clamped end.
import { explain, machine, chart, box, cylinder, extrude, GOLD, RED } from 'mimir'

const LENGTH = 2.7, THICK = 0.08
const CLOSED = 5.5                                             // degrees of bend at which the tip reaches the contact
const bend = (c) => Math.min(Math.max(c.temperature - 20, 0) / 4, CLOSED)

export default explain({
  title: 'How a bimetal thermostat switches',
  controls: { temperature: { from: 10, to: 60, value: 20, unit: '°C' } },
  stage: {
    thermo: machine({
      parts: {
        base: box({ width: 4, height: 0.3, depth: 1 }),
        post: box({ width: 0.4, height: 1, depth: 0.8 }).define('clamp', [0.2, 0.3, 0]),
        strip: extrude([[0, -THICK / 2], [LENGTH, -THICK / 2], [LENGTH, THICK / 2], [0, THICK / 2]], { depth: 0.6, color: GOLD }).define('tip', [LENGTH, 0, 0]),
        contact: cylinder({ radius: 0.12, height: 0.5, color: RED }),
      },
      joints: [
        ['post', 'on', 'base.top', { my: 'bottom', offset: [-1.6, 0, 0] }],
        ['contact', 'on', 'base.top', { my: 'bottom', offset: [1.2, 0, 0] }],
        ['strip', 'spins', { by: (c) => -bend(c), about: 'z', at: 'post.clamp' }],
      ],
      probes: { gap: (c, m) => m.point('strip.tip')[1] - THICK / 2 - m.point('contact.top')[1] },
    }),
    gap: chart({ x: 'temperature', y: 'gap to the contact', curve: ({ thermo }) => thermo.probe('gap') }),
  },
  story: [
    { say: 'A [strip](thermo.strip) of two metals is clamped at one end. Below its tip sits a [contact](thermo.contact).', set: { temperature: 20 } },
    { say: 'Heat it and one metal grows more than the other, so the strip has to bend.', set: { temperature: 34 }, thermo: { camera: 'front' } },
    { say: 'At about 42 degrees the tip touches the contact and the circuit closes.', set: { temperature: 42 }, thermo: { highlight: ['strip', 'contact'] } },
    { say: 'Hotter than that changes nothing: the [gap](gap) stays at zero.', set: { temperature: 60 } },
    { say: 'Cool it down and the strip straightens, the contact opens, and the heater switches back on.', set: { temperature: 15 } },
  ],
})
