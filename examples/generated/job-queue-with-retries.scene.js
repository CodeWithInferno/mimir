import { explain, flow, chart } from 'mimir'
export default explain({
  title: 'How a job queue handles retries and dead letters',
  stage: {
    system: flow('producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters', {
      jobs: { count: 24, every: 1, service: [1.5, 2.2], seed: 5 },
    }),
    depth: chart({ x: 'time', y: 'jobs waiting', follow: 'system.queue' }),
  },
  story: [
    { say: 'The [producer](system.producer) adds jobs to a [queue](system.queue). [Workers](system.worker) take them one by one.', system: { until: 8 } },
    { say: 'A [worker](system.worker2) crashes. Its job goes to [retry](system.retry) and back into the queue.', system: { crash: 'worker2', until: 16 } },
    { say: 'A [poison job](system.deadLetters) fails everywhere. After three failures it is parked as a dead letter.', system: { poison: 1, until: 28 } },
    { say: 'Nothing is lost: every job is [done](system.done), waiting or [dead](system.dead).', system: { until: 'end', show: 'conservation' } },
  ],
})
