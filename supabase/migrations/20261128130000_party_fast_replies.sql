-- Party: fewer round trips (the "a little bit of lag" fix).
--
--   * party_answer_context(room): everything the Edge Function needs to check an answer (the room's turn, the current
--     category's parts and this round's used species) in ONE read, instead of three sequential selects.
--   * party_settings and party_apply_answer now also return the rows they wrote ("room", and "answer" for an answer),
--     so the browser can show the change as soon as the reply lands instead of waiting for Realtime to bring the same
--     rows a few hundred milliseconds later. Realtime still delivers them; the browser's reducer treats the copy from
--     the reply as one more (idempotent) version of the row.
--
-- Turn rules and timers are unchanged: party_apply_answer below is the 20261127200000_party.sql version plus the
-- returned rows. All rows returned here are from the four public-read tables (anon can already select them).

-- --------------------------------------------------------- answer context ----
-- Service role only (the party Edge Function). Null when the room doesn't exist.
-- {status, game_no, round, category_no, turn_player_id, parts (null if no category), used: [species, ...]}
create function public.party_answer_context(p_room_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', r.status,
    'game_no', r.game_no,
    'round', r.round,
    'category_no', r.category_no,
    'turn_player_id', r.turn_player_id,
    'parts', (select c.parts from public.party_categories c
              where c.room_id = r.id and c.game_no = r.game_no and c.deck_no = r.category_no),
    'used', coalesce((select jsonb_agg(a.species order by a.id) from public.party_answers a
                      where a.room_id = r.id and a.game_no = r.game_no and a.round = r.round), '[]'::jsonb))
  from public.party_rooms r
  where r.id = p_room_id
$$;

-- --------------------------------------------------------------- settings ----
-- As before, plus "room": the room row after the change.
create or replace function public.party_settings(p_room_id uuid, p_player_id uuid, p_token text, p_lives int, p_start_tier text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
  v_me public.party_players;
begin
  select * into v_room from public.party_rooms where id = p_room_id for update;
  if not found then return public.party__err('no_room'); end if;
  v_me := public.party__auth(p_room_id, p_player_id, p_token);
  if v_me.id is null or v_me.gone_at is not null then return public.party__err('bad_token'); end if;
  if v_room.host_id is distinct from v_me.id then return public.party__err('not_host'); end if;
  if v_room.status <> 'lobby' then return public.party__err('not_lobby'); end if;
  if p_lives is null or p_lives not between 1 and 5
     or coalesce(p_start_tier, '') not in ('easy', 'medium', 'hard', 'expert') then
    return public.party__err('bad_settings');
  end if;
  update public.party_rooms set lives = p_lives, start_tier = p_start_tier, last_activity = now() where id = p_room_id
  returning * into v_room;
  update public.party_players set lives = p_lives where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'room', to_jsonb(v_room));
end;
$$;

-- ----------------------------------------------------------------- answer ----
-- As before, plus "room" (the room row after the answer) and "answer" (the party_answers row it inserted).
create or replace function public.party_apply_answer(
  p_room_id uuid, p_player_id uuid, p_token text, p_pokemon_id int, p_species int, p_pool_exhausted boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
  v_me public.party_players;
  v_answer public.party_answers;
  v_next uuid;
  v_result text;
  v_lap boolean;
begin
  select * into v_room from public.party_rooms where id = p_room_id for update;
  if not found then return public.party__err('no_room'); end if;
  v_me := public.party__auth(p_room_id, p_player_id, p_token);
  if v_me.id is null then return public.party__err('bad_token'); end if;
  if v_room.status <> 'playing' then return public.party__err('not_playing'); end if;
  if v_room.turn_player_id is distinct from v_me.id then return public.party__err('not_your_turn'); end if;
  if now() > v_room.deadline + public.party__grace() then
    return public.party__err('too_late') || jsonb_build_object('timeout', public.party__fail(p_room_id, v_me.id));
  end if;
  if p_pokemon_id is null or p_pokemon_id not between 1 and 100000 or p_species is null or p_species not between 1 and 100000 then
    return public.party__err('bad_answer');
  end if;

  begin
    insert into public.party_answers (room_id, game_no, round, player_id, pokemon_id, species)
    values (p_room_id, v_room.game_no, v_room.round, v_me.id, p_pokemon_id, p_species)
    returning * into v_answer;
  exception when unique_violation then
    return public.party__err('already_used');
  end;
  update public.party_players set answers_given = answers_given + 1 where id = v_me.id;

  -- Full lap: everyone still in the turn order has answered this round.
  v_lap := not exists (
    select 1 from public.party_players p
    where p.room_id = p_room_id and p.seat is not null and not p.is_out and p.gone_at is null
      and not exists (select 1 from public.party_answers a
                      where a.room_id = p_room_id and a.game_no = v_room.game_no and a.round = v_room.round
                        and a.player_id = p.id)
  );
  v_next := public.party__next_active(p_room_id, v_me.seat);

  if v_lap or coalesce(p_pool_exhausted, false) then
    v_result := 'cleared';
    update public.party_categories set result = 'cleared'
    where room_id = p_room_id and game_no = v_room.game_no and deck_no = v_room.category_no;
    perform public.party__begin_round(p_room_id, v_room.round + 1, v_next);
    update public.party_rooms set last_event = jsonb_build_object(
      'kind', 'cleared', 'round', v_room.round, 'player_id', v_me.id, 'deck_no', v_room.category_no,
      'exhausted', coalesce(p_pool_exhausted, false) and not v_lap)
    where id = p_room_id;
  else
    v_result := 'passed';
    perform public.party__next_turn(p_room_id, v_next);
    update public.party_rooms set last_event = jsonb_build_object(
      'kind', 'answer', 'round', v_room.round, 'player_id', v_me.id, 'pokemon_id', p_pokemon_id)
    where id = p_room_id;
  end if;

  select * into v_room from public.party_rooms where id = p_room_id;
  return jsonb_build_object('ok', true, 'result', v_result, 'round', v_room.round,
    'turn_player_id', v_room.turn_player_id, 'deadline', v_room.deadline, 'turn_no', v_room.turn_no,
    'room', to_jsonb(v_room), 'answer', to_jsonb(v_answer));
end;
$$;

-- ----------------------------------------------------------------- grants ----
-- Supabase grants execute on new functions to anon/authenticated/service_role by default: take it back first.
-- (create or replace keeps the existing grants of party_settings and party_apply_answer.)
revoke all on function public.party_answer_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.party_answer_context(uuid) to service_role;
