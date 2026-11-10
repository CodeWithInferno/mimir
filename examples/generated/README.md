# Written by a model in one call

Each scene here is what a language model answered to one request through `mimir new`, saved as it came back:
nothing was edited afterwards. The request is the file name.

| Scene | Request | Lines |
|---|---|---|
| `wankel-rotary-engine` | how does a Wankel rotary engine work | 38 |
| `job-queue-with-retries` | how does a job queue with retries and a dead letter queue work | 16 |
| `geneva-drive-turn-steady` | how does a Geneva drive turn steady rotation into steps | 63 |
| `four-stroke-engine` | how does a four-stroke engine work | 55 |
| `gradient-descent-find-minimum` | how does gradient descent find a minimum | 34 |
| `lever` | how does a lever work | 40 |
| `tcp-three-way-handshake` | how does a TCP three-way handshake work | 22 |

```sh
bin/mimir open examples/generated/wankel-rotary-engine.scene.js
bin/mimir export examples/generated/wankel-rotary-engine.scene.js --mp4 wankel.mp4
```

They are a record of what one call gives, not a gallery of the best the engine can draw: the hand-written
`examples/quick-*.scene.js` are tidier. The rotary engine is close to the worked example on the reference page.
