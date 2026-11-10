// What the block tests need from the real explain(): the function itself and, after a scene was compiled, the handles
// and final states of its blocks (`last`), read from the scene built last (quickBlocks()).
import '../../../src/guide/index.ts'
import { explain as real, quickBlocks } from '../../../src/quick/index.ts'
import type { BlockHandle } from '../../../src/quick/block.ts'

export const explain = (spec: unknown): any => real(spec as never)
export const last = {
  get handles(): Record<string, BlockHandle<any>> { return quickBlocks().handles },
  get states(): Record<string, any> { return quickBlocks().states },
}
