// The player's chrome (dist/mimir.player.js): loaded by the host only with a person watching, never for a headless
// frame. `mimir export` inlines it like any chunk the page loaded.
import { definePlayer } from '../core/index.ts'
import type { MimirHost } from '../host/index.ts'
import { createPlayer } from './app.ts'
import { mountCaption } from './caption.ts'
import { mountExplore } from './explore.ts'
import { mountHome } from './home.ts'
import { mountLayers } from './layers.ts'
import { mountNote } from './note.ts'
import { mountRead } from './read.ts'

definePlayer((host: MimirHost, root: HTMLElement) => {
  const { player, slot, transport, dispose } = createPlayer(host, root)
  mountCaption(player)
  mountRead(player)
  mountExplore(player)
  mountNote(player)
  mountLayers(player)
  mountHome(player)
  player.relayout()
  return { slot, dispose, transport }
})
