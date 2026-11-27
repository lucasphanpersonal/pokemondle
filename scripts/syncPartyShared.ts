/**
 * Copies Party's category engine and a slim dataset into supabase/functions/_shared/party/ for the Edge Function.
 * Run after changing any file in src/lib/party, src/lib/rng.ts, src/config/partyConfig.ts, src/types/pokemon.ts or
 * the dataset. The drift test (src/lib/party/sharedDrift.test.ts) fails until the copies are regenerated.
 *
 *   npm run party:sync
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { buildSharedFiles, SHARED_DIR } from './lib/partyShared.ts'

const fileUrl = (path: string): URL => new URL(`../${path}`, import.meta.url)
const files = buildSharedFiles((path) => readFileSync(fileUrl(path), 'utf8'))

mkdirSync(fileUrl(SHARED_DIR), { recursive: true })
for (const [path, content] of files) writeFileSync(fileUrl(path), content)
for (const name of readdirSync(fileUrl(SHARED_DIR))) {
  if (!files.has(`${SHARED_DIR}/${name}`)) unlinkSync(fileUrl(`${SHARED_DIR}/${name}`))
}
console.log(`Wrote ${files.size} files to ${SHARED_DIR}/`)
