import { explain, sequence } from 'mimir'

export default explain({
  title: 'How a TCP three-way handshake works',
  stage: {
    wire: sequence({
      actors: ['client', 'server'],
      messages: [
        ['client', 'server', 'SYN'],
        ['server', 'client', 'SYN-ACK'],
        ['client', 'server', 'ACK'],
      ],
    }),
  },
  story: [
    { say: 'A [client](wire.client) wants to talk to a [server](wire.server), but neither knows if the other is ready.', wire: { upTo: 0 } },
    { say: 'The client sends a [SYN](wire.m1): "I want to connect, and my numbers start here."', wire: { upTo: 1 } },
    { say: 'The server answers with a [SYN-ACK](wire.m2): "Got it, and here are my numbers."', wire: { upTo: 2 } },
    { say: 'The client confirms with an [ACK](wire.m3). Both sides now know the other can hear them.', wire: { upTo: 3 } },
    { say: 'The connection is open, and data can flow both ways.', wire: { upTo: 'end' } },
  ],
})
