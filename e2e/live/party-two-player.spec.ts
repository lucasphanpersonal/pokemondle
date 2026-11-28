import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { alsoFit, checkAnswer, fittingEntries } from '../../src/lib/party/categories.ts'
import type { Category } from '../../src/lib/party/types.ts'
import type { Pokemon } from '../../src/types/pokemon.ts'

/*
 * Two players, two browser contexts, one real game on /party/ against a LOCAL Supabase stack (run by
 * .github/workflows/party-e2e.yml with playwright.party.config.ts; never the live project).
 *
 * The host (desktop) creates a room, the guest (phone) joins by the invite link at once, the host must see them
 * without a reload, picks 2 lives and starts.
 * Round 1: a wrong answer (costs time only), then a valid answer from each player clears the lap. Rounds 2 and 3 get a
 * forced 5 s timer and nobody answers: the player on turn loses a life (every screen shows the same three "Also fit"),
 * starts round 3, runs out again and is out, so the other player wins. Then the host taps Play again.
 *
 * Short timers are forced by editing the dealt deck in the local database with psql (PARTY_DB_URL, the stack's own
 * postgres superuser). Nothing in the site or the Edge Function can do this, so it can't happen on the live project.
 */

const API_URL = process.env.PARTY_API_URL ?? ''
const ANON_KEY = process.env.PARTY_ANON_KEY ?? ''
const DB_URL = process.env.PARTY_DB_URL ?? ''
const SHORT_SECONDS = 5

test.skip(!API_URL || !ANON_KEY || !DB_URL, 'needs a local Supabase stack (PARTY_API_URL, PARTY_ANON_KEY, PARTY_DB_URL)')

const DATASET: Pokemon[] = JSON.parse(readFileSync(new URL('../../src/data/pokemon.json', import.meta.url), 'utf8'))
const BY_ID = new Map(DATASET.map((p) => [p.id, p]))
/** Entries whose full name no other entry shares: typing it and pressing Enter picks exactly that entry (an exact name is
 * the top suggestion). */
const nameCount = new Map<string, number>()
for (const p of DATASET) nameCount.set(p.name.toLowerCase(), (nameCount.get(p.name.toLowerCase()) ?? 0) + 1)
const TYPEABLE = new Set(DATASET.filter((p) => nameCount.get(p.name.toLowerCase()) === 1))

interface Room {
  id: string
  status: string
  game_no: number
  round: number
  turn_no: number
  category_no: number | null
  turn_player_id: string | null
  winner_id: string | null
  last_event: { kind: string; round?: number; player_id?: string; said?: number[]; out?: boolean } | null
}

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` } })
  expect(res.status, path).toBe(200)
  return (await res.json()) as T
}

const getRoom = async (id: string) => (await rest<Room[]>(`party_rooms?id=eq.${id}&select=*`))[0]

async function waitRoom(id: string, ok: (r: Room) => boolean, what: string, timeout = 20_000): Promise<Room> {
  let last: Room | undefined
  await expect
    .poll(
      async () => {
        last = await getRoom(id)
        return ok(last)
      },
      { message: what, timeout, intervals: [200] },
    )
    .toBe(true)
  return last!
}

async function categoryOf(room: Room): Promise<Category> {
  const [row] = await rest<{ parts: Category }[]>(
    `party_categories?room_id=eq.${room.id}&game_no=eq.${room.game_no}&deck_no=eq.${room.category_no}&select=parts`,
  )
  return row.parts
}

async function usedSpecies(room: Room): Promise<Set<number>> {
  const rows = await rest<{ species: number }[]>(
    `party_answers?room_id=eq.${room.id}&game_no=eq.${room.game_no}&round=eq.${room.round}&select=species`,
  )
  return new Set(rows.map((r) => r.species))
}

/** Runs SQL as the local stack's superuser. Local only: the live project's database password is never in CI. */
function psql(sql: string) {
  execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-qc', sql], { stdio: ['ignore', 'pipe', 'inherit'] })
}

async function newPlayer(browser: Browser, phone: boolean): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } },
  )
  await ctx.addInitScript(() => localStorage.setItem('pokemondle:volume', '0'))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))
  return { ctx, page }
}

const seatOf = async (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('pokemondle:party') ?? 'null') as { room_id: string; player_id: string } | null)

/** Types a name in the turn's search box and presses Enter (an exact name is the top suggestion). */
async function say(page: Page, pokemon: Pokemon) {
  const box = page.getByLabel('Guess a Pokémon')
  await expect(box).toBeEnabled()
  await box.fill(pokemon.name)
  await expect(page.getByRole('option').first()).toContainText(pokemon.name)
  await box.press('Enter')
}

/** The three "Also fit" sprite ids on a screen, once they are revealed. */
async function alsoFitOn(page: Page): Promise<number[]> {
  const items = page.locator('[data-testid=party-also-fit]:not(.invisible) li[data-pokemon-id]')
  await expect(items).toHaveCount(3, { timeout: 15_000 })
  return items.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-pokemon-id'))))
}

test('two players play a whole game: wrong answer, cleared lap, timeouts, a winner, Play again', async ({ browser }) => {
  const host = await newPlayer(browser, false)
  const guest = await newPlayer(browser, true)

  // ---- Host a room and pick 2 lives.
  await host.page.goto('/party/')
  await host.page.getByLabel('Your name').fill('Ash')
  await host.page.getByRole('button', { name: 'Host a room' }).click()
  await expect(host.page.locator('[data-screen=lobby]')).toBeVisible({ timeout: 20_000 })
  await expect(host.page.getByRole('button', { name: 'Copy invite link' })).toBeVisible()
  await expect.poll(() => host.page.evaluate(() => location.hash)).toMatch(/^#[A-Z]{4}$/)
  const inviteLink = host.page.url()

  // ---- The guest opens the invite link at once (the playtest's repro: a join within a couple of seconds of the room
  // being made, before the host's Postgres Changes are delivered). The code is filled in, Join is the main action.
  await guest.page.goto(inviteLink)
  await guest.page.getByLabel('Your name').fill('Misty')
  await guest.page.getByRole('button', { name: 'Join' }).click()
  await expect(guest.page.locator('[data-screen=lobby]')).toBeVisible({ timeout: 20_000 })
  // The host must see the guest without a reload: by Realtime, or at the latest by the lobby re-read (src/party/resync.ts,
  // every LOBBY_POLL_MS = 5 s), so 10 s is always enough.
  await expect(host.page.getByTestId('party-players').locator('li')).toHaveCount(2, { timeout: 10_000 })
  await expect(guest.page.getByTestId('party-players').locator('li')).toHaveCount(2, { timeout: 10_000 })

  // ---- The host picks 2 lives; the guest's read-only settings follow.
  const lives = host.page.getByTestId('party-lives').getByRole('radio', { name: '2', exact: true })
  // The lobby may still be settling (the controls are disabled while busy): tap until the server has it.
  await expect(async () => {
    if ((await lives.getAttribute('aria-checked')) !== 'true') await lives.click()
    await expect(lives).toHaveAttribute('aria-checked', 'true', { timeout: 3000 })
  }).toPass({ timeout: 20_000 })
  await expect(guest.page.getByTestId('party-settings-readonly')).toContainText('2', { timeout: 10_000 })

  const hostSeat = (await seatOf(host.page))!
  const guestSeat = (await seatOf(guest.page))!
  const roomId = hostSeat.room_id
  expect(guestSeat.room_id).toBe(roomId)
  await waitRoom(roomId, (r) => (r as Room & { lives: number }).lives === 2, 'lives set to 2')
  const pageOf = (playerId: string | null) => (playerId === hostSeat.player_id ? host.page : guest.page)
  const nameOf = (playerId: string | null) => (playerId === hostSeat.player_id ? 'Ash' : 'Misty')

  // ---- Start. Every round after the first gets a short timer.
  await host.page.getByRole('button', { name: 'Start', exact: true }).click()
  const started = await waitRoom(roomId, (r) => r.status === 'playing' && r.round === 1, 'game started')
  psql(`update public.party_categories set seconds = ${SHORT_SECONDS} where room_id = '${roomId}' and game_no = ${started.game_no} and deck_no >= 2`)
  for (const p of [host.page, guest.page]) await expect(p.locator('[data-screen=game]')).toBeVisible()

  // ---- Round 1: a wrong answer costs time only, then each player answers and the lap clears.
  for (let i = 0; i < 2; i++) {
    const room = await getRoom(roomId)
    expect(room.round).toBe(1)
    const page = pageOf(room.turn_player_id)
    const category = await categoryOf(room)
    const used = await usedSpecies(room)
    if (i === 0) {
      const wrong = DATASET.find((p) => TYPEABLE.has(p) && !checkAnswer(category, p, used).ok)!
      const check = checkAnswer(category, wrong, used)
      await say(page, wrong)
      await expect(page.getByTestId('party-wrong')).toHaveText(check.ok ? '' : check.reason)
      // Still this player's turn, with no life lost.
      expect((await getRoom(roomId)).turn_no).toBe(room.turn_no)
    }
    const right = fittingEntries(category, DATASET).find((p) => TYPEABLE.has(p) && !used.has(p.dexNumber))
    expect(right, 'a typeable answer that fits').toBeDefined()
    await say(page, right!)
    if (i === 0) {
      // Both screens list the answer.
      await waitRoom(roomId, (r) => r.turn_no > room.turn_no, 'turn passed')
      for (const p of [host.page, guest.page]) await expect(p.getByTestId('party-answers')).toContainText(right!.name)
    }
  }
  await Promise.all(
    [host.page, guest.page].map((p) => expect(p.locator('[data-testid=party-moment][data-kind=cleared]')).toBeVisible({ timeout: 10_000 })),
  )
  const round2 = await waitRoom(roomId, (r) => r.round === 2 && r.last_event?.kind === 'cleared', 'round cleared')
  expect(await rest<{ lives: number }[]>(`party_players?room_id=eq.${roomId}&lives=eq.2&select=lives`)).toHaveLength(2)

  // ---- Round 2: nobody answers, the forced short timer runs out, the player on turn loses a life.
  const loser = round2.turn_player_id
  const timeout = await waitRoom(roomId, (r) => r.last_event?.kind === 'timeout' && r.last_event.round === 2, 'round 2 timed out', 25_000)
  expect(timeout.last_event?.player_id).toBe(loser)
  const other = loser === hostSeat.player_id ? guestSeat.player_id : hostSeat.player_id
  const [hostFits, guestFits] = await Promise.all([
    alsoFitOn(host.page),
    alsoFitOn(guest.page),
    expect(pageOf(loser).getByTestId('party-moment')).toContainText("Time's up! You lost a life."),
    expect(pageOf(other).getByTestId('party-moment')).toContainText(`Time's up! ${nameOf(loser)} lost a life.`),
  ])
  // Every screen shows the same three, and they are the ones the shared seed picks from what was said (nothing).
  expect(guestFits).toEqual(hostFits)
  expect(timeout.last_event?.said).toEqual([])
  const category2 = (await rest<{ parts: Category }[]>(
    `party_categories?room_id=eq.${roomId}&game_no=eq.${round2.game_no}&deck_no=eq.${round2.category_no}&select=parts`,
  ))[0].parts
  const expected = alsoFit(category2, DATASET, new Set(), `${roomId}|${round2.game_no}|2`, 3).map((p) => p.id)
  expect(hostFits).toEqual(expected)
  expect(hostFits.every((id) => BY_ID.has(id))).toBe(true)
  // The time's up panel never covers the player rail (desktop and phone), nor the turn box below it. Read in one go, while
  // the panel is still up (it goes after about 2.5 s; if it's already gone there is nothing to check).
  for (const p of [host.page, guest.page]) {
    const boxes = await p.evaluate(() => {
      const box = (s: string) => document.querySelector(s)?.getBoundingClientRect()
      const panel = box('[data-testid=party-moment][data-kind=timeout]')
      const rail = box('section[aria-label=Players]')
      const turn = box('[data-testid=party-turn]')
      return panel && rail && turn ? { panelTop: panel.top, panelBottom: panel.bottom, railBottom: rail.bottom, turnTop: turn.top } : null
    })
    if (!boxes) continue
    expect(boxes.panelTop, 'panel below the rail').toBeGreaterThanOrEqual(boxes.railBottom)
    expect(boxes.panelBottom, 'panel above the turn box').toBeLessThanOrEqual(boxes.turnTop)
  }

  // ---- Round 3: the failed player starts it, runs out again and is out. The other player wins.
  const round3 = await waitRoom(roomId, (r) => r.round === 3, 'round 3')
  expect(round3.turn_player_id).toBe(loser)
  const over = await waitRoom(roomId, (r) => r.status === 'over', 'game over', 25_000)
  const winner = over.winner_id
  expect(winner).not.toBe(loser)
  expect(winner).not.toBeNull()
  for (const p of [host.page, guest.page]) await expect(p.locator('[data-screen=over]')).toBeVisible({ timeout: 15_000 })
  await expect(pageOf(winner).getByTestId('party-winner')).toContainText('You win!')
  await expect(pageOf(loser).getByTestId('party-winner')).toContainText(`${nameOf(winner)} wins!`)
  await expect(host.page.getByTestId('party-results').locator('tbody tr')).toHaveCount(2)

  // ---- Play again: both are back in the lobby of the same room.
  await host.page.getByRole('button', { name: 'Play again' }).click()
  for (const p of [host.page, guest.page]) await expect(p.locator('[data-screen=lobby]')).toBeVisible({ timeout: 15_000 })
  await waitRoom(roomId, (r) => r.status === 'lobby', 'back in the lobby')

  await host.ctx.close()
  await guest.ctx.close()
})

test("Host says it can't reach the party server when Realtime is blocked", async ({ browser }) => {
  const { ctx, page } = await newPlayer(browser, true)
  // The function calls work, but the Realtime socket can't connect (as when a security header leaves out wss://).
  await ctx.routeWebSocket(/\/realtime\//, (ws) => ws.close())
  await page.goto('/party/')
  await page.getByLabel('Your name').fill('Brock')
  await page.getByRole('button', { name: 'Host a room' }).click()
  await expect(page.getByTestId('party-start-error')).toHaveText("Can't reach the party server right now.", { timeout: 25_000 })
  await expect(page.locator('[data-screen=start]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Host a room' })).toBeEnabled()
  // The seat that couldn't connect is given up, so it doesn't linger in a room nobody can see.
  expect(await seatOf(page)).toBeNull()
  await ctx.close()
})
