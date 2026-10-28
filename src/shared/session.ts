import { Game, type BotDifficulty } from './game'
import type { Input } from './physics'
import { emptyStats, type Stats } from './protocol'
export type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void }
const statsKey = 'crosscut-solo-stats-v1'
export function readStats(storage: Storage): Stats {
  try {
    const value = JSON.parse(storage.getItem(statsKey) ?? '{}')
    const stats = emptyStats()
    for (const key of Object.keys(stats) as (keyof Stats)[])
      if (Number.isSafeInteger(value[key]) && value[key] >= 0) stats[key] = value[key]
    return stats
  } catch { return emptyStats() }
}
export class SoloSession {
  game: Game
  paused = true
  private sequence = 0
  constructor(name: string, storage: Storage, options: { seed?: number; difficulty?: BotDifficulty; adaptive?: boolean } = {}) {
    this.game = new Game(options)
    this.game.add('you', name)
    for (const name of ['Flint', 'Mica', 'Slate', 'Onyx', 'Jasper'])
      this.game.add(name.toLowerCase(), name, true)
    this.game.onResult = (_id, earned) => {
      const stats = readStats(storage)
      for (const key of Object.keys(stats) as (keyof Stats)[]) stats[key] += earned[key]
      storage.setItem(statsKey, JSON.stringify(stats))
    }
  }
  step(input: Input) {
    if (this.paused) return
    this.game.enqueue('you', [{ ...input, seq: ++this.sequence }])
    this.game.tick()
    return this.game.snapshot()
  }
  save() {
    const player = this.game.actors.get('you')
    if (player) this.game.save(player, false)
  }
  finish() {
    this.paused = true
    this.game.remove('you')
  }
}
