// quick-handshake: explain() with the engine's sequence() as a block. The story reveals the messages one by one;
// `lost` stops a message short at a cross and `retry` marks the one that is sent again. Nothing is positioned or timed.
import { explain, sequence } from 'mimir'

export default explain({
  title: 'A handshake that survives a lost packet',
  stage: {
    wire: sequence({ actors: ['client', 'server'], messages: [
      ['client', 'server', 'SYN'], ['server', 'client', 'SYN-ACK'], ['client', 'server', 'ACK'],
      ['server', 'client', 'SYN-ACK again'], ['client', 'server', 'ACK'],
    ] }),
  },
  story: [
    { say: 'The [client](wire.client) wants to talk, so it sends a SYN.', wire: { upTo: 1 } },
    { say: 'The [server](wire.server) agrees: it answers with a SYN-ACK.', wire: { upTo: 2 } },
    { say: 'The client confirms with an ACK, but this [packet](wire.m3) is lost on the way.', wire: { upTo: 3, lost: 3 } },
    { say: 'The server hears nothing. After a timeout it sends its SYN-ACK [again](wire.m4).', wire: { upTo: 4, retry: 4 } },
    { say: 'This time the ACK arrives, and both sides know the other one is listening.', wire: { upTo: 5 } },
  ],
})
