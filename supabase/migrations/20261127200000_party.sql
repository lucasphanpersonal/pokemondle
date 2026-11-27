-- Party mode: rooms, players, the dealt category deck, answers and the turn rules.
--
-- Who can do what:
--   * Browsers (anon) may SELECT party_rooms, party_players, party_categories and party_answers (row-level
--     security, select-only policies) and receive them over Realtime. They can never insert, update or delete.
--   * Browsers may call exactly two functions: party_timeout (idempotent, does nothing before the deadline) and
--     party_heartbeat (needs the player's token).
--   * Everything else goes through the `party` Edge Function (service_role), which may read the four public tables
--     and call the party_* functions below. It cannot write the tables directly either: every change is made by a
--     security definer function, inside one transaction that locks the room row.
--   * party_tokens (sha256 of each player's secret token, plus last_seen), party_room_codes and
--     party_network_hits are readable by nobody but the owner.
--
-- Tokens are made and hashed here (sha256, core Postgres), never by the Edge Function: create/join return the raw
-- token once, and every later call passes it back raw. Only the hash is stored.
--
-- See supabase/README.md, "Party database", for the function contract.

-- --------------------------------------------------------------- tables ----

create table public.party_rooms (
  id               uuid        primary key default gen_random_uuid(),
  host_id          uuid,
  status           text        not null default 'lobby' check (status in ('lobby', 'playing', 'over')),
  -- Settings the host picks in the lobby.
  lives            smallint    not null default 3 check (lives between 1 and 5),
  start_tier       text        not null default 'easy' check (start_tier in ('easy', 'medium', 'hard', 'expert')),
  -- Counts games played in this room (1 for the first game); categories and answers carry it.
  game_no          int         not null default 0,
  -- Current round (1-based; 0 in the lobby) and the deck entry it plays (party_categories.deck_no).
  round            int         not null default 0,
  category_no      int,
  -- The current turn. turn_no goes up by one on every turn of every game.
  turn_player_id   uuid,
  turn_no          bigint      not null default 0,
  turn_seconds     smallint,
  turn_started_at  timestamptz,
  deadline         timestamptz,
  winner_id        uuid,
  -- What just happened, for the UI's banners: see the README for its shapes.
  last_event       jsonb       not null default '{"kind": "lobby"}'::jsonb,
  created_at       timestamptz not null default now(),
  last_activity    timestamptz not null default now(),
  constraint party_rooms_playing_has_turn check (
    status <> 'playing' or (turn_player_id is not null and deadline is not null and category_no is not null)
  )
);

-- Room codes are kept apart so anon cannot list every open room's code.
create table public.party_room_codes (
  code     text primary key check (code ~ '^[BCDFGHJKMNPQRSTVWXYZ]{4}$'),
  room_id  uuid not null unique references public.party_rooms (id) on delete cascade
);

create table public.party_players (
  id            uuid        primary key default gen_random_uuid(),
  room_id       uuid        not null references public.party_rooms (id) on delete cascade,
  nickname      text        not null check (nickname ~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' and char_length(nickname) <= 12),
  icon          int         not null check (icon between 1 and 100000),
  joined_at     timestamptz not null default clock_timestamp(),
  -- Turn order position (0-based) in the current or last game; null = watching (joined during a game) or lobby.
  seat          smallint    check (seat between 0 and 7),
  lives         smallint    not null default 3 check (lives between 0 and 5),
  is_out        boolean     not null default false,
  answers_given int         not null default 0,
  -- Set when the player left, was removed by the host, or was gone 60 s. A gone player is out of the turn order
  -- for the rest of the game (keeping their lives for the result screen).
  gone_at       timestamptz,
  gone_reason   text        check (gone_reason in ('left', 'removed', 'dropped')),
  constraint party_players_gone_pair check ((gone_at is null) = (gone_reason is null))
);
create unique index party_players_room_nickname_idx on public.party_players (room_id, lower(nickname));
create unique index party_players_room_seat_idx on public.party_players (room_id, seat) where seat is not null;

alter table public.party_rooms
  add constraint party_rooms_host_fk foreign key (host_id) references public.party_players (id) on delete set null,
  add constraint party_rooms_turn_fk foreign key (turn_player_id) references public.party_players (id) on delete set null,
  add constraint party_rooms_winner_fk foreign key (winner_id) references public.party_players (id) on delete set null;

-- Secret: never readable by anon/authenticated/service_role. last_seen lives here (not in party_players) so the
-- 4-second heartbeat doesn't send a Realtime message to every player in the room.
create table public.party_tokens (
  player_id   uuid        primary key references public.party_players (id) on delete cascade,
  token_hash  text        not null check (token_hash ~ '^[0-9a-f]{64}$'),
  last_seen   timestamptz not null default now()
);
create index party_tokens_last_seen_idx on public.party_tokens (last_seen);

-- The dealt deck of one game (written once by party_start).
create table public.party_categories (
  room_id   uuid     not null references public.party_rooms (id) on delete cascade,
  game_no   int      not null,
  deck_no   int      not null check (deck_no >= 1),
  parts     jsonb    not null check (jsonb_typeof(parts) = 'array'),
  tier      text     not null check (tier in ('easy', 'medium', 'hard', 'expert')),
  pool      int      not null check (pool >= 1),
  seconds   smallint not null check (seconds between 3 and 120),
  -- How the last round that played this entry ended.
  result    text     check (result in ('cleared', 'failed')),
  primary key (room_id, game_no, deck_no)
);

create table public.party_answers (
  id          bigint      generated always as identity primary key,
  room_id     uuid        not null references public.party_rooms (id) on delete cascade,
  game_no     int         not null,
  round       int         not null,
  player_id   uuid        not null references public.party_players (id) on delete cascade,
  pokemon_id  int         not null check (pokemon_id between 1 and 100000),
  species     int         not null check (species between 1 and 100000),
  created_at  timestamptz not null default now(),
  -- One answer per species per round.
  constraint party_answers_species_once unique (room_id, game_no, round, species)
);
create index party_answers_player_idx on public.party_answers (player_id);

-- Per-network caps for create/join (salted, daily-rotating IP hash from the Edge Function, like analytics).
create table public.party_network_hits (
  id       bigint      generated always as identity primary key,
  ip_hash  text        not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  action   text        not null check (action in ('create', 'join')),
  at       timestamptz not null default now()
);
create index party_network_hits_idx on public.party_network_hits (ip_hash, action, at);

-- Indexes for the once-a-second sweep and the hourly clean-up (cheap when there are no rooms).
create index party_rooms_deadline_idx on public.party_rooms (deadline) where status = 'playing';
create index party_rooms_last_activity_idx on public.party_rooms (last_activity);
create index party_players_room_idx on public.party_players (room_id);
create index party_players_present_idx on public.party_players (id) where gone_at is null;

-- ------------------------------------------------------------- lockdown ----
alter table public.party_rooms        enable row level security;
alter table public.party_room_codes   enable row level security;
alter table public.party_players      enable row level security;
alter table public.party_tokens       enable row level security;
alter table public.party_categories   enable row level security;
alter table public.party_answers      enable row level security;
alter table public.party_network_hits enable row level security;

revoke all on public.party_rooms, public.party_room_codes, public.party_players, public.party_tokens,
  public.party_categories, public.party_answers, public.party_network_hits
  from public, anon, authenticated, service_role;
revoke all on sequence public.party_answers_id_seq, public.party_network_hits_id_seq
  from public, anon, authenticated, service_role;

grant select on public.party_rooms, public.party_players, public.party_categories, public.party_answers
  to anon, authenticated, service_role;

create policy party_rooms_read on public.party_rooms for select to anon, authenticated, service_role using (true);
create policy party_players_read on public.party_players for select to anon, authenticated, service_role using (true);
create policy party_categories_read on public.party_categories for select to anon, authenticated, service_role using (true);
create policy party_answers_read on public.party_answers for select to anon, authenticated, service_role using (true);
-- No policies on party_tokens, party_room_codes, party_network_hits: nobody but the owner sees them.

-- Realtime (Postgres Changes, filtered by room: id=eq.<room> on party_rooms, room_id=eq.<room> on the others).
-- Default replica identity is enough: inserts and updates carry the whole new row. Deletes under RLS carry only the
-- primary key and can't be filtered, so the functions never delete these rows during play (leaving marks a player
-- gone; a new game uses a new game_no); rows are deleted only with the whole room by the idle clean-up.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.party_rooms, public.party_players, public.party_categories, public.party_answers;
  else
    raise notice 'supabase_realtime publication missing; add the party tables to it by hand';
  end if;
end;
$$;

-- ------------------------------------------------------------- helpers ----
-- Internal helpers (party__*): no grants. They run as the owner because only the security definer functions call them.

create function public.party__grace() returns interval
language sql immutable set search_path = public, pg_temp
as $$ select interval '300 milliseconds' $$;

create function public.party__drop_after() returns interval
language sql immutable set search_path = public, pg_temp
as $$ select interval '60 seconds' $$;

create function public.party__err(p_code text) returns jsonb
language sql immutable set search_path = public, pg_temp
as $$ select jsonb_build_object('ok', false, 'error', p_code) $$;

create function public.party__hash(p_token text) returns text
language sql immutable set search_path = public, pg_temp
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

-- 64 hex characters from two v4 UUIDs (pg_strong_random): 244 random bits.
create function public.party__new_token() returns text
language sql volatile set search_path = public, pg_temp
as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

-- 20 letters: no vowels (so codes can't spell words) and no L (reads like 1). 20^4 = 160,000 codes.
create function public.party__random_code() returns text
language sql volatile set search_path = public, pg_temp
as $$
  select string_agg(substr('BCDFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 20)::int, 1), '')
  from generate_series(1, 4)
$$;

-- Trim and collapse spaces; null if the result isn't 1-12 ASCII letters/digits with single spaces.
create function public.party__clean_nickname(p_nickname text) returns text
language sql immutable set search_path = public, pg_temp
as $$
  select case when n ~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' and char_length(n) <= 12 then n end
  from (select regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g') as n) x
$$;

-- "Ash", then "Ash 2", "Ash 3"... (case-insensitive, among everyone who was ever in the room).
create function public.party__unique_nickname(p_room_id uuid, p_nickname text) returns text
language plpgsql stable set search_path = public, pg_temp
as $$
declare
  v_name text := p_nickname;
  v_n int := 1;
begin
  while exists (select 1 from public.party_players where room_id = p_room_id and lower(nickname) = lower(v_name)) loop
    v_n := v_n + 1;
    v_name := rtrim(left(p_nickname, 12 - char_length(' ' || v_n))) || ' ' || v_n;
  end loop;
  return v_name;
end;
$$;

-- A random starter Pokémon (National Dex number), preferring one nobody present in the room has.
create function public.party__pick_icon(p_room_id uuid) returns int
language sql volatile set search_path = public, pg_temp
as $$
  with starters(dex) as (
    select unnest(array[1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656,
                        722, 725, 728, 810, 813, 816, 906, 909, 912])
  )
  select dex from starters s
  order by exists (select 1 from public.party_players p where p.room_id = p_room_id and p.gone_at is null and p.icon = s.dex),
           random()
  limit 1
$$;

-- The player (any state) whose token matches, optionally required to be in p_room_id. Null if not.
create function public.party__auth(p_room_id uuid, p_player_id uuid, p_token text) returns public.party_players
language sql stable set search_path = public, pg_temp
as $$
  select p.* from public.party_players p
  join public.party_tokens t on t.player_id = p.id
  where p.id = p_player_id
    and (p_room_id is null or p.room_id = p_room_id)
    and p_token ~ '^[0-9a-f]{64}$'
    and t.token_hash = public.party__hash(p_token)
$$;

-- Players still in the turn order: seated, not out, not gone.
create function public.party__active_count(p_room_id uuid) returns int
language sql stable set search_path = public, pg_temp
as $$
  select count(*)::int from public.party_players
  where room_id = p_room_id and seat is not null and not is_out and gone_at is null
$$;

-- The next player in the turn order after seat p_after_seat (wrapping round). Null if nobody is left.
create function public.party__next_active(p_room_id uuid, p_after_seat int) returns uuid
language sql stable set search_path = public, pg_temp
as $$
  select id from public.party_players
  where room_id = p_room_id and seat is not null and not is_out and gone_at is null
  order by (seat <= p_after_seat), seat
  limit 1
$$;

-- The deck entry for a round: rounds past the end of the deck replay its last (up to) 10 entries in a loop.
create function public.party__deck_no(p_deck_size int, p_round int) returns int
language sql immutable set search_path = public, pg_temp
as $$
  select case
    when p_round <= p_deck_size then p_round
    else p_deck_size - least(p_deck_size, 10) + 1 + ((p_round - p_deck_size - 1) % least(p_deck_size, 10))
  end
$$;

-- Starts round p_round with p_starter's turn. The room must be locked by the caller.
create function public.party__begin_round(p_room_id uuid, p_round int, p_starter uuid) returns void
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_game int;
  v_size int;
  v_deck_no int;
  v_seconds smallint;
begin
  select game_no into v_game from public.party_rooms where id = p_room_id;
  select count(*) into v_size from public.party_categories where room_id = p_room_id and game_no = v_game;
  v_deck_no := public.party__deck_no(v_size, p_round);
  select seconds into v_seconds from public.party_categories
  where room_id = p_room_id and game_no = v_game and deck_no = v_deck_no;

  update public.party_rooms set
    round = p_round,
    category_no = v_deck_no,
    turn_player_id = p_starter,
    turn_no = turn_no + 1,
    turn_seconds = v_seconds,
    turn_started_at = now(),
    deadline = now() + make_interval(secs => v_seconds),
    last_activity = now()
  where id = p_room_id;
end;
$$;

-- Passes the turn within the round. The room must be locked by the caller.
create function public.party__next_turn(p_room_id uuid, p_player uuid) returns void
language sql set search_path = public, pg_temp
as $$
  update public.party_rooms set
    turn_player_id = p_player,
    turn_no = turn_no + 1,
    turn_started_at = now(),
    deadline = now() + make_interval(secs => turn_seconds),
    last_activity = now()
  where id = p_room_id
$$;

-- Ends the game: the one player left in the turn order wins (null if none is left).
create function public.party__finish(p_room_id uuid, p_event jsonb) returns uuid
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_winner uuid;
begin
  select id into v_winner from public.party_players
  where room_id = p_room_id and seat is not null and not is_out and gone_at is null
  order by seat limit 1;

  update public.party_rooms set
    status = 'over',
    winner_id = v_winner,
    turn_player_id = null,
    deadline = null,
    turn_started_at = null,
    last_event = p_event || jsonb_build_object('over', true, 'winner_id', v_winner),
    last_activity = now()
  where id = p_room_id;
  return v_winner;
end;
$$;

-- p_player failed the current turn (time ran out, or they dropped/left on their turn): they lose a life (out at 0),
-- the round ends, and a new round starts with them, or with the next living player if they are out or gone.
-- The game ends when one player (or none) is left. The room must be locked and playing.
create function public.party__fail(p_room_id uuid, p_player uuid) returns jsonb
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
    'lives', v_p.lives, 'out', v_p.is_out, 'deck_no', v_room.category_no);

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

-- Times out the current turn if the server clock is past deadline + grace (and, if given, the turn number matches).
-- The room must be locked. Returns {"acted": false} or {"acted": true, ...the timeout event}.
create function public.party__timeout_locked(p_room_id uuid, p_turn_no bigint) returns jsonb
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
begin
  select * into v_room from public.party_rooms where id = p_room_id;
  if not found or v_room.status <> 'playing'
     or now() <= v_room.deadline + public.party__grace()
     or (p_turn_no is not null and p_turn_no <> v_room.turn_no) then
    return jsonb_build_object('ok', true, 'acted', false);
  end if;
  return jsonb_build_object('ok', true, 'acted', true) || public.party__fail(p_room_id, v_room.turn_player_id);
end;
$$;

-- Host passes to the longest-joined player still present, if the host is gone or missing.
create function public.party__pass_host(p_room_id uuid) returns void
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_new uuid;
begin
  if exists (
    select 1 from public.party_rooms r join public.party_players h on h.id = r.host_id
    where r.id = p_room_id and h.gone_at is null
  ) then
    return;
  end if;
  select id into v_new from public.party_players
  where room_id = p_room_id and gone_at is null
  order by joined_at, id limit 1;
  if v_new is not null then
    update public.party_rooms set host_id = v_new where id = p_room_id;
  end if;
end;
$$;

-- Marks p_player gone (left / removed / dropped) and takes them out of the turn order. On their turn that is a
-- failed turn (closing the tab never dodges a failure); otherwise the game ends if only one player is left.
-- The room must be locked by the caller. Does nothing if the player is already gone.
create function public.party__remove_from_order(p_room_id uuid, p_player uuid, p_reason text) returns void
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
  v_p public.party_players;
  v_event jsonb;
begin
  select * into v_room from public.party_rooms where id = p_room_id;
  select * into v_p from public.party_players where id = p_player and room_id = p_room_id;
  if not found or v_p.gone_at is not null then
    return;
  end if;

  update public.party_players set gone_at = now(), gone_reason = p_reason where id = p_player;

  if v_room.status = 'playing' and v_p.seat is not null and not v_p.is_out then
    if v_room.turn_player_id = p_player then
      perform public.party__fail(p_room_id, p_player);
    else
      v_event := jsonb_build_object('kind', 'gone', 'round', v_room.round, 'player_id', p_player, 'reason', p_reason);
      if public.party__active_count(p_room_id) <= 1 then
        perform public.party__finish(p_room_id, v_event);
      else
        update public.party_rooms set last_event = v_event, last_activity = now() where id = p_room_id;
      end if;
    end if;
  end if;

  perform public.party__pass_host(p_room_id);
end;
$$;

create function public.party__valid_deck_entry(e jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(e) is distinct from 'object' then return false; end if;
  if jsonb_typeof(e->'parts') is distinct from 'array' then return false; end if;
  if jsonb_array_length(e->'parts') not between 1 and 3 then return false; end if;
  if coalesce(e->>'tier', '') not in ('easy', 'medium', 'hard', 'expert') then return false; end if;
  if jsonb_typeof(e->'pool') is distinct from 'number' or (e->>'pool') !~ '^[0-9]{1,6}$' then return false; end if;
  if (e->>'pool')::int < 1 then return false; end if;
  if jsonb_typeof(e->'seconds') is distinct from 'number' or (e->>'seconds') !~ '^[0-9]{1,3}$' then return false; end if;
  if (e->>'seconds')::int not between 3 and 120 then return false; end if;
  return true;
end;
$$;

create function public.party__player_json(p public.party_players, p_code text, p_token text) returns jsonb
language sql stable set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'room_id', p.room_id, 'code', p_code, 'player_id', p.id, 'token', p_token,
    'nickname', p.nickname, 'icon', p.icon,
    'status', (select status from public.party_rooms where id = p.room_id)))
$$;

-- ----------------------------------------------------- service functions ----

-- Hosts a new room. Returns {ok, room_id, code, player_id, token, nickname, icon, status}.
create function public.party_create(p_nickname text, p_lives int default 3, p_start_tier text default 'easy')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_nick text := public.party__clean_nickname(p_nickname);
  v_room uuid := gen_random_uuid();
  v_code text;
  v_token text := public.party__new_token();
  v_p public.party_players;
  i int;
begin
  if v_nick is null then return public.party__err('bad_nickname'); end if;
  if p_lives is null or p_lives not between 1 and 5
     or coalesce(p_start_tier, '') not in ('easy', 'medium', 'hard', 'expert') then
    return public.party__err('bad_settings');
  end if;

  insert into public.party_rooms (id, lives, start_tier) values (v_room, p_lives, p_start_tier);
  for i in 1..50 loop
    v_code := public.party__random_code();
    insert into public.party_room_codes (code, room_id) values (v_code, v_room) on conflict do nothing;
    exit when found;
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'party: no free room code' using errcode = 'P0001';
  end if;

  insert into public.party_players (room_id, nickname, icon, lives)
  values (v_room, v_nick, public.party__pick_icon(v_room), p_lives)
  returning * into v_p;
  insert into public.party_tokens (player_id, token_hash) values (v_p.id, public.party__hash(v_token));
  update public.party_rooms set host_id = v_p.id where id = v_room;

  return public.party__player_json(v_p, v_code, v_token);
end;
$$;

-- Joins by code (case-insensitive). During a game the new player watches until the next one.
-- Returns {ok, room_id, code, player_id, token, nickname, icon, status} or an error: no_room, bad_nickname, room_full.
create function public.party_join(p_code text, p_nickname text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_nick text := public.party__clean_nickname(p_nickname);
  v_room public.party_rooms;
  v_token text := public.party__new_token();
  v_p public.party_players;
begin
  select r.* into v_room from public.party_room_codes c join public.party_rooms r on r.id = c.room_id
  where c.code = v_code
  for update of r;
  if not found then return public.party__err('no_room'); end if;
  if v_nick is null then return public.party__err('bad_nickname'); end if;
  if (select count(*) from public.party_players where room_id = v_room.id and gone_at is null) >= 8 then
    return public.party__err('room_full');
  end if;

  insert into public.party_players (room_id, nickname, icon, lives)
  values (v_room.id, public.party__unique_nickname(v_room.id, v_nick), public.party__pick_icon(v_room.id), v_room.lives)
  returning * into v_p;
  insert into public.party_tokens (player_id, token_hash) values (v_p.id, public.party__hash(v_token));
  perform public.party__pass_host(v_room.id);
  update public.party_rooms set last_activity = now() where id = v_room.id;

  return public.party__player_json(v_p, v_code, v_token);
end;
$$;

-- Comes back after a reload with the stored player id and token. Counts as a heartbeat.
-- Returns {ok, room_id, code, player_id, nickname, icon, status} (no token) or bad_token.
create function public.party_rejoin(p_player_id uuid, p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_beat jsonb := public.party_heartbeat(p_player_id, p_token);
  v_p public.party_players;
begin
  if not (v_beat->>'ok')::boolean then return v_beat; end if;
  select * into v_p from public.party_players where id = p_player_id;
  return public.party__player_json(v_p, (select code from public.party_room_codes where room_id = v_p.room_id), null)
    || jsonb_build_object('server_time', v_beat->'server_time');
end;
$$;

-- Host only, lobby only. Returns {ok} or bad_token, not_host, not_lobby, bad_settings.
create function public.party_settings(p_room_id uuid, p_player_id uuid, p_token text, p_lives int, p_start_tier text)
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
  update public.party_rooms set lives = p_lives, start_tier = p_start_tier, last_activity = now() where id = p_room_id;
  update public.party_players set lives = p_lives where room_id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Host only, from the lobby. p_deck is the dealt deck, round 1 first: [{parts, tier, pool, seconds}, ...]
-- (1 to 200 entries). Seats up to 8 present players (longest-joined first) in a shuffled order; seat 0 starts.
-- Returns {ok, game_no, players} or bad_token, not_host, not_lobby, too_few_players, bad_deck.
create function public.party_start(p_room_id uuid, p_player_id uuid, p_token text, p_deck jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
  v_me public.party_players;
  v_game int;
  v_count int;
  v_starter uuid;
begin
  select * into v_room from public.party_rooms where id = p_room_id for update;
  if not found then return public.party__err('no_room'); end if;
  v_me := public.party__auth(p_room_id, p_player_id, p_token);
  if v_me.id is null or v_me.gone_at is not null then return public.party__err('bad_token'); end if;
  if v_room.host_id is distinct from v_me.id then return public.party__err('not_host'); end if;
  if v_room.status <> 'lobby' then return public.party__err('not_lobby'); end if;
  if jsonb_typeof(p_deck) is distinct from 'array' or jsonb_array_length(p_deck) not between 1 and 200
     or exists (select 1 from jsonb_array_elements(p_deck) e where not public.party__valid_deck_entry(e)) then
    return public.party__err('bad_deck');
  end if;

  select count(*) into v_count from public.party_players where room_id = p_room_id and gone_at is null;
  if v_count < 2 then return public.party__err('too_few_players'); end if;

  v_game := v_room.game_no + 1;
  insert into public.party_categories (room_id, game_no, deck_no, parts, tier, pool, seconds)
  select p_room_id, v_game, n::int, e->'parts', e->>'tier', (e->>'pool')::int, (e->>'seconds')::smallint
  from jsonb_array_elements(p_deck) with ordinality as d(e, n);

  update public.party_players set seat = null, lives = v_room.lives, is_out = false, answers_given = 0
  where room_id = p_room_id;
  with chosen as (
    select id from public.party_players where room_id = p_room_id and gone_at is null
    order by joined_at, id limit 8
  ), shuffled as (
    select id, (row_number() over (order by random()) - 1)::smallint as s from chosen
  )
  update public.party_players p set seat = shuffled.s from shuffled where p.id = shuffled.id;

  select id into v_starter from public.party_players where room_id = p_room_id and seat = 0;
  update public.party_rooms set game_no = v_game, winner_id = null where id = p_room_id;
  perform public.party__begin_round(p_room_id, 1, v_starter);
  update public.party_rooms set status = 'playing', last_event = jsonb_build_object('kind', 'start', 'round', 1)
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'game_no', v_game, 'players', least(v_count, 8));
end;
$$;

-- Records an answer the Edge Function has ALREADY checked with the category engine (fits every part). SQL re-checks
-- the token, the turn, the deadline (server clock, 300 ms grace) and that the species is unused this round.
-- p_pool_exhausted = true when no unused species fits after this answer: the round then counts as cleared.
-- Returns {ok, result: 'passed' | 'cleared', round, turn_player_id, deadline, turn_no}
-- or bad_token, not_playing, not_your_turn, already_used, bad_answer, or too_late (the turn is then timed out at once
-- and the reply carries the timeout event under "timeout").
create function public.party_apply_answer(
  p_room_id uuid, p_player_id uuid, p_token text, p_pokemon_id int, p_species int, p_pool_exhausted boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_room public.party_rooms;
  v_me public.party_players;
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
    values (p_room_id, v_room.game_no, v_room.round, v_me.id, p_pokemon_id, p_species);
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
    'turn_player_id', v_room.turn_player_id, 'deadline', v_room.deadline, 'turn_no', v_room.turn_no);
end;
$$;

-- Leaves the room. In a game the player stays on the result screen but leaves the turn order (on their turn that
-- costs the life). Their token stops working. Returns {ok} or bad_token.
create function public.party_leave(p_room_id uuid, p_player_id uuid, p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me public.party_players;
begin
  perform 1 from public.party_rooms where id = p_room_id for update;
  if not found then return public.party__err('no_room'); end if;
  v_me := public.party__auth(p_room_id, p_player_id, p_token);
  if v_me.id is null then return public.party__err('bad_token'); end if;
  perform public.party__remove_from_order(p_room_id, v_me.id, 'left');
  delete from public.party_tokens where player_id = v_me.id;
  update public.party_rooms set last_activity = now() where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Host removes another player (lobby or game); like leaving, and their token stops working.
-- Returns {ok} or bad_token, not_host, no_player.
create function public.party_remove(p_room_id uuid, p_player_id uuid, p_token text, p_target_id uuid)
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
  if p_target_id is null or p_target_id = v_me.id or not exists (
    select 1 from public.party_players where id = p_target_id and room_id = p_room_id and gone_reason is distinct from 'removed'
  ) then
    return public.party__err('no_player');
  end if;
  perform public.party__remove_from_order(p_room_id, p_target_id, 'removed');
  -- A dropped player being removed is already gone; make it stick.
  update public.party_players set gone_reason = 'removed' where id = p_target_id;
  delete from public.party_tokens where player_id = p_target_id;
  update public.party_rooms set last_activity = now() where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Host only, after a game: back to the lobby with everyone still present (gone players stay gone and are not
-- seated next time). Old categories and answers are kept under the old game_no. Call party_start next.
-- Returns {ok} or bad_token, not_host, not_over.
create function public.party_play_again(p_room_id uuid, p_player_id uuid, p_token text)
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
  if v_room.status <> 'over' then return public.party__err('not_over'); end if;

  update public.party_players set seat = null, lives = v_room.lives, is_out = false, answers_given = 0
  where room_id = p_room_id;
  update public.party_rooms set
    status = 'lobby', round = 0, category_no = null, turn_player_id = null, turn_seconds = null,
    turn_started_at = null, deadline = null, winner_id = null,
    last_event = jsonb_build_object('kind', 'lobby'), last_activity = now()
  where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Per-network cap: records a hit and returns true if p_ip_hash made fewer than p_limit p_action hits in p_window,
-- else returns false and records nothing. p_ip_hash is the Edge Function's salted daily IP hash (64 hex).
create function public.party_network_hit(p_ip_hash text, p_action text, p_limit int, p_window interval)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_action not in ('create', 'join')
     or p_limit is null or p_window is null then
    raise exception 'party_network_hit: bad arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('party_network_hit:' || p_ip_hash, 0));
  if (select count(*) from public.party_network_hits
      where ip_hash = p_ip_hash and action = p_action and at > now() - p_window) >= p_limit then
    return false;
  end if;
  insert into public.party_network_hits (ip_hash, action) values (p_ip_hash, p_action);
  return true;
end;
$$;

-- ---------------------------------------------------------- anon functions ----

-- Called by every client when its countdown hits zero (and by the cron sweep). Idempotent: does nothing unless
-- the server clock is past the current turn's deadline + 300 ms grace; then the turn player loses a life once.
-- p_turn_no (optional) limits it to that turn. Returns {ok, acted: false} or
-- {ok, acted: true, kind: 'timeout', round, player_id, lives, out, deck_no[, over, winner_id]}.
create function public.party_timeout(p_room_id uuid, p_turn_no bigint default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- Cheap unlocked check first: most calls arrive early or after another client already acted.
  if not exists (select 1 from public.party_rooms where id = p_room_id and status = 'playing'
                 and now() > deadline + public.party__grace()) then
    return jsonb_build_object('ok', true, 'acted', false);
  end if;
  perform 1 from public.party_rooms where id = p_room_id for update;
  return public.party__timeout_locked(p_room_id, p_turn_no);
end;
$$;

-- Every 4 s from each client in a room. Updates last_seen (a player not seen for 60 s is dropped). A dropped player
-- who comes back is present again unless they were in the turn order of a game still running.
-- Returns {ok: true, server_time (epoch ms), present} or {ok: false, error: 'bad_token'}.
create function public.party_heartbeat(p_player_id uuid, p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_p public.party_players;
begin
  v_p := public.party__auth(null, p_player_id, p_token);
  if v_p.id is null then return public.party__err('bad_token'); end if;

  -- Same lock order as the room functions (room row first, then player/token rows), so a comeback can't deadlock
  -- with party_leave / party_remove / the sweep. The common case (not dropped) takes no room lock.
  if v_p.gone_reason = 'dropped' then
    perform 1 from public.party_rooms where id = v_p.room_id for update;
  end if;
  update public.party_tokens set last_seen = now() where player_id = p_player_id;
  if not found then return public.party__err('bad_token'); end if;  -- token deleted meanwhile (left / removed)

  if v_p.gone_reason = 'dropped' then
    select * into v_p from public.party_players where id = p_player_id;
    if v_p.gone_reason = 'dropped' and (
      v_p.seat is null or (select status from public.party_rooms where id = v_p.room_id) <> 'playing'
    ) then
      update public.party_players set gone_at = null, gone_reason = null where id = p_player_id
      returning * into v_p;
      perform public.party__pass_host(v_p.room_id);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'server_time', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'present', v_p.gone_at is null);
end;
$$;

-- ------------------------------------------------------------ cron jobs ----

-- Every second: time out turns past deadline + grace, and drop players not seen for 60 s. Skips rooms another
-- transaction holds (a client's call), since they'll be looked at again next second. Returns rooms touched.
create function public.party_sweep()
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_p record;
  v_n int := 0;
begin
  for v_id in
    select id from public.party_rooms
    where status = 'playing' and deadline < now() - public.party__grace()
    for update skip locked
  loop
    perform public.party__timeout_locked(v_id, null);
    v_n := v_n + 1;
  end loop;

  for v_p in
    select p.id, p.room_id from public.party_players p
    join public.party_tokens t on t.player_id = p.id
    where p.gone_at is null and t.last_seen < now() - public.party__drop_after()
  loop
    perform 1 from public.party_rooms where id = v_p.room_id for update skip locked;
    continue when not found;
    if exists (select 1 from public.party_players p join public.party_tokens t on t.player_id = p.id
               where p.id = v_p.id and p.gone_at is null and t.last_seen < now() - public.party__drop_after()) then
      perform public.party__remove_from_order(v_p.room_id, v_p.id, 'dropped');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Hourly: delete rooms with no action and no heartbeat for p_idle, old network hits, and the sweep's cron log.
create function public.party_cleanup(p_idle interval default interval '2 hours')
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  delete from public.party_rooms r
  where r.last_activity < now() - p_idle
    and not exists (select 1 from public.party_players p join public.party_tokens t on t.player_id = p.id
                    where p.room_id = r.id and t.last_seen >= now() - p_idle);
  get diagnostics v_n = row_count;

  delete from public.party_network_hits where at < now() - interval '1 day';

  -- The every-second job would add 86,400 log rows a day; keep one hour of them.
  begin
    delete from cron.job_run_details
    where jobid in (select jobid from cron.job where jobname = 'party-sweep') and end_time < now() - interval '1 hour';
  exception when others then
    raise notice 'party_cleanup: could not trim cron.job_run_details (%)', sqlerrm;
  end;
  return v_n;
end;
$$;

-- ----------------------------------------------------------------- grants ----
-- Supabase grants execute on new functions to anon/authenticated/service_role by default: take it all back first.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'party\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end;
$$;

grant execute on function
  public.party_create(text, int, text),
  public.party_join(text, text),
  public.party_rejoin(uuid, text),
  public.party_settings(uuid, uuid, text, int, text),
  public.party_start(uuid, uuid, text, jsonb),
  public.party_apply_answer(uuid, uuid, text, int, int, boolean),
  public.party_leave(uuid, uuid, text),
  public.party_remove(uuid, uuid, text, uuid),
  public.party_play_again(uuid, uuid, text),
  public.party_network_hit(text, text, int, interval)
  to service_role;

grant execute on function
  public.party_timeout(uuid, bigint),
  public.party_heartbeat(uuid, text)
  to anon, authenticated, service_role;

-- Schedule the jobs. Unlike the analytics roll-up, Party can't work without the sweep (turns would only end when a
-- client calls party_timeout), so a failure here fails the migration and the deploy goes red instead of leaving the
-- live project without it. cron.schedule upserts by job name, so re-running is safe.
create extension if not exists pg_cron;
select cron.schedule('party-sweep', '1 seconds', 'select public.party_sweep()');
select cron.schedule('party-cleanup', '7 * * * *', 'select public.party_cleanup()');
