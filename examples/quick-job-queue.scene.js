// How a job queue survives a failing worker. One line describes the system; a seeded simulation runs it, and every
// number on screen (the line at the queue, the counts, the chart) is read from that one run.
import { explain, flow, chart } from 'mimir'

export default explain({
  title: 'How a job queue survives a failing worker',
  stage: {
    system: flow('producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters',
                 { jobs: { count: 30, every: 0.8, service: [0.9, 1.4], seed: 7 } }),
    depth: chart({ x: 'time', y: 'jobs waiting', follow: 'system.queue' }),
  },
  story: [
    { say: 'Jobs travel one line: from the [producer](system.producer) into a [queue](system.queue), to a worker, and on to the [database](system.database).', system: { until: 6 } },
    { say: 'Three workers keep up, so the queue stays almost empty.', system: { until: 12 } },
    { say: 'Then a [worker](system.worker2) crashes. Its job goes to [retry](system.retry), waits, and joins the queue again.', system: { crash: 'worker2', until: 20 } },
    { say: 'Two workers are too few. The [line](depth) grows until the producer stops.', system: { until: 27 } },
    { say: 'A poison job fails on every worker. Each retry waits twice as long, then it is set aside as [dead](system.deadLetters).', system: { poison: 1, until: 'end' } },
    { say: 'Nothing is lost. Every job that came [in](system.in) is done, queued, in flight or dead, and the counts add up.', system: { show: 'conservation' } },
  ],
})
