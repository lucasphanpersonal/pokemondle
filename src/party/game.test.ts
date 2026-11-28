import { describe, expect, it } from 'vitest'
import type { Category } from '../lib/party/types.ts'
import { POKEDEX, POKEDEX_BY_ID } from '../lib/pokedex.ts'
import { ART_H, ART_W, BODY, FUSE, FUSE_H, fuseGrid, fusePaths } from './fuseArt.ts'
import {
  checkLocally,
  fuseCells,
  HURRY_MS,
  livesText,
  nextTick,
  timeUpDue,
  turnKeyOf,
  railPlayers,
  railScrollFor,
  sortedParts,
  speciesLeftFor,
  tickKey,
  timerState,
  turnText,
  usedSpecies,
} from './game.ts'
import { partyNotes } from './sounds.ts'
import type { GamePlayer } from './types.ts'

const byName = (name: string) => POKEDEX.find((p) => p.name === name)!

const players: GamePlayer[] = [
  { id: 'a', nickname: 'Ash', icon: 1, lives: 3, out: false, online: true },
  { id: 'm', nickname: 'Misty', icon: 4, lives: 1, out: false, online: true },
  { id: 'b', nickname: 'Brock', icon: 7, lives: 0, out: true, online: false },
]

describe('timerState', () => {
  const end = 100_000
  it('counts whole seconds up, like a countdown', () => {
    expect(timerState(end, 20, end - 20_000).seconds).toBe(20)
    expect(timerState(end, 20, end - 12_300).seconds).toBe(13)
    expect(timerState(end, 20, end - 1).seconds).toBe(1)
    expect(timerState(end, 20, end).seconds).toBe(0)
    expect(timerState(end, 20, end + 5000).remainingMs).toBe(0)
  })

  it('burns the fuse from full to nothing', () => {
    expect(timerState(end, 20, end - 20_000).fuse).toBe(1)
    expect(timerState(end, 20, end - 10_000).fuse).toBe(0.5)
    expect(timerState(end, 20, end).fuse).toBe(0)
    // A late-arriving deadline never overfills the fuse.
    expect(timerState(end, 20, end - 25_000).fuse).toBe(1)
  })

  it('hurries in the last 5 s: flashes twice a second and swells to 1.25', () => {
    const calm = timerState(end, 20, end - HURRY_MS - 1)
    expect(calm.phase).toBe('calm')
    expect(calm.flash).toBe(false)
    expect(calm.swell).toBe(1)
    const start = timerState(end, 20, end - HURRY_MS)
    expect(start.phase).toBe('hurry')
    expect(start.swell).toBe(1)
    const half = timerState(end, 20, end - 2500)
    expect(half.swell).toBeCloseTo(1.125)
    expect(timerState(end, 20, end - 1).swell).toBeCloseTo(1.25, 3)
    // On for the second half of each half second.
    expect(timerState(end, 20, end - 4900).flash).toBe(true)
    expect(timerState(end, 20, end - 4600).flash).toBe(false)
    expect(timerState(end, 20, end - 4400).flash).toBe(true)
    expect(timerState(end, 20, end).phase).toBe('done')
    expect(timerState(end, 20, end).flash).toBe(false)
  })
})

describe('fuseCells', () => {
  it('drops a cell once it is fully spent', () => {
    expect(fuseCells(1, 6)).toBe(6)
    expect(fuseCells(0.99, 6)).toBe(6)
    expect(fuseCells(5 / 6, 6)).toBe(5)
    expect(fuseCells(0.01, 6)).toBe(1)
    expect(fuseCells(0, 6)).toBe(0)
    expect(fuseCells(-1, 6)).toBe(0)
    expect(fuseCells(2, 6)).toBe(6)
  })
})

describe('tickKey', () => {
  it('changes once a second, then twice a second in the last 5', () => {
    const keys = (from: number, to: number, step: number) => {
      const out = new Set<string | null>()
      for (let ms = from; ms > to; ms -= step) out.add(tickKey(ms))
      return out.size
    }
    expect(keys(15_000, 5_000, 10)).toBe(10)
    expect(keys(5_000, 0, 10)).toBe(10)
    expect(tickKey(0)).toBeNull()
  })
})

describe('the rail', () => {
  it('keeps turn order and marks whose turn it is, who is me and lives lost', () => {
    const rail = railPlayers({ players, turnPlayerId: 'm', meId: 'a', startLives: 3 })
    expect(rail.map((p) => p.id)).toEqual(['a', 'm', 'b'])
    expect(rail.map((p) => p.isTurn)).toEqual([false, true, false])
    expect(rail.map((p) => p.isMe)).toEqual([true, false, false])
    expect(rail.map((p) => p.lost)).toEqual([0, 2, 3])
  })

  it('says lives in words for screen readers', () => {
    expect(livesText(2, 3, false)).toBe('2 of 3 lives left')
    expect(livesText(1, 1, false)).toBe('1 of 1 life left')
    expect(livesText(0, 3, true)).toBe('Out, no lives left')
  })

  it('centres the active tile, within the scrollable range', () => {
    expect(railScrollFor(400, 100, 300, 1000)).toBe(300)
    expect(railScrollFor(0, 100, 300, 1000)).toBe(0)
    expect(railScrollFor(900, 100, 300, 1000)).toBe(700)
  })
})

describe('turnText', () => {
  const fire: Category = [{ kind: 'stage', value: 2 }, { kind: 'type', value: 'Fire' }]
  it('prompts this player on their turn', () => {
    expect(turnText({ players, turnPlayerId: 'a', meId: 'a', category: fire })).toEqual({
      mine: true,
      prompt: 'Your turn! Name a Fire type, Stage 2!',
      waiting: '',
    })
  })
  it("names the player who is thinking on someone else's turn", () => {
    const t = turnText({ players, turnPlayerId: 'm', meId: 'a', category: fire })
    expect(t.mine).toBe(false)
    expect(t.prompt).toBe("Misty's turn: a Fire type, Stage 2.")
    expect(t.waiting).toBe('Misty is thinking…')
  })
  it('tells an out player or a late arrival they are watching', () => {
    expect(turnText({ players, turnPlayerId: 'm', meId: 'b', category: fire }).prompt).toMatch(/^You're out/)
    expect(turnText({ players, turnPlayerId: 'm', meId: 'zz', category: fire }).prompt).toMatch(/^You're watching/)
  })
})

describe('answers', () => {
  const fire: Category = [{ kind: 'type', value: 'Fire' }]
  const said = [{ pokemonId: byName('Vulpix').id }]
  it('collects the species said, so a form of one counts as said', () => {
    expect(usedSpecies(said, POKEDEX_BY_ID)).toEqual(new Set([37]))
    const check = checkLocally(fire, byName('Vulpix'), said, POKEDEX_BY_ID)
    expect(check.ok).toBe(false)
    expect(checkLocally(fire, byName('Squirtle'), said, POKEDEX_BY_ID)).toMatchObject({ ok: false, reason: "Squirtle isn't a Fire type" })
    expect(checkLocally(fire, byName('Charmander'), said, POKEDEX_BY_ID)).toEqual({ ok: true })
  })
  it('counts the species left', () => {
    const all = speciesLeftFor(fire, [], POKEDEX, POKEDEX_BY_ID)
    expect(speciesLeftFor(fire, said, POKEDEX, POKEDEX_BY_ID)).toBe(all - 1)
  })
  it('sorts parts in the display order', () => {
    expect(sortedParts([{ kind: 'stage', value: 2 }, { kind: 'type', value: 'Fire' }]).map((p) => p.kind)).toEqual(['type', 'stage'])
  })
})

describe('the fuse timer art', () => {
  it('is a 16-wide grid with the fuse above the body', () => {
    const grid = fuseGrid(FUSE.length, true)
    expect(grid).toHaveLength(ART_H)
    expect(grid.every((r) => r.length === ART_W)).toBe(true)
    expect(grid.slice(FUSE_H)).toEqual(BODY)
  })
  it('draws one fuse cell per cell left, and a spark only on a lit fuse', () => {
    const count = (g: string[], ch: string) => g.join('').split(ch).length - 1
    for (let n = 0; n <= FUSE.length; n++) {
      // The spark's core covers the tip cell.
      expect(count(fuseGrid(n, false), 'F')).toBe(n)
      expect(count(fuseGrid(n, true), 'O')).toBe(n > 0 ? 1 : 0)
    }
    expect(count(fuseGrid(0, true), 'S')).toBe(0)
  })
  it('flashes the body white', () => {
    const colours = (flash: boolean) => fusePaths(6, true, 0, flash).map((p) => p.color)
    expect(colours(false)).toContain('#4a5a78')
    expect(colours(true)).not.toContain('#4a5a78')
    expect(colours(true)).toContain('#202830')
  })
})

describe('party sounds', () => {
  it('has notes for every effect', () => {
    for (const name of ['tick', 'tock', 'chime', 'buzz'] as const) expect(partyNotes(name).length).toBeGreaterThan(0)
  })
})

describe('turn identity', () => {
  it('names a turn by round, turn number and player, not by its deadline', () => {
    const a = turnKeyOf({ round: 2, turnNo: 5, turnPlayerId: 'm' })
    expect(turnKeyOf({ round: 2, turnNo: 5, turnPlayerId: 'm' })).toBe(a)
    expect(turnKeyOf({ round: 2, turnNo: 6, turnPlayerId: 'm' })).not.toBe(a)
    expect(turnKeyOf({ round: 3, turnNo: 5, turnPlayerId: 'm' })).not.toBe(a)
    expect(turnKeyOf({ round: 2, turnNo: 5, turnPlayerId: null })).not.toBe(a)
  })
})

describe('nextTick', () => {
  it('stays quiet on the first draw of a turn, then ticks on each new tick', () => {
    let m = nextTick(null, 't1', 's20')
    expect(m.play).toBeNull()
    m = nextTick(m.memory, 't1', 's20')
    expect(m.play).toBeNull()
    m = nextTick(m.memory, 't1', 's19')
    expect(m.play).toBe('tick')
    m = nextTick(m.memory, 't1', 'h10')
    expect(m.play).toBe('tock')
    // A new turn starts quietly, even though its tick differs from the last turn's.
    m = nextTick(m.memory, 't2', 's17')
    expect(m.play).toBeNull()
    expect(nextTick(m.memory, 't2', null).play).toBeNull()
  })
})

describe('timeUpDue', () => {
  it('fires once per turn, however often the done countdown is drawn', () => {
    let announced: string | null = null
    let fired = 0
    for (const [turn, done] of [['t1', false], ['t1', true], ['t1', true], ['t1', true], ['t2', false], ['t2', true], ['t2', true]] as const) {
      if (timeUpDue(announced, turn, done)) {
        announced = turn
        fired++
      }
    }
    expect(fired).toBe(2)
  })
})
