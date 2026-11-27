import { createClient } from '@supabase/supabase-js'

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = process.env
const N = 50
const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Events can arrive before the insert call returns, so key by note, not by id.
const sentAt = new Map()
const lat = []
let resolveAll
const done = new Promise((r) => (resolveAll = r))

await new Promise((resolve, reject) => {
  anon
    .channel('spike')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spike_rt' }, (p) => {
      const t0 = sentAt.get(p.new.note)
      if (t0 !== undefined) {
        lat.push(Date.now() - t0)
        if (lat.length === N) resolveAll()
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status))
    })
})
await new Promise((r) => setTimeout(r, 1500))

for (let i = 0; i < N; i++) {
  sentAt.set(`n${i}`, Date.now())
  const { error } = await admin.from('spike_rt').insert({ note: `n${i}` })
  if (error) throw error
  await new Promise((r) => setTimeout(r, 300))
}
await Promise.race([done, new Promise((r) => setTimeout(r, 10000))])

lat.sort((a, b) => a - b)
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]
console.log(
  `RESULT received=${lat.length}/${N} min=${lat[0]}ms p50=${q(0.5)}ms p95=${q(0.95)}ms max=${lat[lat.length - 1]}ms mean=${Math.round(lat.reduce((a, b) => a + b, 0) / lat.length)}ms`,
)

// anon may read but not write
const ins = await anon.from('spike_rt').insert({ note: 'anon' })
console.log('anon insert:', ins.status, ins.error?.code, ins.error?.message)
const upd = await anon.from('spike_rt').update({ note: 'x' }).neq('id', 0).select()
console.log('anon update: status', upd.status, 'rows changed', upd.data?.length ?? null, upd.error?.message ?? '')
const del = await anon.from('spike_rt').delete().neq('id', 0).select()
console.log('anon delete: status', del.status, 'rows deleted', del.data?.length ?? null, del.error?.message ?? '')
const sel = await anon.from('spike_rt').select('id,note').limit(3)
console.log('anon select rows:', sel.data?.length, sel.error?.message ?? '')
const chk = await admin.from('spike_rt').select('note', { count: 'exact' }).eq('note', 'x')
console.log('rows with note x after anon update (expect 0):', chk.data?.length)
process.exit(lat.length === N && ins.error && !upd.data?.length && !del.data?.length ? 0 : 1)
