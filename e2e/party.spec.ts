import { expect, test } from '@playwright/test'

// The Party page (/party/, a second Vite entry): loads on its own, stays out of search results, and routes the room
// code in the address. Runs at 390px (phone) and 1280px (desktop); see playwright.config.ts.

test.beforeEach(async ({ page }) => {
  // Nothing on this page may reach the network yet (task 6 adds the room connection).
  await page.route(/supabase\.co|pokeapi\.co|raw\.githubusercontent\.com/, (r) => r.abort())
})

test('loads with noindex and its own header', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/party/')
  await expect(page).toHaveTitle('Pokémondle Party')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: /Pokémondle/ })).toHaveAttribute('href', '../')
  await expect(header.getByText('PARTY', { exact: true })).toBeVisible()
  // No Daily / Endless switch here.
  await expect(page.getByRole('radiogroup')).toHaveCount(0)
  await expect(page.locator('[data-screen="start"]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('opens and closes Party Help', async ({ page }) => {
  await page.goto('/party/')
  await page.getByRole('button', { name: 'How to play Party' }).click()
  const dialog = page.getByRole('dialog', { name: 'How to play Party' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('switch', { name: 'Larger text' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('a room code in the address opens that room, and Leave goes back', async ({ page }) => {
  await page.goto('/party/#kpzw')
  await expect(page.locator('[data-screen="room"]')).toBeVisible()
  await expect(page.getByTestId('party-room-code')).toHaveText('KPZW')
  // The address is tidied to upper case.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#KPZW')
  await expect(page).toHaveTitle('Room KPZW · Pokémondle Party')

  await page.getByRole('button', { name: 'Leave' }).click()
  await expect(page.locator('[data-screen="start"]')).toBeVisible()
  expect(await page.evaluate(() => location.hash)).toBe('')

  // Back returns to the room; a new hash (a pasted invite link) switches rooms.
  await page.goBack()
  await expect(page.getByTestId('party-room-code')).toHaveText('KPZW')
  await page.evaluate(() => (location.hash = '#BCDF'))
  await expect(page.getByTestId('party-room-code')).toHaveText('BCDF')
})

test('a code that is not one falls back to the start screen with a note', async ({ page }) => {
  await page.goto('/party/#AEIO')
  await expect(page.locator('[data-screen="start"]')).toBeVisible()
  await expect(page.getByTestId('party-bad-code')).toContainText('“AEIO” isn\'t a room code')
  await expect(page.locator('[data-screen="room"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('')
})
