-- Party turn rules (migration 20261127200000_party.sql). One transaction, rolled back at the end.
-- now() is fixed for the whole transaction, so deadlines are moved by hand instead of sleeping.
begin;
select no_plan();

-- ---------------------------------------------------------------- helpers ----
create temp table ctx (room uuid, pid uuid primary key, token text, name text);

-- Hosts a room for names[1], joins the others, starts with a 6-entry deck. Returns the room id.
create function pg_temp.mkroom(p_names text[]) returns uuid language plpgsql as $$
declare
  j jsonb;
  v_room uuid;
  v_code text;
  i int;
  v_deck jsonb := (
    select jsonb_agg(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('kind', 'gen', 'value', n)),
                                        'tier', 'easy', 'pool', 100, 'seconds', 20))
    from generate_series(1, 6) n);
begin
  j := public.party_create(p_names[1]);
  v_room := (j->>'room_id')::uuid; v_code := j->>'code';
  insert into ctx values (v_room, (j->>'player_id')::uuid, j->>'token', p_names[1]);
  for i in 2..array_length(p_names, 1) loop
    j := public.party_join(lower(v_code), p_names[i]);
    insert into ctx values (v_room, (j->>'player_id')::uuid, j->>'token', p_names[i]);
  end loop;
  j := public.party_start(v_room, (select pid from ctx where room = v_room and name = p_names[1]),
                          (select token from ctx where room = v_room and name = p_names[1]), v_deck);
  if not (j->>'ok')::boolean then raise exception 'start failed: %', j; end if;
  return v_room;
end $$;

create function pg_temp.tok(p uuid) returns text language sql as $$ select token from ctx where pid = p $$;
create function pg_temp.turn(r uuid) returns uuid language sql as $$ select turn_player_id from public.party_rooms where id = r $$;
create function pg_temp.at_seat(r uuid, s int) returns uuid language sql as $$
  select id from public.party_players where room_id = r and seat = s $$;
create function pg_temp.ans(r uuid, p uuid, species int, exhausted boolean default false) returns jsonb language sql as $$
  select public.party_apply_answer(r, p, pg_temp.tok(p), species, species, exhausted) $$;
-- Puts the current deadline p_ms milliseconds in the past.
create function pg_temp.expire(r uuid, p_ms int) returns void language sql as $$
  update public.party_rooms set deadline = now() - make_interval(secs => p_ms / 1000.0) where id = r $$;
create function pg_temp.lives(p uuid) returns int language sql as $$ select lives from public.party_players where id = p $$;
create function pg_temp.room(r uuid) returns public.party_rooms language sql as $$ select * from public.party_rooms where id = r $$;

-- ------------------------------------------------------------------ setup ----
select is((public.party_create('  Ash   Ketchum ')->>'nickname'), 'Ash Ketchum', 'nickname is trimmed and spaces collapsed');
select is((public.party_create('Ash!')->>'error'), 'bad_nickname', 'nickname with a symbol is refused');
select is((public.party_join('ZZZZ', 'Ash')->>'error'), 'no_room', 'unknown code is refused');

create temp table r1 as select pg_temp.mkroom(array['Ash', 'Misty', 'Brock']) as id;
select is((select count(*)::int from public.party_players where room_id = (select id from r1) and seat is not null), 3,
  'three players seated');
select is((select status from public.party_rooms where id = (select id from r1)), 'playing', 'room is playing');
select is((select round from public.party_rooms where id = (select id from r1)), 1, 'round 1');
select is(pg_temp.turn((select id from r1)), pg_temp.at_seat((select id from r1), 0), 'seat 0 starts');
select ok((select deadline from public.party_rooms where id = (select id from r1)) = now() + interval '20 seconds',
  'deadline is now + the category seconds');
select is((select count(*)::int from public.party_categories where room_id = (select id from r1)), 6, 'deck stored');

-- Name clash: "Ash" again becomes "Ash 2".
select is((public.party_join((select code from public.party_room_codes where room_id = (select id from r1)), 'ash')->>'nickname'),
  'ash 2', 'duplicate nickname gets a number');
-- That late arrival watches.
select is((select seat from public.party_players where room_id = (select id from r1) and nickname = 'ash 2'), null::smallint,
  'late arrival watches (no seat)');

create temp table s as select pg_temp.at_seat((select id from r1), 0) as a, pg_temp.at_seat((select id from r1), 1) as b,
  pg_temp.at_seat((select id from r1), 2) as c;

-- ----------------------------------------------------------- out of turn ----
select is((pg_temp.ans((select id from r1), (select b from s), 4)->>'error'), 'not_your_turn', 'answer out of turn refused');
select is((select count(*)::int from public.party_answers where room_id = (select id from r1)), 0, 'out-of-turn answer not recorded');
select is((public.party_apply_answer((select id from r1), (select a from s), repeat('0', 64), 4, 4)->>'error'), 'bad_token',
  'wrong token refused');

-- ------------------------------------------------------------------ pass ----
select is((pg_temp.ans((select id from r1), (select a from s), 4)->>'result'), 'passed', 'valid answer passes');
select is(pg_temp.turn((select id from r1)), (select b from s), 'turn moves to the next seat');
select is((select count(*)::int from public.party_answers where room_id = (select id from r1)), 1, 'answer recorded');
select is((select answers_given from public.party_players where id = (select a from s)), 1, 'answers_given counted');

-- Species already used this round.
select is((pg_temp.ans((select id from r1), (select b from s), 4)->>'error'), 'already_used', 'used species refused');
select is(pg_temp.turn((select id from r1)), (select b from s), 'used species keeps the turn');
select throws_ok(
  format('insert into public.party_answers (room_id, game_no, round, player_id, pokemon_id, species) values (%L, 1, 1, %L, 9, 4)',
         (select id from r1), (select c from s)),
  '23505', null, 'unique constraint: one answer per species per round');

-- ------------------------------------------------ grace boundary (on time) ----
select pg_temp.expire((select id from r1), 300);
select is((pg_temp.ans((select id from r1), (select b from s), 5)->>'result'), 'passed', 'answer 300 ms after the deadline accepted');
select is(pg_temp.turn((select id from r1)), (select c from s), 'turn moves to seat 2');

-- -------------------------------------------------------------- full lap ----
select is((pg_temp.ans((select id from r1), (select c from s), 6)->>'result'), 'cleared', 'full lap clears the round');
select is((pg_temp.room((select id from r1))).round, 2, 'round 2 after a cleared lap');
select is(pg_temp.turn((select id from r1)), (select a from s), 'next player after the last answerer starts');
select is((select sum(lives)::int from public.party_players where room_id = (select id from r1) and seat is not null), 9,
  'nobody lost a life on a cleared lap');
select is((pg_temp.room((select id from r1))).last_event->>'kind', 'cleared', 'last_event says cleared');
select is((select result from public.party_categories where room_id = (select id from r1) and deck_no = 1), 'cleared',
  'deck entry 1 marked cleared');
select is((pg_temp.room((select id from r1))).category_no, 2, 'round 2 plays deck entry 2');

-- --------------------------------------------------------------- timeout ----
create temp table t0 as select (pg_temp.room((select id from r1))).turn_no as n;
select is((public.party_timeout((select id from r1))->>'acted')::boolean, false, 'party_timeout does nothing before the deadline');
select pg_temp.expire((select id from r1), 300);
select is((public.party_timeout((select id from r1))->>'acted')::boolean, false, 'party_timeout does nothing within the 300 ms grace');
select pg_temp.expire((select id from r1), 1000);
select is((public.party_timeout((select id from r1), (select n from t0) + 99)->>'acted')::boolean, false,
  'party_timeout for another turn number does nothing');
select is((public.party_timeout((select id from r1))->>'acted')::boolean, true, 'party_timeout acts after the deadline');
select is(pg_temp.lives((select a from s)), 2, 'timeout loses a life');
select is((public.party_timeout((select id from r1))->>'acted')::boolean, false, 'party_timeout acts only once');
select is(pg_temp.lives((select a from s)), 2, 'still only one life lost');
select is((pg_temp.room((select id from r1))).round, 3, 'timeout ends the round');
select is(pg_temp.turn((select id from r1)), (select a from s), 'the failed player starts the next round');
select is((select result from public.party_categories where room_id = (select id from r1) and deck_no = 2), 'failed',
  'deck entry 2 marked failed');
select is((pg_temp.room((select id from r1))).last_event->'said', '[]'::jsonb, 'timeout event: nobody answered that round');

-- The timeout event names the round's answers (migration 20261128140000), so every screen shows the same "Also fit".
create temp table rs as select pg_temp.mkroom(array['Gary', 'Erika']) as id;
create temp table ss as select pg_temp.at_seat((select id from rs), 0) as a, pg_temp.at_seat((select id from rs), 1) as b;
select is((pg_temp.ans((select id from rs), (select a from ss), 10)->>'result'), 'passed', 'said: a passes');
select pg_temp.expire((select id from rs), 1000);
select is((public.party_timeout((select id from rs))->'said'), '[10]'::jsonb, 'timeout reply lists the round''s answers');
select is((pg_temp.room((select id from rs))).last_event->'said', '[10]'::jsonb, 'last_event lists the round''s answers');

-- ------------------------------------------------------------ late answer ----
select pg_temp.expire((select id from r1), 301);
create temp table late as select pg_temp.ans((select id from r1), (select a from s), 7) as j;
select is(((select j from late)->>'error'), 'too_late', 'answer 301 ms after the deadline refused');
select is(((select j from late)->'timeout'->>'kind'), 'timeout', 'a late answer times the turn out at once');
select is(pg_temp.lives((select a from s)), 1, 'late answer loses the life');
select is((select count(*)::int from public.party_answers where room_id = (select id from r1) and species = 7), 0,
  'late answer not recorded');
select is((pg_temp.room((select id from r1))).round, 4, 'late answer ends the round');

-- -------------------------------------------------------------- out at 0 ----
select pg_temp.expire((select id from r1), 1000);
select is((public.party_timeout((select id from r1))->>'out')::boolean, true, 'timeout reports out');
select is(pg_temp.lives((select a from s)), 0, 'lives reach 0');
select is((select is_out from public.party_players where id = (select a from s)), true, 'out at 0 lives');
select is(pg_temp.turn((select id from r1)), (select b from s), 'an out player does not start: the next living player does');
select is((pg_temp.room((select id from r1))).status, 'playing', 'two players left, still playing');

-- Turn order now skips the out player: b -> c -> (lap) cleared.
select is((pg_temp.ans((select id from r1), (select b from s), 10)->>'result'), 'passed', 'b passes');
select is(pg_temp.turn((select id from r1)), (select c from s), 'turn skips nobody between b and c');
select is((pg_temp.ans((select id from r1), (select c from s), 11)->>'result'), 'cleared', 'lap of the two living players clears');
select is(pg_temp.turn((select id from r1)), (select b from s), 'out player skipped when the turn wraps');

-- ---------------------------------------------------------------- winner ----
update public.party_players set lives = 1 where id = (select b from s);
select pg_temp.expire((select id from r1), 1000);
create temp table fin as select public.party_timeout((select id from r1)) as j;
select is(((select j from fin)->>'over')::boolean, true, 'last life lost ends the game');
select is((pg_temp.room((select id from r1))).status, 'over', 'game over status');
select is((pg_temp.room((select id from r1))).winner_id, (select c from s), 'the last player with lives wins');
select is((pg_temp.room((select id from r1))).deadline, null::timestamptz, 'no deadline after the game');
select is((pg_temp.ans((select id from r1), (select c from s), 12)->>'error'), 'not_playing', 'no answers after the game');
select is((public.party_timeout((select id from r1))->>'acted')::boolean, false, 'no timeouts after the game');

-- ------------------------------------------------------------ play again ----
-- Seats are shuffled, so find the host and a non-host by query.
create temp table host1 as select host_id as h,
  (select p.id from public.party_players p where p.room_id = r.id and p.id <> r.host_id and p.seat is not null limit 1) as other
  from public.party_rooms r where r.id = (select id from r1);
select is((public.party_play_again((select id from r1), (select other from host1), pg_temp.tok((select other from host1)))->>'error'),
  'not_host', 'only the host can play again');
select is((public.party_play_again((select id from r1), (select h from host1), pg_temp.tok((select h from host1)))->>'ok')::boolean,
  true, 'host plays again');
select is((pg_temp.room((select id from r1))).status, 'lobby', 'back to the lobby');
select is((select count(*)::int from public.party_players where room_id = (select id from r1) and lives = 3 and not is_out and seat is null),
  4, 'everyone reset, watcher included');

-- ------------------------------------------------------ pool exhausted flag ----
create temp table r2 as select pg_temp.mkroom(array['Gary', 'Erika', 'Sabrina']) as id;
select is((pg_temp.ans((select id from r2), pg_temp.turn((select id from r2)), 25, true)->>'result'), 'cleared',
  'pool exhausted clears the round mid-lap');
select is((pg_temp.room((select id from r2))).last_event->>'exhausted', 'true', 'last_event says the pool ran out');
select is((pg_temp.room((select id from r2))).round, 2, 'next round after an exhausted pool');

-- ------------------------------------------------------------ sweep (cron) ----
select pg_temp.expire((select id from r2), 1000);
create temp table t2 as select pg_temp.turn((select id from r2)) as p;
select ok(public.party_sweep() >= 1, 'sweep times out a room past its deadline');
select is(pg_temp.lives((select p from t2)), 2, 'sweep timeout loses a life');
select is(public.party_sweep(), 0, 'sweep does nothing more');

-- ----------------------------------------------------- player gone 60 s ----
create temp table r3 as select pg_temp.mkroom(array['Koga', 'Blaine', 'Giovanni']) as id;
create temp table s3 as select pg_temp.at_seat((select id from r3), 0) as a, pg_temp.at_seat((select id from r3), 1) as b,
  pg_temp.at_seat((select id from r3), 2) as c;
update public.party_tokens set last_seen = now() - interval '59 seconds' where player_id = (select c from s3);
select is(public.party_sweep(), 0, 'a player seen 59 s ago is kept');
update public.party_tokens set last_seen = now() - interval '61 seconds' where player_id = (select c from s3);
select is(public.party_sweep(), 1, 'sweep drops a player gone 60 s');
select is((select gone_reason from public.party_players where id = (select c from s3)), 'dropped', 'marked dropped');
select is(pg_temp.lives((select c from s3)), 3, 'dropped player keeps their lives');
select is((pg_temp.room((select id from r3))).status, 'playing', 'two left, game goes on');
select is((pg_temp.ans((select id from r3), (select a from s3), 30)->>'result'), 'passed', 'a passes');
select is((pg_temp.ans((select id from r3), (select b from s3), 31)->>'result'), 'cleared', 'lap without the dropped player clears');
select is(pg_temp.turn((select id from r3)), (select a from s3), 'dropped player skipped in the turn order');
-- Coming back mid-game does not put them back in the turn order.
select is((public.party_heartbeat((select c from s3), pg_temp.tok((select c from s3)))->>'present')::boolean, false,
  'dropped player stays out of the turn order for this game');
-- Dropped on their own turn: treated as a timeout, and the game ends with one player left.
update public.party_tokens set last_seen = now() - interval '61 seconds' where player_id = (select a from s3);
select is(public.party_sweep(), 1, 'sweep drops the turn player');
select is(pg_temp.lives((select a from s3)), 2, 'dropped on their turn loses a life');
select is((pg_temp.room((select id from r3))).status, 'over', 'one player left: game over');
select is((pg_temp.room((select id from r3))).winner_id, (select b from s3), 'the last player in the turn order wins');

-- -------------------------------------------------------- host hand-off ----
create temp table r4j as select public.party_create('Lance') as j;
create temp table r4 as select ((select j from r4j)->>'room_id')::uuid as id, ((select j from r4j)->>'player_id')::uuid as host,
  (select j from r4j)->>'token' as tok;
create temp table r4b as select public.party_join((select j from r4j)->>'code', 'Clair') as j;
update public.party_tokens set last_seen = now() - interval '61 seconds' where player_id = (select host from r4);
select is(public.party_sweep(), 1, 'host gone 60 s in the lobby is dropped');
select is((pg_temp.room((select id from r4))).host_id, ((select j from r4b)->>'player_id')::uuid,
  'host passes to the longest-joined connected player');
select is((public.party_heartbeat((select host from r4), (select tok from r4))->>'present')::boolean, true,
  'dropped lobby player is present again after a heartbeat');
select is((public.party_start((select id from r4), (select host from r4), (select tok from r4), '[]'::jsonb)->>'error'),
  'not_host', 'old host can no longer start');
select is((public.party_leave((select id from r4), (select host from r4), (select tok from r4))->>'ok')::boolean, true, 'leave');
select is((public.party_heartbeat((select host from r4), (select tok from r4))->>'error'), 'bad_token', 'token dead after leaving');

-- ----------------------------------------------------------- idle clean-up ----
update public.party_rooms set last_activity = now() - interval '3 hours' where id = (select id from r4);
update public.party_tokens set last_seen = now() - interval '3 hours'
  where player_id in (select id from public.party_players where room_id = (select id from r4));
select ok(public.party_cleanup() >= 1, 'idle room deleted');
select is((select count(*)::int from public.party_players where room_id = (select id from r4)), 0, 'its players went with it');
select is((select count(*)::int from public.party_rooms where id = (select id from r1)), 1, 'active rooms kept');

-- -------------------------------------------------------------- deck wrap ----
select is(public.party__deck_no(40, 1), 1, 'round 1 plays deck entry 1');
select is(public.party__deck_no(40, 40), 40, 'round 40 plays the last entry');
select is(public.party__deck_no(40, 41), 31, 'round 41 wraps to the last 10 entries');
select is(public.party__deck_no(40, 50), 40, 'round 50 is the end of the loop');
select is(public.party__deck_no(40, 51), 31, 'round 51 loops again');
select is(public.party__deck_no(6, 7), 1, 'a deck under 10 entries loops all of it');
select is(public.party__deck_no(6, 13), 1, 'and keeps looping');

-- ------------------------------------------------------- non-turn leaving ----
create temp table r5 as select pg_temp.mkroom(array['Red', 'Blue', 'Green', 'Yellow']) as id;
create temp table s5 as select pg_temp.at_seat((select id from r5), 0) as t, pg_temp.at_seat((select id from r5), 1) as b,
  pg_temp.at_seat((select id from r5), 2) as c, pg_temp.at_seat((select id from r5), 3) as d;
create temp table dl5 as select deadline as dl from public.party_rooms where id = (select id from r5);
select is((public.party_leave((select id from r5), (select b from s5), pg_temp.tok((select b from s5)))->>'ok')::boolean, true,
  'a non-turn player leaves');
select is((select gone_reason from public.party_players where id = (select b from s5)), 'left', 'marked left');
select is(pg_temp.lives((select b from s5)), 3, 'leaving off-turn costs no life');
select is(pg_temp.turn((select id from r5)), (select t from s5), 'turn unchanged');
select is((pg_temp.room((select id from r5))).deadline, (select dl from dl5), 'deadline unchanged');
select is((pg_temp.room((select id from r5))).status, 'playing', 'game goes on with three');
select is((pg_temp.room((select id from r5))).last_event->>'kind', 'gone', 'last_event says gone');
select is((pg_temp.ans((select id from r5), (select t from s5), 40)->>'result'), 'passed', 'turn player passes');
select is(pg_temp.turn((select id from r5)), (select c from s5), 'the player who left is skipped');
select is((public.party_heartbeat((select b from s5), pg_temp.tok((select b from s5)))->>'error'), 'bad_token',
  'leaver token is dead');

-- ------------------------------------------------------------------ remove ----
create temp table h5 as select host_id as h from public.party_rooms where id = (select id from r5);
-- Someone still in the turn order who is neither the host nor on turn.
create temp table v5 as select p.id as v from public.party_players p
  where p.room_id = (select id from r5) and p.gone_at is null and p.id <> (select h from h5)
    and p.id <> pg_temp.turn((select id from r5))
  order by p.seat limit 1;
create temp table nh5 as select p.id as n from public.party_players p
  where p.room_id = (select id from r5) and p.gone_at is null and p.id <> (select h from h5) order by p.seat limit 1;
select is((public.party_remove((select id from r5), (select n from nh5), pg_temp.tok((select n from nh5)), (select h from h5))->>'error'),
  'not_host', 'only the host can remove');
select is((public.party_remove((select id from r5), (select h from h5), pg_temp.tok((select h from h5)), (select h from h5))->>'error'),
  'no_player', 'the host cannot remove themself');
select is((public.party_remove((select id from r5), (select h from h5), pg_temp.tok((select h from h5)), gen_random_uuid())->>'error'),
  'no_player', 'unknown player');
select is((public.party_remove((select id from r5), (select h from h5), pg_temp.tok((select h from h5)), (select v from v5))->>'ok')::boolean,
  true, 'host removes a player');
select is((select gone_reason from public.party_players where id = (select v from v5)), 'removed', 'marked removed');
select is((public.party_heartbeat((select v from v5), pg_temp.tok((select v from v5)))->>'error'), 'bad_token',
  'removed player token is dead');
select is((public.party_remove((select id from r5), (select h from h5), pg_temp.tok((select h from h5)), (select v from v5))->>'error'),
  'no_player', 'already removed');
select is(public.party__active_count((select id from r5)), 2, 'two left in the turn order');

-- -------------------------------------------------------------- room full ----
create temp table r6j as select public.party_create('Oak', 2, 'easy') as j;
create temp table r6 as select ((select j from r6j)->>'room_id')::uuid as id, ((select j from r6j)->>'player_id')::uuid as host,
  (select j from r6j)->>'token' as tok, (select j from r6j)->>'code' as code;
select is((select count(*)::int from generate_series(2, 8) n
           where (public.party_join((select code from r6), 'Guest' || n)->>'ok')::boolean), 7, 'seven join (eight in the room)');
select is((public.party_join((select code from r6), 'Guest9')->>'error'), 'room_full', 'the ninth is refused: room_full');
select is((select count(*)::int from public.party_players where room_id = (select id from r6)), 8, 'still eight');

-- --------------------------------------------------------------- settings ----
select is((public.party_settings((select id from r6), (select host from r6), (select tok from r6), 5, 'hard')->>'ok')::boolean, true,
  'host changes the settings');
select is((select lives from public.party_rooms where id = (select id from r6)), 5::smallint, 'lives stored');
select is((select start_tier from public.party_rooms where id = (select id from r6)), 'hard', 'start tier stored');
select is((select min(lives)::int from public.party_players where room_id = (select id from r6)), 5, 'players get the new lives');
select is((public.party_settings((select id from r6), (select host from r6), (select tok from r6), 6, 'hard')->>'error'),
  'bad_settings', 'lives over 5 refused');
select is((public.party_settings((select id from r6), (select host from r6), (select tok from r6), 3, 'insane')->>'error'),
  'bad_settings', 'unknown tier refused');
select is((public.party_settings((select id from r1), pg_temp.at_seat((select id from r3), 1), pg_temp.tok(pg_temp.at_seat((select id from r3), 1)), 3, 'easy')->>'error'),
  'bad_token', 'a player from another room is refused');
select is((public.party_settings((select id from r5), (select h from h5), pg_temp.tok((select h from h5)), 3, 'easy')->>'error'),
  'not_lobby', 'settings refused during a game');
create temp table nh6 as select p.id as n from public.party_players p
  where p.room_id = (select id from r1) and p.gone_at is null and p.id <> (select host_id from public.party_rooms where id = (select id from r1))
    and p.id in (select pid from ctx) limit 1;
select is((public.party_settings((select id from r1), (select n from nh6), pg_temp.tok((select n from nh6)), 3, 'easy')->>'error'),
  'not_host', 'settings refused for a non-host');

-- ----------------------------------------------------------------- rejoin ----
create temp table rj as select public.party_rejoin((select host from r6), (select tok from r6)) as j;
select is(((select j from rj)->>'ok')::boolean, true, 'rejoin with the right token');
select is(((select j from rj)->>'room_id')::uuid, (select id from r6), 'rejoin returns the room');
select is(((select j from rj)->>'code'), (select code from r6), 'rejoin returns the code');
select ok(not ((select j from rj) ? 'token'), 'rejoin never returns the token');
select ok(((select j from rj)->>'server_time')::bigint > 0, 'rejoin returns the server time');
select is((public.party_rejoin((select host from r6), repeat('f', 64))->>'error'), 'bad_token', 'rejoin with a wrong token refused');
select is((public.party_rejoin(gen_random_uuid(), (select tok from r6))->>'error'), 'bad_token', 'rejoin as another player refused');

-- -------------------------------------------------------- network caps ----
select is(public.party_network_hit(repeat('ab', 32), 'create', 2, interval '1 hour'), true, 'first create under the cap');
select is(public.party_network_hit(repeat('ab', 32), 'create', 2, interval '1 hour'), true, 'second create under the cap');
select is(public.party_network_hit(repeat('ab', 32), 'create', 2, interval '1 hour'), false, 'third create over the cap');
select is(public.party_network_hit(repeat('ab', 32), 'join', 2, interval '1 hour'), true, 'joins counted apart');

-- ------------------------------------------------------------------ anon ----
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'party_rooms'),
  'party_rooms in the realtime publication');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'party_tokens'),
  'party_tokens not published');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'party_players'),
  'party_players in the realtime publication');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'party_answers'),
  'party_answers in the realtime publication');
-- The deck is read with a select when a game starts (migration 20261128160000): no burst of one message per row.
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'party_categories'),
  'party_categories not published');
select ok(has_table_privilege('anon', 'public.party_categories', 'select'), 'anon can still select party_categories');
select ok(not exists (select 1 from information_schema.columns where table_name = 'party_players' and column_name like '%token%'),
  'party_players has no token column');
select ok(not has_function_privilege('anon', 'public.party_apply_answer(uuid, uuid, text, int, int, boolean)', 'execute'),
  'anon cannot call party_apply_answer');
select ok(not has_function_privilege('anon', 'public.party_start(uuid, uuid, text, jsonb)', 'execute'),
  'anon cannot call party_start');
select ok(not has_function_privilege('anon', 'public.party_sweep()', 'execute'), 'anon cannot call party_sweep');
select ok(not has_function_privilege('anon', 'public.party_cleanup(interval)', 'execute'), 'anon cannot call party_cleanup');
select ok(not has_function_privilege('authenticated', 'public.party_sweep()', 'execute'), 'authenticated cannot call party_sweep');
select ok(not has_function_privilege('service_role', 'public.party_cleanup(interval)', 'execute'),
  'service_role cannot call party_cleanup (cron only)');
select ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'party\_\_%') >= 20, 'the party__ helpers exist');
select is((select string_agg(p.proname || '/' || r, ', ' order by p.proname, r)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           cross join unnest(array['anon', 'authenticated', 'service_role']) r
           where n.nspname = 'public' and p.proname like 'party\_\_%' and has_function_privilege(r, p.oid, 'execute')),
  null::text, 'no role but the owner can execute any party__ helper');
-- Only these party_ functions are callable by anon at all.
select is((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'party\_%' and has_function_privilege('anon', p.oid, 'execute')),
  'party_heartbeat, party_timeout', 'anon can execute exactly party_heartbeat and party_timeout');
select ok(has_function_privilege('anon', 'public.party_timeout(uuid, bigint)', 'execute'), 'anon can call party_timeout');
select ok(has_function_privilege('anon', 'public.party_heartbeat(uuid, text)', 'execute'), 'anon can call party_heartbeat');

select ok(set_config('party.test_pid', (select c from s)::text, true) is not null, 'stash party.test_pid');
select ok(set_config('party.test_tok', pg_temp.tok((select c from s)), true) is not null, 'stash party.test_tok');
select ok(set_config('party.test_room', (select id from r1)::text, true) is not null, 'stash party.test_room');

set local role anon;
select ok((select count(*) from public.party_rooms) > 0, 'anon can read party_rooms');
select ok((select count(*) from public.party_players) > 0, 'anon can read party_players');
select ok((select count(*) from public.party_answers) > 0, 'anon can read party_answers');
select ok((select count(*) from public.party_categories) > 0, 'anon can read party_categories');
select throws_ok('select * from public.party_tokens', '42501', null, 'anon cannot read party_tokens');
select throws_ok('select * from public.party_room_codes', '42501', null, 'anon cannot read room codes');
select throws_ok('insert into public.party_rooms default values', '42501', null, 'anon cannot insert party_rooms');
select throws_ok($$update public.party_rooms set lives = 5$$, '42501', null, 'anon cannot update party_rooms');
select throws_ok($$delete from public.party_rooms$$, '42501', null, 'anon cannot delete party_rooms');
select throws_ok($$update public.party_players set lives = 5$$, '42501', null, 'anon cannot update party_players');
select throws_ok($$delete from public.party_players$$, '42501', null, 'anon cannot delete party_players');
select throws_ok($$insert into public.party_answers (room_id, game_no, round, player_id, pokemon_id, species)
  select room_id, 1, 1, id, 1, 1 from public.party_players limit 1$$, '42501', null, 'anon cannot insert party_answers');
select throws_ok($$update public.party_answers set species = 1$$, '42501', null, 'anon cannot update party_answers');
select throws_ok($$delete from public.party_answers$$, '42501', null, 'anon cannot delete party_answers');
select throws_ok($$update public.party_categories set pool = 1$$, '42501', null, 'anon cannot update party_categories');
select throws_ok($$delete from public.party_categories$$, '42501', null, 'anon cannot delete party_categories');
select throws_ok($$update public.party_tokens set last_seen = now()$$, '42501', null, 'anon cannot update party_tokens');
select throws_ok($$select public.party_apply_answer(gen_random_uuid(), gen_random_uuid(), '', 1, 1)$$, '42501', null,
  'anon cannot execute party_apply_answer');
select throws_ok($$select public.party_sweep()$$, '42501', null, 'anon cannot execute party_sweep');
select throws_ok($$select public.party_cleanup()$$, '42501', null, 'anon cannot execute party_cleanup');
select throws_ok($$select public.party__fail(gen_random_uuid(), gen_random_uuid())$$, '42501', null,
  'anon cannot execute a party__ helper');
select is((public.party_heartbeat(current_setting('party.test_pid')::uuid, current_setting('party.test_tok'))->>'ok')::boolean,
  true, 'anon heartbeat with the right token works');
select is((public.party_heartbeat(current_setting('party.test_pid')::uuid, repeat('a', 64))->>'error'), 'bad_token',
  'anon heartbeat with a wrong token refused');
select is((public.party_timeout(current_setting('party.test_room')::uuid)->>'acted')::boolean, false, 'anon party_timeout is harmless');
reset role;

select * from finish();
rollback;
