-- Party fast replies (migration 20261128120000_party_fast_replies.sql): party_answer_context, and the rows
-- party_settings and party_apply_answer return. One transaction, rolled back at the end.
begin;
select no_plan();

-- A lobby: host Ash, guest Misty.
create temp table t as
  select (j->>'room_id')::uuid as room, (j->>'player_id')::uuid as host, j->>'token' as host_tok, j->>'code' as code
  from (select public.party_create('Ash', 3, 'easy') as j) x;
create temp table g as
  select (j->>'player_id')::uuid as guest, j->>'token' as guest_tok
  from (select public.party_join((select code from t), 'Misty') as j) x;
create function pg_temp.tok(p uuid) returns text language sql as $$
  select case when p = (select host from t) then (select host_tok from t) else (select guest_tok from g) end $$;

-- --------------------------------------------------------------- settings ----
create temp table st as
  select public.party_settings((select room from t), (select host from t), (select host_tok from t), 4, 'medium') as j;
select is(((select j from st)->>'ok')::boolean, true, 'settings still succeed');
select is(((select j from st)->'room'->>'id')::uuid, (select room from t), 'settings reply carries the room row');
select is(((select j from st)->'room'->>'lives')::int, 4, 'reply room has the new lives');
select is(((select j from st)->'room'->>'start_tier'), 'medium', 'reply room has the new start tier');
select is((select j from st)->'room', (select to_jsonb(r) from public.party_rooms r where r.id = (select room from t)),
  'reply room equals the stored row');
select is((public.party_settings((select room from t), (select guest from g), (select guest_tok from g), 2, 'easy') ? 'room'),
  false, 'a refused change returns no room');
select is((select lives from public.party_rooms where id = (select room from t)), 4::smallint, 'refused change stored nothing');

-- --------------------------------------------------------- answer context ----
select is(public.party_answer_context(gen_random_uuid()), null::jsonb, 'context of an unknown room is null');
select is(public.party_answer_context((select room from t))->>'status', 'lobby', 'context in the lobby');
select is(public.party_answer_context((select room from t))->'parts', 'null'::jsonb, 'no category in the lobby');

select is((public.party_start((select room from t), (select host from t), (select host_tok from t),
  (select jsonb_agg(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('kind', 'gen', 'value', n)),
                                       'tier', 'easy', 'pool', 100, 'seconds', 20))
   from generate_series(1, 4) n))->>'ok')::boolean, true, 'game starts');

create temp table c1 as select public.party_answer_context((select room from t)) as j;
select is((select j from c1)->>'status', 'playing', 'context: playing');
select is(((select j from c1)->>'game_no')::int, 1, 'context: game_no');
select is(((select j from c1)->>'round')::int, 1, 'context: round');
select is(((select j from c1)->>'category_no')::int, 1, 'context: category_no');
select is(((select j from c1)->>'turn_player_id')::uuid, (select turn_player_id from public.party_rooms where id = (select room from t)),
  'context: turn player');
select is((select j from c1)->'parts', '[{"kind": "gen", "value": 1}]'::jsonb, 'context: the current category parts');
select is((select j from c1)->'used', '[]'::jsonb, 'context: nothing used yet');

-- ----------------------------------------------------------------- answer ----
create temp table who as select turn_player_id as first,
  (select id from public.party_players where room_id = (select room from t) and id <> turn_player_id) as second
  from public.party_rooms where id = (select room from t);
create temp table a1 as
  select public.party_apply_answer((select room from t), (select first from who), pg_temp.tok((select first from who)), 25, 25) as j;
select is((select j from a1)->>'result', 'passed', 'answer passes');
select is(((select j from a1)->>'turn_player_id')::uuid, (select second from who), 'turn moves on (as before)');
select is((select j from a1)->'room', (select to_jsonb(r) from public.party_rooms r where r.id = (select room from t)),
  'answer reply room equals the stored row');
select is(((select j from a1)->'room'->>'turn_no')::bigint, ((select j from a1)->>'turn_no')::bigint, 'reply room turn_no matches');
select is((select j from a1)->'answer',
  (select to_jsonb(a) from public.party_answers a where a.room_id = (select room from t) and a.species = 25),
  'answer reply carries the inserted answer row');
select is(((select j from a1)->'answer'->>'player_id')::uuid, (select first from who), 'answer row is by the answering player');
select is((public.party_answer_context((select room from t)))->'used', '[25]'::jsonb, 'context: the answer is used');
select is(((public.party_answer_context((select room from t)))->>'turn_player_id')::uuid, (select second from who),
  'context: the new turn player');

-- Already used: no rows in the reply.
create temp table a2 as
  select public.party_apply_answer((select room from t), (select second from who), pg_temp.tok((select second from who)), 25, 25) as j;
select is((select j from a2)->>'error', 'already_used', 'a used species is refused');
select ok(not ((select j from a2) ? 'room') and not ((select j from a2) ? 'answer'), 'a refusal carries no rows');

-- Full lap clears the round: the reply room is the new round.
create temp table a3 as
  select public.party_apply_answer((select room from t), (select second from who), pg_temp.tok((select second from who)), 4, 4) as j;
select is((select j from a3)->>'result', 'cleared', 'full lap clears the round');
select is(((select j from a3)->'room'->>'round')::int, 2, 'reply room is round 2');
select is(((select j from a3)->'room'->'last_event'->>'kind'), 'cleared', 'reply room carries the cleared event');
select is((select j from a3)->'room', (select to_jsonb(r) from public.party_rooms r where r.id = (select room from t)),
  'cleared reply room equals the stored row');
select is((public.party_answer_context((select room from t)))->'used', '[]'::jsonb, 'context: new round, nothing used');
select is((public.party_answer_context((select room from t)))->'parts', '[{"kind": "gen", "value": 2}]'::jsonb,
  'context: the new round''s category');

-- ------------------------------------------------------------------ grants ----
select ok(has_function_privilege('service_role', 'public.party_answer_context(uuid)', 'execute'),
  'service_role can call party_answer_context');
select ok(not has_function_privilege('anon', 'public.party_answer_context(uuid)', 'execute'), 'anon cannot call party_answer_context');
select ok(not has_function_privilege('authenticated', 'public.party_answer_context(uuid)', 'execute'),
  'authenticated cannot call party_answer_context');
select ok(not has_function_privilege('anon', 'public.party_settings(uuid, uuid, text, int, text)', 'execute'),
  'anon still cannot call party_settings');
select ok(has_function_privilege('service_role', 'public.party_apply_answer(uuid, uuid, text, int, int, boolean)', 'execute'),
  'service_role can still call party_apply_answer');
select ok(not has_function_privilege('anon', 'public.party_apply_answer(uuid, uuid, text, int, int, boolean)', 'execute'),
  'anon still cannot call party_apply_answer');

select * from finish();
rollback;
