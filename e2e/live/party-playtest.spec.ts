import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PARTY_TIERS } from '../../src/config/partyConfig.ts'
import { categoryKey, categorySentence, checkAnswer, fittingEntries, partFits, speciesLeft } from '../../src/lib/party/categories.ts'
import type { Category, Part } from '../../src/lib/party/types.ts'
import type { Pokemon } from '../../src/types/pokemon.ts'

/*
 * PLAYTEST HARNESS (not a regular test; skipped unless PLAYTEST_GAME is set). Run by .github/workflows/party-playtest.yml
 * against a LOCAL Supabase stack, never the live project.
 *
 * PLAYTEST_GAME="<players>p-<lives>" (e.g. 4p-3). N bots in N browser contexts (desktop, 390 px phone and tablet
 * viewports) play one whole game with the REAL dealt timers. Each bot answers through the page's search box, choosing
 * with the shared engine and a skill profile: a think time that rises with the tier, sometimes a wrong answer first,
 * sometimes a blank (time out), and weaker bots know fewer obscure Pokémon and fewer obscure columns (abilities, egg
 * groups, sizes). An observer polls the room and every screen and logs pace, pools, lives and any disagreement.
 * Output: test-results/playtest/<game>/ (log.json, summary.txt, screenshots, optional video).
 */

const API_URL = process.env.PARTY_API_URL ?? ''
const ANON_KEY = process.env.PARTY_ANON_KEY ?? ''
const GAME = process.env.PLAYTEST_GAME ?? ''
const CAP_MIN = Number(process.env.PLAYTEST_CAP_MIN ?? 45)
const VIDEO = process.env.PLAYTEST_VIDEO === '1'
const SEED = Number(process.env.PLAYTEST_SEED ?? 1)

test.skip(!API_URL || !ANON_KEY || !/^\dp-\d$/.test(GAME), 'playtest only: needs PLAYTEST_GAME and a local Supabase stack')

const [PLAYERS, LIVES] = GAME ? GAME.split('p-').map(Number) : [0, 0]
const OUT = join('test-results', 'playtest', GAME || 'none')

const DATASET: Pokemon[] = JSON.parse(readFileSync(new URL('../../src/data/pokemon.json', import.meta.url), 'utf8'))
const nameCount = new Map<string, number>()
for (const p of DATASET) nameCount.set(p.name.toLowerCase(), (nameCount.get(p.name.toLowerCase()) ?? 0) + 1)
const TYPEABLE = DATASET.filter((p) => nameCount.get(p.name.toLowerCase()) === 1)

// ------------------------------------------------------------------------------------------------ helpers ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const t0 = Date.now()
const el = (ms = Date.now()) => Math.round((ms - t0) / 100) / 10
function log(msg: string) {
  console.log(`[${el().toFixed(1).padStart(7)}s] ${msg}`)
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(Math.floor(hash(`${GAME}|${SEED}`) * 2 ** 31))
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const r1 = (x: number) => Math.round(x * 10) / 10

interface Room {
  id: string
  status: string
  lives: number
  game_no: number
  round: number
  turn_no: number
  category_no: number | null
  turn_player_id: string | null
  turn_seconds: number | null
  turn_started_at: string | null
  deadline: string | null
  winner_id: string | null
  last_event: { kind: string; round?: number; player_id?: string; said?: number[]; out?: boolean; exhausted?: boolean; over?: boolean } | null
}

async function rest<T>(path: string): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${API_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` } })
      if (res.status !== 200) throw new Error(`${path}: ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      if (i >= 4) throw e
      await sleep(300)
    }
  }
}
const getRoom = async (id: string) => (await rest<Room[]>(`party_rooms?id=eq.${id}&select=*`))[0]

const categoryCache = new Map<string, { parts: Category; tier: string; pool: number; seconds: number }>()
async function deckEntry(room: Room) {
  const key = `${room.game_no}|${room.category_no}`
  if (!categoryCache.has(key)) {
    const [row] = await rest<{ parts: Category; tier: string; pool: number; seconds: number }[]>(
      `party_categories?room_id=eq.${room.id}&game_no=eq.${room.game_no}&deck_no=eq.${room.category_no}&select=parts,tier,pool,seconds`,
    )
    categoryCache.set(key, row)
  }
  return categoryCache.get(key)!
}
async function usedSpecies(room: Room): Promise<Set<number>> {
  const rows = await rest<{ species: number }[]>(`party_answers?room_id=eq.${room.id}&game_no=eq.${room.game_no}&round=eq.${room.round}&select=species`)
  return new Set(rows.map((r) => r.species))
}

// ------------------------------------------------------------------------------------------------ the bots ----

type Skill = 'strong' | 'average' | 'weak'
const SKILLS: Skill[] = ['strong', 'average', 'weak', 'average', 'strong', 'weak', 'average', 'weak']
const NAMES = ['Ash', 'Misty', 'Brock', 'May', 'Dawn', 'Iris', 'Serena', 'Lillie']
type Device = 'desktop' | 'phone' | 'tablet'
const DEVICES: Device[] = ['desktop', 'phone', 'tablet', 'phone', 'desktop', 'phone', 'tablet', 'phone']

/** Skill profile. exp sharpens how much of the long tail (later gens, forms, obscure columns) a bot knows. */
const PROFILE: Record<Skill, { exp: number; baseS: number; wrongP: number; blankP: number; typeMs: number }> = {
  strong: { exp: 0.3, baseS: 3.2, wrongP: 0.1, blankP: 0.02, typeMs: 45 },
  average: { exp: 1, baseS: 4.5, wrongP: 0.18, blankP: 0.04, typeMs: 60 },
  weak: { exp: 2, baseS: 6, wrongP: 0.28, blankP: 0.06, typeMs: 80 },
}
const TIER_FACTOR: Record<string, number> = { easy: 1, medium: 1.3, hard: 1.6, expert: 1.9 }
const GEN_FAMILIARITY = [0, 1, 0.85, 0.8, 0.75, 0.6, 0.6, 0.55, 0.5, 0.5]
const FORM_FAMILIARITY: Record<string, number> = { base: 1, mega: 0.7, regional: 0.6, gmax: 0.4, other: 0.5, cosmetic: 0.2 }
/** How reliably a player recalls that a Pokémon fits each kind of part (before the skill exponent). */
const PART_RECALL: Record<string, number> = {
  type: 0.98, pair: 0.95, pure: 0.9, gen: 0.85, stage: 0.9, form: 0.95, color: 0.75, size: 0.6, ability: 0.45, eggGroup: 0.35,
}

interface Bot {
  i: number
  name: string
  skill: Skill
  device: Device
  ctx: BrowserContext
  page: Page
  id: string
  submitted: string | null
  turns: BotTurn[]
  errors: string[]
}
interface BotTurn {
  turnNo: number
  round: number
  tier: string
  seenAfterMs: number
  plan: string
  thinkMs: number
  known: number
  left: number
  wrongTries: number
  sentAtMs: number | null
  outcome: string
  enterToNextLive?: number
}

const familiarity = (p: Pokemon) => GEN_FAMILIARITY[p.generation] * (FORM_FAMILIARITY[p.formCategory] ?? 0.5)
const knowsEntry = (b: Bot, p: Pokemon) => hash(`${b.name}|e|${p.id}`) < familiarity(p) ** PROFILE[b.skill].exp
const recallsPart = (b: Bot, p: Pokemon, part: Part) =>
  hash(`${b.name}|p|${p.id}|${part.kind}`) < (PART_RECALL[part.kind] ?? 0.7) ** PROFILE[b.skill].exp

/** Valid unused typeable answers this bot would think of. */
function knownOptions(b: Bot, category: Category, used: Set<number>): Pokemon[] {
  const fits = fittingEntries(category, DATASET).filter((p) => !used.has(p.dexNumber) && nameCount.get(p.name.toLowerCase()) === 1)
  return fits.filter((p) => knowsEntry(b, p) && category.every((part) => recallsPart(b, p, part)))
}
function weightedPick(options: Pokemon[], b: Bot): Pokemon {
  // Weaker bots lean harder towards the most familiar Pokémon.
  const k = b.skill === 'weak' ? 3 : b.skill === 'average' ? 1.5 : 0.5
  const w = options.map((p) => familiarity(p) ** k + 0.01)
  let x = rng() * w.reduce((a, c) => a + c, 0)
  for (let i = 0; i < options.length; i++) if ((x -= w[i]) <= 0) return options[i]
  return options[options.length - 1]
}
function wrongPick(category: Category, used: Set<number>): Pokemon {
  // Half the time an answer already said (a common slip), else a familiar Pokémon that misses a part.
  if (used.size && rng() < 0.5) {
    const said = TYPEABLE.filter((p) => used.has(p.dexNumber) && p.formCategory === 'base')
    if (said.length) return said[Math.floor(rng() * said.length)]
  }
  const near = TYPEABLE.filter((p) => familiarity(p) > 0.7 && !checkAnswer(category, p, used).ok && category.some((part) => partFits(part, p)))
  const pool = near.length ? near : TYPEABLE.filter((p) => !checkAnswer(category, p, used).ok)
  return pool[Math.floor(rng() * pool.length)]
}

async function typeAndEnter(b: Bot, box: Locator, name: string): Promise<boolean> {
  try {
    await box.fill('')
    await box.pressSequentially(name, { delay: PROFILE[b.skill].typeMs })
    const first = b.page.getByRole('option').first()
    await expect(first).toContainText(name, { timeout: 2000 })
    if (!(await box.isEnabled())) return false
    await box.press('Enter')
    return true
  } catch (e) {
    b.errors.push(`type ${name}: ${(e as Error).message.split('\n')[0]}`)
    return false
  }
}

// ------------------------------------------------------------------------------------------------ the log ----

interface TurnRec {
  turnNo: number
  round: number
  player: string
  seconds: number
  startedAt: number
  deadline: number
  endedAt?: number
  outcome?: string
  usedS?: number
}
interface RoundRec {
  round: number
  tier: string
  category: string
  key: string
  pool: number
  seconds: number
  alive: number
  startedAt: number
  endedAt?: number
  end?: string
  loser?: string
  out?: boolean
  answers?: number
  leftAtEnd?: number
}
const problems: { at: number; kind: string; detail: string }[] = []
const problem = (kind: string, detail: string) => {
  problems.push({ at: el(), kind, detail })
  log(`!! ${kind}: ${detail}`)
}
const consoleErrors: string[] = []

async function newPlayer(browser: Browser, i: number): Promise<{ ctx: BrowserContext; page: Page }> {
  const device = DEVICES[i]
  const size = device === 'phone' ? { width: 390, height: 844 } : device === 'tablet' ? { width: 768, height: 1024 } : { width: 1280, height: 800 }
  const video = VIDEO && (i === 0 || i === 1) ? { recordVideo: { dir: join(OUT, 'video'), size } } : {}
  const ctx = await browser.newContext({ viewport: size, ...(device === 'desktop' ? {} : { hasTouch: true, isMobile: true }), ...video })
  await ctx.addInitScript(() => localStorage.setItem('pokemondle:volume', '0'))
  const page = await ctx.newPage()
  const who = `${NAMES[i]}(${device})`
  page.on('pageerror', (e) => {
    consoleErrors.push(`${el()}s ${who} pageerror: ${e.message}`)
    log(`[pageerror] ${who} ${e.message}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      consoleErrors.push(`${el()}s ${who} ${m.type()}: ${m.text().slice(0, 300)}`)
    }
  })
  return { ctx, page }
}

let shotNo = 0
async function shot(page: Page, name: string) {
  try {
    await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`) })
  } catch (e) {
    log(`screenshot ${name} failed: ${(e as Error).message.split('\n')[0]}`)
  }
}

// ------------------------------------------------------------------------------------------------ the game ----

test(`playtest ${GAME}`, async ({ browser }) => {
  test.setTimeout((CAP_MIN + 10) * 60_000)
  mkdirSync(OUT, { recursive: true })
  log(`Playtest ${GAME}: ${PLAYERS} players, ${LIVES} lives, cap ${CAP_MIN} min, seed ${SEED}`)

  const bots: Bot[] = []
  for (let i = 0; i < PLAYERS; i++) {
    const { ctx, page } = await newPlayer(browser, i)
    bots.push({ i, name: NAMES[i], skill: SKILLS[i], device: DEVICES[i], ctx, page, id: '', submitted: null, turns: [], errors: [] })
  }
  const host = bots[0]

  // ---- Lobby: host, set lives, everyone joins by the invite link, Start.
  await host.page.goto('/party/')
  await host.page.getByLabel('Your name').fill(host.name)
  await host.page.getByRole('button', { name: 'Host a room' }).click()
  await expect(host.page.locator('[data-screen=lobby]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => host.page.evaluate(() => location.hash)).toMatch(/^#[A-Z]{4}$/)
  const invite = host.page.url()
  if (LIVES !== 3) {
    const radio = host.page.getByTestId('party-lives').getByRole('radio', { name: String(LIVES), exact: true })
    await expect(async () => {
      if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click()
      await expect(radio).toHaveAttribute('aria-checked', 'true', { timeout: 3000 })
    }).toPass({ timeout: 20_000 })
  }
  for (const b of bots.slice(1)) {
    await b.page.goto(invite)
    await b.page.getByLabel('Your name').fill(b.name)
    await b.page.getByRole('button', { name: 'Join' }).click()
    await expect(b.page.locator('[data-screen=lobby]')).toBeVisible({ timeout: 20_000 })
  }
  await expect(host.page.getByTestId('party-players').locator('li')).toHaveCount(PLAYERS, { timeout: 15_000 })
  for (const b of bots) {
    const seat = await b.page.evaluate(() => JSON.parse(localStorage.getItem('pokemondle:party') ?? 'null') as { room_id: string; player_id: string })
    b.id = seat.player_id
  }
  const roomId = (await host.page.evaluate(() => JSON.parse(localStorage.getItem('pokemondle:party') ?? 'null') as { room_id: string })).room_id
  const byId = new Map(bots.map((b) => [b.id, b]))
  const nameOf = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? id.slice(0, 6)) : '-')
  const phone = bots.find((b) => b.device === 'phone')
  if (PLAYERS === 8 && phone) await shot(phone.page, 'lobby-8-phone')

  await expect(async () => {
    const r = await getRoom(roomId)
    expect(r.lives).toBe(LIVES)
  }).toPass({ timeout: 10_000 })
  await host.page.getByRole('button', { name: 'Start', exact: true }).click()
  const startRoom = await (async () => {
    for (;;) {
      const r = await getRoom(roomId)
      if (r.status === 'playing') return r
      await sleep(200)
    }
  })()
  const gameStart = Date.now()
  const deck = await rest<{ deck_no: number; tier: string; pool: number; seconds: number; parts: Category }[]>(
    `party_categories?room_id=eq.${roomId}&game_no=eq.${startRoom.game_no}&select=deck_no,tier,pool,seconds,parts&order=deck_no`,
  )
  log(`Started. Deck of ${deck.length}: ${PARTY_TIERS.map((t) => `${t.name} ${deck.filter((d) => d.tier === t.id).map((d) => d.pool).join('/')}`).join(' | ')}`)

  let stop = false
  let currentTurn: TurnRec | null = null
  const turns: TurnRec[] = []
  const rounds: RoundRec[] = []
  const timerDrift: number[] = []
  const answerLatency: number[] = []
  const nextLiveLatency: number[] = []
  const shots = { timeout: 0, cleared: 0, tier: 0, rail: 0 }
  const momentChecks: { round: number; kind: string; missedOn: string[]; alsoFitAgree?: boolean }[] = []

  // ---- One loop per bot: wait for my box to come alive, think, maybe slip, answer (or not).
  const botLoop = async (b: Bot) => {
    const box = b.page.getByLabel('Guess a Pokémon')
    let lastTurn = -1
    while (!stop) {
      try {
        await expect(box).toBeEnabled({ timeout: 3000 })
      } catch {
        continue
      }
      if (stop) break
      const seenAt = Date.now()
      const room = await getRoom(roomId)
      if (room.status !== 'playing') {
        await sleep(500)
        continue
      }
      if (room.turn_player_id !== b.id) {
        // Possibly the server already moved on (the box hasn't caught up) or a real disagreement: the observer judges it.
        await sleep(250)
        continue
      }
      if (room.turn_no === lastTurn) {
        await sleep(250)
        continue
      }
      lastTurn = room.turn_no
      const entry = await deckEntry(room)
      const category = entry.parts
      const used = await usedSpecies(room)
      const startedAt = Date.parse(room.turn_started_at!)
      const deadline = Date.parse(room.deadline!)
      const prof = PROFILE[b.skill]
      const options = knownOptions(b, category, used)
      const scarce = options.length <= 2 ? 1.3 : 1
      let thinkMs = 1000 * prof.baseS * TIER_FACTOR[entry.tier] * scarce * Math.exp(0.35 * gauss())
      thinkMs = Math.max(1800, thinkMs)
      let plan = 'answer'
      let wrongs = rng() < prof.wrongP ? (rng() < 0.25 ? 2 : 1) : 0
      if (!options.length) {
        plan = 'stumped'
        wrongs = 1 + (rng() < 0.5 ? 1 : 0)
      } else if (rng() < prof.blankP) plan = 'blank'
      const rec: BotTurn = {
        turnNo: room.turn_no,
        round: room.round,
        tier: entry.tier,
        seenAfterMs: seenAt - startedAt,
        plan,
        thinkMs: Math.round(thinkMs),
        known: options.length,
        left: speciesLeft(category, DATASET, used),
        wrongTries: 0,
        sentAtMs: null,
        outcome: 'pending',
      }
      b.turns.push(rec)
      const stillMine = async () => (await box.isEnabled()) && Date.now() < deadline
      // Wrong tries spread over the think time; each costs 1.5 to 3 s more.
      for (let w = 0; w < wrongs; w++) {
        await sleep(seenAt + thinkMs * (0.45 + 0.25 * w) - Date.now())
        if (!(await stillMine())) break
        const bad = wrongPick(category, used)
        if (await typeAndEnter(b, box, bad.name)) {
          rec.wrongTries++
          const wrong = b.page.getByTestId('party-wrong')
          await expect(wrong).not.toHaveText('', { timeout: 2000 }).catch(() => problem('wrong-no-reason', `${b.name} said ${bad.name}: no reason shown`))
          thinkMs += 1500 + rng() * 1500
        }
      }
      if (plan !== 'answer') {
        rec.outcome = plan
        b.submitted = null
        continue
      }
      const pick = weightedPick(options, b)
      const typeTime = pick.name.length * prof.typeMs + 300
      await sleep(seenAt + thinkMs - typeTime - Date.now())
      if (!(await stillMine())) {
        rec.outcome = 'too slow'
        continue
      }
      const enterAt = Date.now()
      if (await typeAndEnter(b, box, pick.name)) {
        rec.sentAtMs = Date.now() - startedAt
        b.submitted = String(room.turn_no)
        rec.outcome = 'sent'
        // How fast the other screens see it, and how fast the next box comes alive.
        const others = bots.filter((o) => o !== b)
        void Promise.all(
          others.map((o) =>
            o.page
              .getByTestId('party-answers')
              .getByText(pick.name, { exact: true })
              .first()
              .waitFor({ state: 'attached', timeout: 6000 })
              .then(() => answerLatency.push(Date.now() - enterAt))
              .catch(() => {}),
          ),
        )
        const t = Date.now()
        for (;;) {
          const r = await getRoom(roomId)
          if (r.turn_no !== room.turn_no || r.status !== 'playing') {
            const nb = r.turn_player_id ? byId.get(r.turn_player_id) : undefined
            if (nb && r.round === room.round && r.status === 'playing') {
              void expect(nb.page.getByLabel('Guess a Pokémon'))
                .toBeEnabled({ timeout: 6000 })
                .then(() => nextLiveLatency.push(Date.now() - enterAt))
                .catch(() => {})
            }
            rec.outcome = 'answered'
            break
          }
          const wrong = (await b.page.getByTestId('party-wrong').textContent()) ?? ''
          if (wrong.trim()) {
            rec.outcome = `refused: ${wrong.trim()}`
            break
          }
          if (Date.now() - t > 5000) {
            rec.outcome = 'no server reply in 5 s'
            problem('slow-answer', `${b.name} sent ${pick.name} in round ${room.round}: turn did not move in 5 s`)
            break
          }
          await sleep(150)
        }
      }
    }
  }

  // ---- The observer: every 250 ms the server's room, turns and rounds; on each round end, every screen's moment.
  const roundStart = async (room: Room, at: number) => {
    const entry = await deckEntry(room)
    const players = await rest<{ id: string; lives: number; is_out: boolean }[]>(`party_players?room_id=eq.${roomId}&select=id,lives,is_out`)
    const alive = players.filter((p) => !p.is_out && p.lives > 0).length
    const rec: RoundRec = {
      round: room.round,
      tier: entry.tier,
      category: categorySentence(entry.parts),
      key: categoryKey(entry.parts),
      pool: entry.pool,
      seconds: entry.seconds,
      alive,
      startedAt: at,
    }
    rounds.push(rec)
    log(`Round ${room.round} (${entry.tier}, ${entry.seconds}s): ${rec.category}, pool ${entry.pool}, ${alive} alive`)
    if (entry.tier === 'expert' && entry.pool < 2 * alive) log(`   note: Expert pool ${entry.pool} < 2 x ${alive} alive`)
  }
  const roundEnd = async (room: Room, ev: NonNullable<Room['last_event']>) => {
    const rec = rounds.find((r) => r.round === ev.round)
    if (!rec || rec.end) return
    rec.endedAt = Date.now()
    rec.end = ev.kind === 'cleared' ? (ev.exhausted ? 'exhausted' : 'cleared') : 'timeout'
    rec.loser = ev.kind === 'timeout' ? nameOf(ev.player_id) : undefined
    rec.out = ev.out
    const said = await rest<{ species: number }[]>(`party_answers?room_id=eq.${roomId}&game_no=eq.${room.game_no}&round=eq.${ev.round}&select=species`)
    rec.answers = said.length
    rec.leftAtEnd = rec.pool - new Set(said.map((s) => s.species)).size
    log(
      `   ${rec.end}${rec.loser ? ` by ${rec.loser}${rec.out ? ' (OUT)' : ''}` : ''} after ${r1((rec.endedAt - rec.startedAt) / 1000)} s, ${rec.answers} answers, ${rec.leftAtEnd} left`,
    )
    // Every screen should play the moment (out players' too).
    const kind = ev.kind
    if (ev.over) return
    const missed: string[] = []
    await Promise.all(
      bots.map((b) =>
        b.page
          .locator(`[data-testid=party-moment][data-kind=${kind}]`)
          .waitFor({ state: 'attached', timeout: 5000 })
          .catch(() => {
            missed.push(b.name)
          }),
      ),
    )
    const check: (typeof momentChecks)[number] = { round: ev.round!, kind, missedOn: missed }
    if (missed.length) problem('moment-missing', `round ${ev.round} ${kind}: no panel on ${missed.join(', ')}`)
    if (kind === 'timeout') {
      if (shots.timeout < 2) {
        shots.timeout++
        const loserBot = ev.player_id ? byId.get(ev.player_id) : undefined
        await shot((shots.timeout === 1 ? phone : loserBot)?.page ?? host.page, `timeout-r${ev.round}-${(shots.timeout === 1 ? phone : loserBot)?.device ?? 'desktop'}`)
      }
      const fits = await Promise.all(
        bots.map((b) =>
          b.page
            .locator('[data-testid=party-also-fit]:not(.invisible) li[data-pokemon-id]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-pokemon-id')).join(','))
            .catch(() => ''),
        ),
      )
      const seen = fits.filter(Boolean)
      check.alsoFitAgree = new Set(seen).size <= 1
      if (!check.alsoFitAgree) problem('also-fit-differs', `round ${ev.round}: ${bots.map((b, i) => `${b.name}=${fits[i]}`).join(' ')}`)
    } else if (shots.cleared < 1 || (deck[ev.round!]?.tier ?? rec.tier) !== rec.tier) {
      // First cleared round, and a tier change: a phone and a desktop.
      shots.cleared++
      await sleep(200)
      await shot((phone ?? host).page, `cleared-r${ev.round}-phone`)
      if (shots.cleared === 1) await shot(host.page, `cleared-r${ev.round}-desktop`)
    }
    momentChecks.push(check)
  }

  let lastEventKey = ''
  let lastRound = 0
  const observer = async () => {
    while (!stop) {
      let room: Room
      try {
        room = await getRoom(roomId)
      } catch (e) {
        problem('rest-error', (e as Error).message)
        await sleep(500)
        continue
      }
      const now = Date.now()
      const ev = room.last_event
      const evKey = ev ? `${ev.kind}|${ev.round}` : ''
      if (ev && evKey !== lastEventKey && (ev.kind === 'timeout' || ev.kind === 'cleared')) {
        lastEventKey = evKey
        if (currentTurn && currentTurn.round === ev.round) {
          currentTurn.endedAt = now
          currentTurn.outcome = ev.kind === 'timeout' ? 'timeout' : 'answered'
        }
        void roundEnd(room, ev)
      }
      if (room.status === 'playing') {
        if (!currentTurn || currentTurn.turnNo !== room.turn_no) {
          if (currentTurn && !currentTurn.outcome) {
            currentTurn.endedAt = now
            currentTurn.outcome = 'answered'
          }
          currentTurn = {
            turnNo: room.turn_no,
            round: room.round,
            player: nameOf(room.turn_player_id),
            seconds: room.turn_seconds ?? 0,
            startedAt: Date.parse(room.turn_started_at!),
            deadline: Date.parse(room.deadline!),
          }
          turns.push(currentTurn)
          if (room.round !== lastRound) {
            lastRound = room.round
            await roundStart(room, currentTurn.startedAt)
            if (phone && PLAYERS >= 4 && shots.rail < 4 && (room.round === 1 || room.round % 8 === 0)) {
              shots.rail++
              await sleep(2500)
              await shot(phone.page, `rail-r${room.round}-phone`)
            }
          }
        } else if (now > currentTurn.deadline + 6000) {
          problem('stuck-turn', `round ${room.round} turn ${room.turn_no} (${currentTurn.player}) still open ${r1((now - currentTurn.deadline) / 1000)} s after its deadline`)
          currentTurn.deadline = now // report once per 6 s
        }
      }
      if (room.status === 'over') return room
      if (now - gameStart > CAP_MIN * 60_000) {
        problem('capped', `game still running after ${CAP_MIN} min (round ${room.round}): stopped`)
        return room
      }
      await sleep(250)
    }
    return getRoom(roomId)
  }

  // ---- Screens: every ~2 s, compare what each screen shows with the server (only well inside a turn).
  const screens = async () => {
    const counters = { checks: 0, twoLive: 0, wrongLive: 0, notLive: 0, railDiff: 0, roundDiff: 0, leftDiff: 0 }
    while (!stop) {
      await sleep(2000)
      const turn = currentTurn
      if (!turn) continue
      const now = Date.now()
      if (now - turn.startedAt < 2000 || turn.deadline - now < 1500 || turn.endedAt) continue
      const room = await getRoom(roomId).catch(() => null)
      if (!room || room.status !== 'playing' || room.turn_no !== turn.turnNo) continue
      const entry = await deckEntry(room)
      const left = speciesLeft(entry.parts, DATASET, await usedSpecies(room))
      const snap = await Promise.all(
        bots.map((b) =>
          b.page
            .evaluate(() => {
              const input = document.querySelector<HTMLInputElement>('[data-testid=party-search] input')
              const secs = [...document.querySelectorAll('[data-testid=party-timer-seconds]')].map((e) => e.textContent ?? '')
              return {
                screen: document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? '',
                live: input ? !input.disabled : false,
                rail: document.querySelector('[data-testid=party-rail] li[aria-current=true]')?.getAttribute('data-player') ?? '',
                title: document.querySelector('#party-category-title')?.textContent ?? '',
                left: document.querySelector('[data-testid=party-left]')?.textContent ?? '',
                moment: !!document.querySelector('[data-testid=party-moment]'),
                secs,
                at: Date.now(),
              }
            })
            .catch(() => null),
        ),
      )
      const after = await getRoom(roomId).catch(() => null)
      if (!after || getRoomTurnChanged(after, turn)) continue
      counters.checks++
      const live = bots.filter((_, i) => snap[i]?.live)
      if (live.length > 1) {
        counters.twoLive++
        problem('two-live', `round ${room.round}: boxes live on ${live.map((b) => b.name).join(', ')}`)
      }
      for (const [i, b] of bots.entries()) {
        const s = snap[i]
        if (!s) continue
        if (s.screen !== 'game') {
          problem('wrong-screen', `${b.name} shows ${s.screen} during round ${room.round}`)
          continue
        }
        if (s.live && b.id !== room.turn_player_id) {
          counters.wrongLive++
          problem('wrong-live', `${b.name}'s box is live on ${nameOf(room.turn_player_id)}'s turn`)
        }
        if (!s.live && b.id === room.turn_player_id && b.submitted !== String(room.turn_no)) counters.notLive++
        if (s.rail !== room.turn_player_id) {
          counters.railDiff++
          problem('rail-differs', `${b.name}'s rail marks ${nameOf(s.rail)}, server says ${nameOf(room.turn_player_id)}`)
        }
        if (!s.moment && !s.title.includes(`Round ${room.round}`)) {
          counters.roundDiff++
          problem('round-differs', `${b.name} shows "${s.title}", server round ${room.round}`)
        }
        if (!s.moment && s.left.trim() !== `${left} left`) {
          counters.leftDiff++
          problem('left-differs', `${b.name} shows "${s.left.trim()}", engine says ${left} left`)
        }
        // Timer: the shown seconds against the server's deadline at the moment of the read.
        for (const txt of s.secs) {
          const n = Number(/\d+/.exec(txt)?.[0])
          if (!Number.isFinite(n)) continue
          const expected = (turn.deadline - s.at) / 1000
          timerDrift.push(Math.round((n - expected) * 10) / 10)
        }
      }
    }
    return counters
  }
  const getRoomTurnChanged = (room: Room, turn: TurnRec) => room.turn_no !== turn.turnNo || !!turn.endedAt

  const loops = bots.map((b) => botLoop(b).catch((e) => problem('bot-crash', `${b.name}: ${(e as Error).message.split('\n')[0]}`)))
  const screensDone = screens()
  const end = await observer()
  stop = true
  const screenCounters = await screensDone
  await Promise.all(loops)
  const gameMs = Date.now() - gameStart

  // ---- Game over on every screen.
  if (end.status === 'over') {
    const shown = await Promise.all(
      bots.map((b) =>
        b.page
          .locator('[data-screen=over]')
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(async () => (await b.page.getByTestId('party-winner').textContent())?.trim() ?? '')
          .catch(() => 'NO GAME OVER SCREEN'),
      ),
    )
    log(`Game over: ${nameOf(end.winner_id)} wins. Screens: ${shown.map((s, i) => `${bots[i].name}: "${s}"`).join('; ')}`)
    for (const [i, s] of shown.entries()) {
      const b = bots[i]
      const want = b.id === end.winner_id ? 'You win!' : `${nameOf(end.winner_id)} wins!`
      if (!s.includes(want)) problem('game-over-differs', `${b.name} shows "${s}", expected "${want}"`)
    }
    await sleep(800)
    const seenDevices = new Set<Device>()
    for (const b of bots) {
      if (seenDevices.has(b.device) && PLAYERS > 2) continue
      seenDevices.add(b.device)
      await b.page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, '0')}-over-${b.device}.png`), fullPage: true }).catch(() => {})
    }
  } else {
    await shot((phone ?? host).page, 'capped-phone')
    await shot(host.page, 'capped-desktop')
  }

  // ---- Stats.
  const players = await rest<{ id: string; nickname: string; lives: number; is_out: boolean; answers_given: number }[]>(
    `party_players?room_id=eq.${roomId}&select=id,nickname,lives,is_out,answers_given`,
  )
  const answers = await rest<{ round: number; player_id: string; created_at: string; pokemon_id: number }[]>(
    `party_answers?room_id=eq.${roomId}&game_no=eq.${startRoom.game_no}&select=round,player_id,created_at,pokemon_id&order=id`,
  )
  for (const t of turns) {
    const a = answers.find((x) => x.round === t.round && nameOf(x.player_id) === t.player && Date.parse(x.created_at) >= t.startedAt - 50)
    if (a && Date.parse(a.created_at) <= t.deadline + 400) {
      t.usedS = r1((Date.parse(a.created_at) - t.startedAt) / 1000)
      t.outcome = 'answered'
    } else if (t.outcome === 'timeout' || (t.endedAt && !a)) {
      t.outcome = t.outcome ?? 'timeout'
      t.usedS = t.seconds
    }
  }
  const tierStarts = PARTY_TIERS.map((tier) => {
    const r = rounds.find((x) => x.tier === tier.id)
    return r ? `${tier.name} at round ${r.round}, ${r1((r.startedAt - gameStart) / 60000)} min` : `${tier.name}: never reached`
  })
  const perTier = PARTY_TIERS.map((tier) => {
    const ts = turns.filter((t) => rounds.find((r) => r.round === t.round)?.tier === tier.id && t.usedS !== undefined)
    const answered = ts.filter((t) => t.outcome === 'answered').map((t) => t.usedS!)
    const rs = rounds.filter((r) => r.tier === tier.id && r.end)
    return {
      tier: tier.id,
      seconds: tier.seconds,
      turns: ts.length,
      answered: answered.length,
      timeouts: ts.length - answered.length,
      timeoutRate: ts.length ? r1((100 * (ts.length - answered.length)) / ts.length) : null,
      usedMedianS: r1(pct(answered, 0.5)),
      usedP90S: r1(pct(answered, 0.9)),
      rounds: rs.length,
      cleared: rs.filter((r) => r.end !== 'timeout').length,
      exhausted: rs.filter((r) => r.end === 'exhausted').length,
      avgRoundS: rs.length ? r1(rs.reduce((a, r) => a + (r.endedAt! - r.startedAt), 0) / rs.length / 1000) : null,
    }
  })
  const lapEnds = rounds.filter((r) => r.end && r.end !== 'timeout')
  const lowLeft = lapEnds.filter((r) => (r.leftAtEnd ?? 99) <= 3)
  const unfair = rounds.filter((r) => r.tier === 'expert' && r.pool < 2 * r.alive)
  // Longest wait between your own turns (the time a player sits idle), per alive player.
  const waits: number[] = []
  for (const b of bots) {
    const mine = turns.filter((t) => t.player === b.name)
    for (let i = 1; i < mine.length; i++) waits.push((mine[i].startedAt - (mine[i - 1].endedAt ?? mine[i - 1].startedAt)) / 1000)
  }
  const summary = {
    game: GAME,
    players: PLAYERS,
    lives: LIVES,
    seed: SEED,
    finished: end.status === 'over',
    winner: nameOf(end.winner_id),
    minutes: r1(gameMs / 60000),
    rounds: rounds.length,
    turns: turns.length,
    lastTier: rounds.at(-1)?.tier,
    tierStarts,
    perTier,
    deckLooped: rounds.length > deck.length,
    repeatedCategories: rounds.length - new Set(rounds.map((r) => r.key)).size,
    lapsEndingWith3OrFewerLeft: `${lowLeft.length} of ${lapEnds.length}`,
    expertPoolUnder2xAlive: unfair.map((r) => `r${r.round} ${r.category} pool ${r.pool} vs ${r.alive} alive (${r.end})`),
    livesLostPerRound: rounds.map((r) => (r.end === 'timeout' ? 1 : 0)),
    waitBetweenOwnTurnsS: { median: r1(pct(waits, 0.5)), p90: r1(pct(waits, 0.9)), max: r1(Math.max(0, ...waits)) },
    answerSeenOnOtherScreensMs: { median: pct(answerLatency, 0.5), p95: pct(answerLatency, 0.95), n: answerLatency.length },
    nextBoxLiveAfterEnterMs: { median: pct(nextLiveLatency, 0.5), p95: pct(nextLiveLatency, 0.95), n: nextLiveLatency.length },
    timerDriftS: { median: pct(timerDrift, 0.5), min: Math.min(...timerDrift), max: Math.max(...timerDrift), n: timerDrift.length },
    screenChecks: screenCounters,
    momentsMissed: momentChecks.filter((m) => m.missedOn.length).length,
    alsoFitDisagreements: momentChecks.filter((m) => m.alsoFitAgree === false).length,
    problems: problems.length,
    consoleErrors: consoleErrors.length,
    perPlayer: bots.map((b) => {
      const p = players.find((x) => x.id === b.id)
      const bt = b.turns
      return {
        name: b.name,
        skill: b.skill,
        device: b.device,
        livesLeft: p?.lives,
        out: p?.is_out,
        answers: p?.answers_given,
        turns: bt.length,
        wrongTries: bt.reduce((a, t) => a + t.wrongTries, 0),
        blanks: bt.filter((t) => t.plan === 'blank').length,
        stumped: bt.filter((t) => t.plan === 'stumped').length,
        tooSlow: bt.filter((t) => t.outcome === 'too slow').length,
        refused: bt.filter((t) => t.outcome.startsWith('refused')).length,
        seenAfterMsMedian: pct(bt.map((t) => t.seenAfterMs), 0.5),
        errors: b.errors.slice(0, 10),
      }
    }),
  }
  const lines = [
    `PLAYTEST ${GAME}: ${summary.finished ? `finished, ${summary.winner} won` : 'CAPPED'} in ${summary.minutes} min, ${summary.rounds} rounds, ${summary.turns} turns`,
    ...tierStarts.map((t) => `  ${t}`),
    ...perTier.map(
      (t) =>
        `  ${t.tier.padEnd(7)} ${t.seconds}s: ${t.rounds} rounds (${t.cleared} cleared, ${t.exhausted} exhausted), ${t.turns} turns, ${t.timeoutRate}% timeouts, used median ${t.usedMedianS}s p90 ${t.usedP90S}s, avg round ${t.avgRoundS}s`,
    ),
    `  laps ending with <=3 left: ${summary.lapsEndingWith3OrFewerLeft}; deck looped: ${summary.deckLooped}; repeated categories: ${summary.repeatedCategories}`,
    `  expert pool < 2x alive: ${unfair.length} rounds`,
    `  wait between own turns: median ${summary.waitBetweenOwnTurnsS.median}s, p90 ${summary.waitBetweenOwnTurnsS.p90}s, max ${summary.waitBetweenOwnTurnsS.max}s`,
    `  answer on other screens: median ${summary.answerSeenOnOtherScreensMs.median} ms, p95 ${summary.answerSeenOnOtherScreensMs.p95} ms; next box live: median ${summary.nextBoxLiveAfterEnterMs.median} ms, p95 ${summary.nextBoxLiveAfterEnterMs.p95} ms`,
    `  timer drift (shown - server, s): median ${summary.timerDriftS.median}, min ${summary.timerDriftS.min}, max ${summary.timerDriftS.max} over ${timerDrift.length} reads`,
    `  screen checks: ${JSON.stringify(screenCounters)}; moments missed: ${summary.momentsMissed}; also-fit disagreements: ${summary.alsoFitDisagreements}`,
    `  problems: ${problems.length}; console errors/warnings: ${consoleErrors.length}`,
    ...summary.perPlayer.map(
      (p) =>
        `  ${p.name.padEnd(7)} ${p.skill.padEnd(7)} ${p.device.padEnd(7)} lives ${p.livesLeft}${p.out ? ' OUT' : ''}, ${p.answers} answers in ${p.turns} turns, ${p.wrongTries} wrong, ${p.blanks} blank, ${p.stumped} stumped, ${p.tooSlow} too slow, ${p.refused} refused`,
    ),
  ]
  const full = { summary, rounds, turns, botTurns: Object.fromEntries(bots.map((b) => [b.name, b.turns])), problems, consoleErrors: consoleErrors.slice(0, 200), deck }
  writeFileSync(join(OUT, 'log.json'), JSON.stringify(full, null, 1))
  writeFileSync(join(OUT, 'summary.txt'), lines.join('\n') + '\n\nPROBLEMS\n' + problems.map((p) => `${p.at}s ${p.kind}: ${p.detail}`).join('\n') + '\n\nCONSOLE\n' + consoleErrors.slice(0, 100).join('\n') + '\n')
  console.log('\n' + lines.join('\n'))
  console.log('\nPROBLEMS (first 60)\n' + problems.slice(0, 60).map((p) => `${p.at}s ${p.kind}: ${p.detail}`).join('\n'))
  console.log('\nCONSOLE (first 40)\n' + consoleErrors.slice(0, 40).join('\n'))
  console.log('\nROUNDS\n' + rounds.map((r) => `r${r.round} ${r.tier} ${r.seconds}s pool ${r.pool} alive ${r.alive} ${r1(((r.endedAt ?? Date.now()) - r.startedAt) / 1000)}s ${r.end ?? '-'} ${r.loser ?? ''} left ${r.leftAtEnd ?? '-'} | ${r.category}`).join('\n'))

  for (const b of bots) await b.ctx.close()
})
