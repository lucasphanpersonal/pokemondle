/**
 * Prints the Party category numbers quoted in the design doc: species per part, and how many categories each tier
 * could deal (columns and pool size within the tier, for a few room sizes).
 *
 *   npm run party-stats
 */
import { readFileSync } from 'node:fs'
import { PARTY_TIERS, requiredPool } from '../src/config/partyConfig.ts'
import { categoryColumns, partCatalog, partFamily, partLabel, poolOf } from '../src/lib/party/categories.ts'
import type { Category, Part, PartKind } from '../src/lib/party/types.ts'
import type { Pokemon } from '../src/types/pokemon.ts'

const dataset = JSON.parse(readFileSync(new URL('../src/data/pokemon.json', import.meta.url), 'utf8')) as Pokemon[]
const catalog = partCatalog(dataset)
const speciesCount = new Set(dataset.map((p) => p.dexNumber)).size
console.log(`Dataset: ${dataset.length} entries, ${speciesCount} species, ${catalog.length} parts\n`)

console.log('Species per part')
const kinds = [...new Set(catalog.map((p) => p.kind))] as PartKind[]
for (const kind of kinds) {
  const sized = catalog.filter((p) => p.kind === kind).map((p) => ({ part: p, n: poolOf([p], dataset) }))
  sized.sort((a, b) => b.n - a.n)
  const top = sized
    .slice(0, 3)
    .map((s) => `${partLabel(s.part)} ${s.n}`)
    .join(', ')
  console.log(`  ${kind.padEnd(9)} ${String(sized.length).padStart(3)} parts, ${sized[sized.length - 1].n} to ${sized[0].n}  (${top})`)
}

interface Found {
  category: Category
  pool: number
}

// Every category of up to 3 columns with at least the pool floor, grown part by part in catalog order.
const found: Found[] = []
const width = (part: Part) => (part.kind === 'pair' ? 2 : 1)
function grow(prefix: Part[], from: number, columns: number): void {
  if (prefix.length) found.push({ category: prefix, pool: poolOf(prefix, dataset) })
  for (let i = from; i < catalog.length; i++) {
    const part = catalog[i]
    if (columns + width(part) > 3) continue
    if (prefix.some((q) => partFamily(q) === partFamily(part))) continue
    const next = [...prefix, part]
    if (poolOf(next, dataset) < 6) continue // adding parts only shrinks a pool
    grow(next, i + 1, columns + width(part))
  }
}
grow([], 0, 0)

const count = (pred: (f: Found) => boolean) => found.filter(pred).length
const isShape = (c: Category, shape: PartKind[]) => c.length === shape.length && shape.every((k) => c.some((p) => p.kind === k))
console.log('\nCombinations')
console.log(`  type + stage pairs with 20+ species:        ${count((f) => isShape(f.category, ['type', 'stage']) && f.pool >= 20)}`)
console.log(`  type + Gen pairs with 10+ species:          ${count((f) => isShape(f.category, ['type', 'gen']) && f.pool >= 10)}`)
console.log(`  type + Gen + stage triples with 6+ species: ${count((f) => isShape(f.category, ['type', 'gen', 'stage']) && f.pool >= 6)}`)

console.log('\nCategories each tier can deal (right columns and pool range), by room size')
for (const tier of PARTY_TIERS) {
  const cells = [2, 4, 8].map((players) => {
    const min = requiredPool(tier, players)
    const n = count((f) => tier.columns.includes(categoryColumns(f.category)) && f.pool >= min && f.pool <= tier.maxPool)
    return `${players} players ${String(n).padStart(6)}`
  })
  const range = `${tier.minPool}-${tier.maxPool === Infinity ? 'up' : tier.maxPool}`
  console.log(`  ${tier.name.padEnd(7)} pool ${range.padEnd(6)} ${String(tier.seconds).padStart(2)}s   ${cells.join('   ')}`)
}
