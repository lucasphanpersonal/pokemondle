// Helpers shared by the Edge Functions that need an anonymous, daily-rotating network identity (track, party).
// The raw IP is only ever used to compute salted hashes and is never stored or logged.

export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** The slice of the Supabase client the salt lookup uses (typed loosely so callers can pass the real client). */
export interface SaltClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any
}

/** Today's random salt, created on first use. Salts older than 2 days are deleted. */
export async function getDailySalt(supabase: SaltClient, day: string): Promise<string> {
  const read = async () => {
    const { data, error } = await supabase.from('daily_salts').select('salt').eq('day', day).maybeSingle()
    if (error) throw error
    return data?.salt as string | undefined
  }
  const existing = await read()
  if (existing) return existing
  const fresh = hex(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const { error } = await supabase
    .from('daily_salts')
    .upsert({ day, salt: fresh }, { onConflict: 'day', ignoreDuplicates: true })
  if (error) throw error
  // Privacy housekeeping that does not depend on pg_cron: drop salts older than 2 days.
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10)
  const { error: delError } = await supabase.from('daily_salts').delete().lt('day', cutoff)
  if (delError) console.error('salt cleanup failed')
  const salt = await read()
  if (!salt) throw new Error('salt missing')
  return salt
}

export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
}
