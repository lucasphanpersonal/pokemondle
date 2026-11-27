import { describe, expect, it } from 'vitest'
import { buildSharedFiles } from '../../../scripts/lib/partyShared.ts'

// Source files and committed copies are read as text by Vite (?raw), so this runs under Vitest without Node APIs.
const sources = import.meta.glob<string>(
  ['/src/lib/rng.ts', '/src/lib/party/categories.ts', '/src/lib/party/types.ts', '/src/config/partyConfig.ts', '/src/types/pokemon.ts', '/src/data/pokemon.json'],
  { query: '?raw', import: 'default', eager: true },
)
const committed = import.meta.glob<string>(['/supabase/functions/_shared/party/*'], { query: '?raw', import: 'default', eager: true })

describe('Party server copy (supabase/functions/_shared/party)', () => {
  const expected = buildSharedFiles((path) => {
    const text = sources[`/${path}`]
    if (text === undefined) throw new Error(`${path} is not in the drift test's source list`)
    return text
  })

  it.each([...expected.keys()])('%s matches src/ (run npm run party:sync)', (path) => {
    expect(committed[`/${path}`], 'run npm run party:sync').toBe(expected.get(path))
  })

  it('has no stale files in the copy folder (run npm run party:sync)', () => {
    expect(Object.keys(committed).sort(), 'run npm run party:sync').toEqual([...expected.keys()].map((p) => `/${p}`).sort())
  })
})
