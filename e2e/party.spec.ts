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

test('an invite link fills the code boxes and makes Join the main action', async ({ page }) => {
  await page.goto('/party/#kpzw')
  await expect(page.locator('[data-screen="start"]')).toBeVisible()
  // The address is tidied to upper case.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#KPZW')
  await expect(page).toHaveTitle('Room KPZW · Pokémondle Party')
  const boxes = page.getByTestId('party-code-boxes').locator('input')
  await expect(boxes).toHaveCount(4)
  for (const [i, letter] of ['K', 'P', 'Z', 'W'].entries()) await expect(boxes.nth(i)).toHaveValue(letter)
  // One red action: Join here, Host a room turns white.
  await expect(page.getByRole('button', { name: 'Join' })).toHaveClass(/bevel-red/)
  await expect(page.getByRole('button', { name: 'Host a room' })).toHaveClass(/bevel-paper/)

  // A new hash (another invite link) fills the boxes with that code.
  await page.evaluate(() => (location.hash = '#BCDF'))
  await expect(boxes.nth(0)).toHaveValue('B')
  await expect(boxes.nth(3)).toHaveValue('F')
})

test('the code boxes take only code letters, advance, go back and accept a pasted link', async ({ page }) => {
  await page.goto('/party/')
  await expect(page.getByRole('button', { name: 'Host a room' })).toHaveClass(/bevel-red/)
  const boxes = page.getByTestId('party-code-boxes').locator('input')
  await boxes.nth(0).click()
  await page.keyboard.type('ka')
  await expect(boxes.nth(0)).toHaveValue('K')
  await expect(boxes.nth(1)).toHaveValue('')
  await expect(page.getByText('Room codes have no vowels and no L.')).toBeVisible()
  await page.keyboard.type('P')
  await expect(boxes.nth(1)).toHaveValue('P')
  await expect(boxes.nth(2)).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(boxes.nth(1)).toHaveValue('')
  await expect(boxes.nth(1)).toBeFocused()

  // Pasting an invite link fills all four.
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text', 'https://pokemondle.io/party/#VWXY')
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  for (const [i, letter] of ['V', 'W', 'X', 'Y'].entries()) await expect(boxes.nth(i)).toHaveValue(letter)
})

test('the nickname is checked before hosting', async ({ page }) => {
  await page.goto('/party/')
  const name = page.getByLabel('Your name')
  await name.fill('')
  await page.getByRole('button', { name: 'Host a room' }).click()
  await expect(page.getByText('Type a name first.')).toBeVisible()
  await expect(name).toBeFocused()
  await name.fill('Pokémon')
  await expect(page.getByText('Use only letters, digits and spaces.')).toBeVisible()
  await name.fill('Ash')
  // Rooms need the server (a later step): until then Host says so instead of doing nothing.
  await page.getByRole('button', { name: 'Host a room' }).click()
  await expect(page.getByTestId('party-start-error')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('a code that is not one falls back to the start screen with a note', async ({ page }) => {
  await page.goto('/party/#AEIO')
  await expect(page.locator('[data-screen="start"]')).toBeVisible()
  await expect(page.getByTestId('party-bad-code')).toContainText('“AEIO” isn\'t a room code')
  await expect(page.locator('[data-screen="lobby"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('')
})
