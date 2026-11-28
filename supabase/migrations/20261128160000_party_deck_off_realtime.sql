-- Party: the dealt deck (party_categories) leaves the Realtime publication.
--
-- party_start inserts the whole deck (60 rows) in one go, and Realtime sends each row to every listener in the room: 480
-- messages at once with 8 players, far over the free plan's 100 messages per second. Browsers don't need the rows live:
-- the page reads a new game's deck with one select when the room row shows a new game_no or a running game (src/party/
-- useParty.ts), and marks a category cleared or failed itself from the room's last_event, which carries its deck_no
-- (the SQL writes the result in the same transaction). Anon keeps SELECT on the table (grant and RLS policy unchanged).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_categories'
  ) then
    alter publication supabase_realtime drop table public.party_categories;
  end if;
end;
$$;
