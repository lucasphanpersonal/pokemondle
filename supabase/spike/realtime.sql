create table public.spike_rt (id bigserial primary key, note text, created_at timestamptz default now());
alter table public.spike_rt enable row level security;
create policy "anon can read" on public.spike_rt for select to anon, authenticated using (true);
grant select on public.spike_rt to anon, authenticated;
alter publication supabase_realtime add table public.spike_rt;
