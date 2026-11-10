// How a load balancer spreads requests over three servers, and what it does when one of them goes down.
import { explain, flow, chart } from 'mimir'

export default explain({
  title: 'How a load balancer spreads requests',
  stage: {
    site: flow('clients -> balancer[6] -> server*3 -> database', { jobs: { count: 36, every: 0.5, service: [1.2, 1.8], seed: 3 } }),
    waiting: chart({ x: 'time', y: 'requests waiting', follow: 'site.balancer' }),
  },
  story: [
    { say: 'Every request from the [clients](site.clients) arrives at one address: the [balancer](site.balancer).', site: { until: 5 } },
    { say: 'It hands each request to a [server](site.server1) that is free, so the work is shared between three.', site: { until: 12 } },
    { say: 'When [one server](site.server2) crashes, the balancer simply stops sending to it.', site: { crash: 'server2', until: 20 } },
    { say: 'Two servers are slower than three, so a [line](waiting) builds up at the balancer.', site: { until: 28 } },
    { say: 'The server recovers and the line drains.', site: { recover: 'server2', until: 'end' } },
    { say: 'No request was lost: [in](site.in) = [done](site.done) + queued + in flight.', site: { show: 'conservation' } },
  ],
})
