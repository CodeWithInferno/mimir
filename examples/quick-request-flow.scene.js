// How a request finds its answer, and what happens when a server goes down. The system is one line of text; the
// traffic is a seeded simulation, so hits, misses and the line at the balancer are counted, not drawn by hand.
import { explain, flow, chart } from 'mimir'

export default explain({
  title: 'How a request finds its answer',
  stage: {
    site: flow('client -> balancer[5] -> server*2 -> cache -miss 35%-> database',
               { jobs: { count: 36, every: 0.9, service: { server: [0.9, 1.3], cache: 0.3 }, seed: 11 } }),
    line: chart({ x: 'time', y: 'requests waiting', follow: 'site.balancer' }),
  },
  story: [
    { say: 'Every request goes from the [client](site.client) to a [balancer](site.balancer), which hands it to a free [server](site.server1).', site: { until: 6 } },
    { say: 'The server asks the [cache](site.cache) first. A hit ends there. Only a miss goes on to the [database](site.database).', site: { until: 13 } },
    { say: 'Then [one server](site.server1) goes down. The request it held goes back and waits its turn again.', site: { crash: 'server1', until: 21 } },
    { say: 'One server is not enough, so a [line](line) forms at the balancer.', site: { until: 28 } },
    { say: 'When the server comes back the line drains, and every request is answered.', site: { recover: 'server1', until: 'end', show: 'conservation' } },
  ],
})
