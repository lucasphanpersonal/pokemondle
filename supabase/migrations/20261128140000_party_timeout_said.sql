-- Party: the timeout event names the round's answers, so every screen shows the same "Also fit".
--
-- "Also fit" shows a few species that fit the failed round's category and nobody said, picked with a seed every screen
-- shares (room, game, round). Each browser used to take "nobody said" from the answers it had received, so a screen
-- that missed one (a late Realtime message, a snapshot read after the round moved on) could show other sprites.
-- party_rooms.last_event for a timeout now carries 'said': the pokemon ids answered in that round, oldest first.
-- Only party__fail changes; it is the one place a timeout event is built (party_timeout, the sweep, a player who
-- leaves or drops on their turn). Internal helper: no grants (create or replace keeps the existing ones: none).

create or replace function public.party__fail(p_room_id uuid, p_player uuid) returns jsonb
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
  v_p public.party_players;
  v_event jsonb;
  v_starter uuid;
begin
  select * into v_room from public.party_rooms where id = p_room_id;

  update public.party_players set
    lives = greatest(lives - 1, 0),
    is_out = lives <= 1
  where id = p_player
  returning * into v_p;

  update public.party_categories set result = 'failed'
  where room_id = p_room_id and game_no = v_room.game_no and deck_no = v_room.category_no;

  v_event := jsonb_build_object(
    'kind', 'timeout', 'round', v_room.round, 'player_id', p_player,
    'lives', v_p.lives, 'out', v_p.is_out, 'deck_no', v_room.category_no,
    'said', coalesce((
      select jsonb_agg(a.pokemon_id order by a.id) from public.party_answers a
      where a.room_id = p_room_id and a.game_no = v_room.game_no and a.round = v_room.round
    ), '[]'::jsonb));

  if public.party__active_count(p_room_id) <= 1 then
    v_event := v_event || jsonb_build_object('over', true, 'winner_id', public.party__finish(p_room_id, v_event));
  else
    if not v_p.is_out and v_p.gone_at is null then
      v_starter := p_player;
    else
      v_starter := public.party__next_active(p_room_id, v_p.seat);
    end if;
    perform public.party__begin_round(p_room_id, v_room.round + 1, v_starter);
    update public.party_rooms set last_event = v_event where id = p_room_id;
  end if;
  return v_event;
end;
$$;

revoke all on function public.party__fail(uuid, uuid) from public, anon, authenticated, service_role;
