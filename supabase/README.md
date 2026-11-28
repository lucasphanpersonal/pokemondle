# Pokedle analytics backend (Supabase)

Anonymous gameplay analytics: one Edge Function (`track`) writing to a locked-down Postgres.
The browser only needs the **function URL**. No keys ship in the client.

Privacy design: the function hashes `salt + IP + user agent` into `visitor_hash` and `salt + IP` into `ip_hash`
(used only for a flood cap), where the salt rotates daily and is deleted after 2 days. The raw IP and UA are never
stored, and `ip_hash` is deleted with the raw events after 6 months. The function never
returns anything about the answer. Raw events are rolled up into `daily_totals` after 6 months.

## One-time setup

1. Create a project at <https://supabase.com/dashboard> (region: US). Note the **project ref**
   (the `abcdxyz` part of `https://abcdxyz.supabase.co`) and set a database password.
2. From the repo root:
   ```sh
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push --remote --yes                    # creates tables, views, functions, cron job
   # Later migrations (e.g. 20261107120000_widen_guess_caps.sql) are applied by the same command.
   npx supabase secrets set ALLOWED_ORIGINS="https://pokemondle.io,https://lucasphanpersonal.github.io"
   npx supabase functions deploy track --no-verify-jwt --yes
   npx supabase functions deploy stats --no-verify-jwt --yes   # public daily stats for the result screen
   ```
   Set `ALLOWED_ORIGINS` **before** deploying. Secrets take effect on the function's next start, so
   if you change them later, redeploy the function.
   `verify_jwt = false` for both `track` and `stats` is set in `supabase/config.toml`, so the CLI keeps JWT
   verification off even without the flag. The `--no-verify-jwt` flags are kept as a double check, because
   browsers call these functions without a Supabase token.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically.
3. The function URL is `https://<project-ref>.supabase.co/functions/v1/track`. That is the only
   value the client will need (e.g. as `VITE_TRACK_URL`). Party mode also needs `VITE_SUPABASE_URL`
   (the project URL) and `VITE_SUPABASE_ANON_KEY` (the publishable key from Project Settings → API Keys);
   both are public and go in `.env.production` (filled in) and `.env.example` (left empty, so a local build shows Party as unavailable until you copy them).

Quick smoke test (should print `204`):
```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<project-ref>.supabase.co/functions/v1/track" \
  -H "Origin: https://pokemondle.io" -H "Content-Type: text/plain" \
  -d '{"events":[{"event":"game_started","game_id":"3fa85b3a-8158-46e3-8e84-af7319e0d0a4","mode":"endless","target_id":25,"device":"desktop"}]}'
```
Delete test rows afterwards: `delete from events where game_id = '3fa85b3a-8158-46e3-8e84-af7319e0d0a4';`

## Automatic deploys (GitHub Actions)

`.github/workflows/supabase-deploy.yml` runs when a change under `supabase/` is merged to `main` (or by hand from the
Actions tab, main branch only; edits to the workflow file also trigger it). It links the project, runs `supabase db push --remote --yes`, then deploys `track`, `stats` and `party` with
`--no-verify-jwt`. It also sets `ALLOWED_ORIGINS` on every run from the list in the workflow's `env`, so change the list there: a value set by hand is overwritten by the next run. Other function secrets are not touched.

The Supabase CLI version in the workflow is pinned (currently `3.1.0`), so a new CLI release never runs with the
database secrets before someone has looked at it. Dependabot (`.github/dependabot.yml`) opens weekly PRs for npm
packages and GitHub Actions, but not for this pin: bump it by hand.

One-time setup, in the repo under **Settings > Secrets and variables > Actions > New repository secret**:

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | <https://supabase.com/dashboard/account/tokens> > Generate new token |
| `SUPABASE_DB_PASSWORD` | The database password chosen when the project was created (reset under **Project Settings > Database** if lost) |

The project ref is in the workflow file because it is public (it is in the function URL). Never commit either secret.
If a secret is missing the job fails with a clear message. Manual deploys from a PC (commands above) still work.

## Security model

- The `Origin` check against `ALLOWED_ORIGINS` is CORS hygiene, **not access control**: any
  non-browser client can forge an `Origin` header.
- The real defences are strict field validation (allow-list, ranges, max 60 events per batch) and a
  per-visitor rate limit (5000 events per UTC day by default, 429 beyond that) plus a per-IP limit (20000 per UTC day);
  see Maintenance.
- A "visitor" is a hash of IP + user agent, so players sharing one Wi-Fi network and browser count as one
  visitor: daily player counts undercount them and they share one rate-limit budget (hence the generous default).
  Fixing that would need a stored device ID, which the project deliberately avoids (no cookies, no consent banner).
- Rotating the User-Agent changes `visitor_hash` and so gets a fresh per-visitor budget, which is why the second cap
  is keyed on the IP alone (`events.ip_hash`, a salted hash, never the raw IP). Someone with many IPs can still
  flood; that is acceptable for analytics: the worst case is some noisy rows, and the tables are write-only
  for the function and unreadable by the browser. The public stats are protected separately (one finished game per
  network per UTC day, see below).
- Retried or duplicate events are ignored (unique on `game_id, event, guess_number`).
- If no client IP is available the request is hashed with a random value, `ip_hash` is null, and it is not rate limited.
- `events.ip_hash` (nullable, 64 hex chars) is the salted IP-only hash; it is never selected by the views or roll-up.

## Reading the data

Open **Dashboard > SQL Editor** and run, for example:

```sql
select * from daily_players order by day desc limit 30;      -- unique players per day and mode
select * from daily_puzzle_stats order by puzzle_date desc;  -- solve rate / avg guesses per puzzle
select * from guess_histogram order by mode, guess_count;    -- guesses-to-win distribution
select * from top_guesses;                                   -- 50 most common guesses
select * from top_first_guesses;                             -- 50 most common opening guesses
select * from mode_split;                                    -- daily vs endless
select * from streak_share order by day desc;                -- share of finishers with streak >= 2
select * from daily_totals order by day desc;                -- rolled-up history (older than 6 months)
```
Use the editor's **Save** to keep them as saved queries. The views are not readable with the anon key.

For ready-made, commented queries (today's players/wins/losses, last 30 days, guess distribution, most-guessed and hardest Pokémon, devices)
see [queries/stats.sql](queries/stats.sql). Paste one query at a time into the SQL Editor and **Save** it. They are read-only `SELECT`s, with days in America/New_York.
`target_id` and `guess_id` are National Dex numbers.

The `stats` function (`GET /functions/v1/stats?date=YYYY-MM-DD`, same `ALLOWED_ORIGINS` as `track`) serves this
to the game with a 60 s cache. `select public_daily_stats(current_date);` is the only thing the anon role may call: aggregates
for one daily puzzle (games finished, wins, solve rate, guess histogram, and `hinted`: finished games whose events carry
`config.hint_used = true`), never the target or per-player data. Since migration `20261113220000_public_stats_hint.sql`
every Daily counts together (the old Hard mode split and its `?hard=1` parameter are gone; old `config.hard_mode` games
count as games without the hint), and there is no minimum: totals are returned from the first finished game, so the
result screen can always show them. To split by hint in your own queries, filter on `config->>'hint_used'`.
Each network counts at most once per puzzle date, keyed on `ip_hash` (falling back to `visitor_hash` for older
rows) and taking the earliest finish by `received_at`, then `id`. Rotating the User-Agent therefore doesn't add fake finishes;
only many IPs would. Because the hashes rotate with the UTC-day salt, a player whose finishes land on two UTC days can count
twice, and players sharing one network (home Wi-Fi, a school) count as one. It returns zero counts, a null solve rate and an empty histogram when no game has finished, and errors for dates older
than 400 days or more than 1 day ahead.

## Maintenance

- **WARNING: enable pg_cron.** The 6-month roll-up/deletion of raw events depends on it. Without it,
  raw events are kept forever until you run `select public.rollup_old_events();` yourself. (Old daily
  salts are deleted by the function itself, so hash unlinkability does not depend on pg_cron.)
- `rollup_old_events()` runs daily at 03:15 UTC via pg_cron. If the migration printed a notice that
  pg_cron was unavailable, enable it under **Database > Extensions** and run
  `select cron.schedule('pokedle-rollup', '15 3 * * *', 'select public.rollup_old_events()');`
- Logs: **Edge Functions > track > Logs**.
- Rate limit: 5000 events per visitor per UTC day by default (HTTP 429 beyond that; it was 300, which cut off heavy
  Endless players). Change it without a code change: `npx supabase secrets set MAX_EVENTS_PER_VISITOR_PER_DAY=<n>`
  (picked up on the next cold start, or redeploy). Rejections are logged as `rate_limited` in Edge Functions > track > Logs.
- Per-IP rate limit: 20000 events per IP (salted hash) per UTC day by default, so a school or office behind one IP still
  fits. Override with `npx supabase secrets set MAX_EVENTS_PER_IP_PER_DAY=<n>`. Rejections are logged as `rate_limited_ip`.
- Tests for the validation logic: `npm test`.

## Shared Party engine (`_shared/party`)

`supabase/functions/_shared/party/` is a generated copy of the browser's Party category engine (`src/lib/party/categories.ts`,
its types, `src/config/partyConfig.ts`, `src/types/pokemon.ts` and `src/lib/rng.ts`, flattened into one folder with their imports
rewritten) plus `pokemon.json`, a dataset with only the fields the engine reads. Every generated `.ts` file starts with
"Generated by npm run party:sync from src/ — do not edit". Regenerate with `npm run party:sync` after changing any of those sources.
`src/lib/party/sharedDrift.test.ts` (part of `npm test`) fails if a copy differs from what the script would write, and
`npm run build` type-checks the folder through `tsconfig.supabase.json` (Deno-style imports with `.ts` extensions).

## Party backend (spike results)

Measured in a throwaway CI job on a local Supabase stack (CLI 3.1.0, Postgres 17.11, Realtime v2.154.0) before the Party mode was built.
The spike objects are gone; the numbers are kept here. Local numbers have no internet round trip, so add roughly 50 to 150 ms
for a browser talking to the hosted project.

- **pg_cron every second: works.** `cron.schedule('x', '1 seconds', ...)` ran 61 times in 62 s, all `succeeded`. Gap between runs:
  mean 1005 ms, min 1004, p95 1006, max 1007 (worst deviation from 1000 ms: 7 ms). pg_cron 1.6.4 locally; Supabase's docs say
  the hosted version is 1.6.4 too. The docs also advise at most 8 concurrent jobs (hard limit 32), and jobs under 10 minutes. The
  once-a-second timeout job is one cheap job, so it is well inside that. Not measured on the hosted project (not allowed from a PR).
- **Postgres Changes to an anon client: works, fast enough.** A table with row-level security on and a select-only policy for
  `anon` streamed all 50 of 50 inserts (made with the service role, as the Edge Function will) to a supabase-js client using only the
  anon key. Insert to receive: p50 255 ms, p95 486 ms, max 515 ms, min 19 ms (mean 259 ms). **That is comfortably fast enough for a 12 s turn**
  (worst case about 4% of it), so Party stays on Supabase and does not need Durable Objects. The anon client could read (3 rows
  returned) but its insert was refused (401, code 42501, row-level security), and its update and delete changed 0 rows.
  Remember to add each Party table to the `supabase_realtime` publication and grant `select` to `anon`.
- **Edge Function importing from `supabase/functions/_shared/`: works.** `supabase functions serve` served a function that does
  `import { hello } from '../_shared/hello.ts'` and curl returned `hello party from _shared`. `_shared` is not a function, so
  the deploy action's by-name `functions deploy` never deploys it on its own. The CLI deploy bundles a function's imports,
  including relative files outside its folder (Supabase's docs: shared code lives in an underscore-prefixed folder; `deploy` has
  `--use-api` for server-side bundling and no Docker). The deploy itself was not run, since a PR must not touch the live project:
  the first Party function that imports `_shared` proves it for real on merge, and `supabase functions serve` in CI is the guard before that.
- **Free-plan Realtime limits** (Supabase docs, Nov 2026): 200 concurrent connections, 100 messages per second, 100 channel joins per second,
  100 channels per connection, 2 million messages a month, and a Postgres Changes payload up to 1,024 KB. Postgres Changes messages are counted
  once per client listening to each change (5 listeners, 1 change = 5 messages). There is no overage charge on Free; the Pro plan starts at $25 a month.

### CI: local Supabase and SQL tests

`.github/workflows/supabase-test.yml` runs only when something under `supabase/` changes: it starts a local stack
(`supabase start`, CLI pinned like the deploy workflow) and runs `supabase test db`, which executes the pgTAP files in
`supabase/tests/database/`. Add new SQL tests there (`*.test.sql`). `00_setup.test.sql` checks that the migrations applied and the
pg_cron jobs are scheduled; `10_party.test.sql` covers the Party turn rules (below). Run the same thing locally with Docker:
`npx supabase start` then `npx supabase test db`.

`.github/workflows/party-e2e.yml` runs on every pull request: the same local stack with the Edge Functions served, the
site built against it, and a two-player browser game (`e2e/live/`; see the main README). It forces short turn timers by
updating the dealt deck (`party_categories.seconds`) with `psql` as the local stack's `postgres` user; nothing the site or
the Edge Function can call does that, so it can't happen on the live project.

## Party database

Migration `20261127200000_party.sql`. The SQL functions own the turn rules (whose turn, deadline, lives, round cleared, next
category, winner), so the Edge Function, the clients' timeout calls and the cron job can never disagree. Every change runs in one
transaction that locks the room row (`select ... for update`).

### Tables

| Table | Holds | anon / browsers |
| --- | --- | --- |
| `party_rooms` | `id`, `host_id`, `status` (`lobby`, `playing`, `over`), settings `lives` (1-5) and `start_tier`, `game_no` (1 for the first game), `round` (1-based, 0 in the lobby), `category_no` (the `party_categories.deck_no` this round plays), `turn_player_id`, `turn_no` (+1 on every turn), `turn_seconds`, `turn_started_at`, `deadline`, `winner_id`, `last_event`, `last_activity` | select + Realtime |
| `party_players` | `id`, `room_id`, `nickname`, `icon` (a starter's dex number), `joined_at`, `seat` (0-7 turn order; null = watching or lobby), `lives`, `is_out`, `answers_given`, `gone_at` / `gone_reason` (`left`, `removed`, `dropped`) | select + Realtime (no token, no last_seen) |
| `party_categories` | the dealt deck: `room_id`, `game_no`, `deck_no` (1 = round 1), `parts` (the engine's `Category` JSON), `tier`, `pool`, `seconds`, `result` (`cleared` / `failed` once its round ends) | select + Realtime |
| `party_answers` | `room_id`, `game_no`, `round`, `player_id`, `pokemon_id`, `species`, `created_at`; unique `(room_id, game_no, round, species)` | select + Realtime |
| `party_tokens` | `player_id`, `token_hash` (sha256 hex), `last_seen` | nothing |
| `party_room_codes` | `code` (4 letters from `BCDFGHJKMNPQRSTVWXYZ`), `room_id` | nothing (so nobody can list open rooms) |
| `party_network_hits` | per-network create/join counts (`ip_hash`, `action`, `at`), kept 1 day | nothing |

Row-level security is on everywhere. anon, authenticated and service_role may only `select` the first four tables; nobody but the
owner can insert, update or delete any table: all writes go through the functions below. A player "in the turn order" means
`seat is not null and not is_out and gone_at is null`.

Realtime: the first four tables are in the `supabase_realtime` publication. Subscribe with `filter: 'id=eq.<room>'` on
`party_rooms` and `filter: 'room_id=eq.<room>'` on the others. Inserts and updates carry the whole row. Deletes under RLS carry only
the primary key and can't be filtered, so the functions never delete these rows during play (leaving marks a player gone, a new game
uses a new `game_no`); the only deletes are whole idle rooms. `last_seen` lives in `party_tokens` so heartbeats send no Realtime
messages. On a `party_rooms` update where `game_no` changed, or status went back to `lobby`, refetch the room's rows.

`last_event` (jsonb) says what just happened, for the banners:
`{"kind":"lobby"}`, `{"kind":"start","round":1}`, `{"kind":"answer","round","player_id","pokemon_id"}`,
`{"kind":"cleared","round","player_id","deck_no","exhausted"}` (`round` is the round that was cleared; `exhausted`: the pool ran out
mid-lap), `{"kind":"timeout","round","player_id","lives","out","deck_no","said"}`, `{"kind":"gone","round","player_id","reason"}`. When the
event ended the game it also has `"over":true,"winner_id"`. "Also fit" for a failed round: the category is the `party_categories` row
with that `deck_no`, the used species are the `said` pokemon ids (that round's `party_answers`, oldest first; added by migration
`20261128120000_party_timeout_said.sql` so every screen excludes the same answers whatever reached it).

### Tokens

Create and join return a random 64-hex-character token **once**. Only `sha256(token)` (hex) is stored, in `party_tokens`. The hashing
is done in SQL (core `sha256()`, no pgcrypto), so the Edge Function and browsers pass the **raw** token to every function and never
hash it themselves. Leaving or being removed deletes the token, so it stops working.

### Functions

All are `security definer` with a fixed `search_path`. They return `jsonb`: `{"ok": true, ...}` on success, or
`{"ok": false, "error": "<code>"}` for a refusal (nothing changed unless stated). Only service_role (the `party` Edge Function)
may call them, except `party_timeout` and `party_heartbeat`, which anon may call. An unknown room id gives `no_room`; a token that
doesn't match the player (or a player not in that room, or already gone where it matters) gives `bad_token`.

| Function | Who | Returns / refusals |
| --- | --- | --- |
| `party_create(p_nickname text, p_lives int = 3, p_start_tier text = 'easy')` | service | `{ok, room_id, code, player_id, token, nickname, icon, status}`; `bad_nickname`, `bad_settings` |
| `party_join(p_code text, p_nickname text)` | service | same shape (nickname made unique: "Ash 2"); `no_room`, `bad_nickname`, `room_full` (8 present). Joining a game in progress watches (`seat` null) until the next game. |
| `party_rejoin(p_player_id uuid, p_token text)` | service | `{ok, room_id, code, player_id, nickname, icon, status, server_time}` (no token); `bad_token`. Counts as a heartbeat. |
| `party_settings(p_room_id, p_player_id, p_token, p_lives int, p_start_tier text)` | service | `{ok}`; `not_host`, `not_lobby`, `bad_settings` |
| `party_start(p_room_id, p_player_id, p_token, p_deck jsonb)` | service | `{ok, game_no, players}`; `not_host`, `not_lobby`, `too_few_players` (< 2 present), `bad_deck` |
| `party_apply_answer(p_room_id, p_player_id, p_token, p_pokemon_id int, p_species int, p_pool_exhausted boolean = false)` | service | `{ok, result: 'passed' or 'cleared', round, turn_player_id, deadline, turn_no}`; `not_playing`, `not_your_turn`, `already_used`, `bad_answer`, `too_late` (see below) |
| `party_leave(p_room_id, p_player_id, p_token)` | service | `{ok}`; `bad_token` |
| `party_remove(p_room_id, p_player_id, p_token, p_target_id uuid)` | service | `{ok}`; `not_host`, `no_player` (unknown, self, or already removed) |
| `party_play_again(p_room_id, p_player_id, p_token)` | service | `{ok}` (room back to `lobby`); `not_host`, `not_over`. Then call `party_start` with a new deck. |
| `party_network_hit(p_ip_hash text, p_action text, p_limit int, p_window interval)` | service | `boolean`: true = under the cap (hit recorded), false = over it. `p_action` is `'create'` or `'join'`. |
| `party_timeout(p_room_id uuid, p_turn_no bigint = null)` | anon | `{ok, acted: false}` or `{ok, acted: true, kind: 'timeout', round, player_id, lives, out, deck_no[, over, winner_id]}` |
| `party_heartbeat(p_player_id uuid, p_token text)` | anon | `{ok, server_time (epoch ms), present}`; `bad_token` |
| `party_sweep()`, `party_cleanup(p_idle interval = '2 hours')` | cron (owner) | rooms/players touched; rooms deleted |

`p_deck` is a JSON array, round 1 first, 1 to 200 entries, each `{"parts": Category, "tier": "easy"|"medium"|"hard"|"expert",
"pool": int >= 1, "seconds": int 3..120}`. The SQL never reads `partyConfig.ts`: a round's seconds come from its deck entry. Rounds
past the end of the deck replay its last 10 entries in a loop.

### The turn rules SQL enforces

- **Start:** up to 8 present players (`gone_at` null, longest-joined first) get shuffled seats 0..n-1 with the room's `lives`; seat 0
  starts round 1 with `deadline = now() + seconds`.
- **Answer:** refused unless the game is playing, it is this player's turn, and `now() <= deadline + 300 ms` (server clock, at the
  start of the transaction). A species already answered this round gives `already_used` (backed by the unique constraint); the turn
  and timer are unchanged. Otherwise the answer is recorded, `answers_given` goes up, and the turn passes to the next player in the
  turn order with a fresh deadline. When everyone in the turn order has answered this round (a full lap), or `p_pool_exhausted` is
  true, the round is **cleared**: no life lost, and the next round starts with the next player after the answerer.
- **Too late:** an answer after `deadline + 300 ms` is refused with `too_late` and the turn is timed out in the same transaction (the
  reply carries the timeout event under `timeout`).
- **Timeout** (`party_timeout`, the cron sweep, or a late answer): does nothing unless `now() > deadline + 300 ms` for the current turn
  (and `p_turn_no` matches, if given), so it acts once per turn however many clients call it. The turn player loses a life (out at
  0), the round ends (deck entry marked `failed`), and the next round starts with the failed player, or with the next player in the
  turn order if they are out or gone. With one player (or none) left in the turn order the game is `over` and `winner_id` is that
  player.
- **Gone:** leaving, being removed, or no heartbeat for 60 s (cron) takes a player out of the turn order for the rest of the game; they
  keep their lives for the result screen. If it was their turn, that counts as a timeout. A dropped player whose heartbeat returns is
  present again in the lobby, while watching, or after the game, but not back in a running game's turn order. When the host is gone
  the host passes to the longest-joined present player.
- **Play again:** everyone still present is reset (lives, out, answers, seat) and the room goes back to the lobby; the next start uses
  a new `game_no`. Gone players stay gone and get no seat.

### pg_cron jobs

- `party-sweep`, every `1 seconds`: `party_sweep()` times out every playing room past `deadline + 300 ms` and drops players not seen
  for 60 s. It skips rooms another transaction holds (`for update skip locked`); the next second picks them up. With no rooms it is
  two index lookups on empty tables.
- `party-cleanup`, hourly at :07: `party_cleanup()` deletes rooms with no action (`last_activity`) and no heartbeat for 2 hours,
  network hits older than a day, and `cron.job_run_details` rows of `party-sweep` older than an hour (otherwise 86,400 log rows a day).
- Unlike the analytics roll-up, scheduling these is not optional: if pg_cron is missing the migration fails, so the Deploy Supabase
  run goes red rather than leaving the live project without a sweep. `cron.schedule` upserts by job name, so re-running is safe.

### Contract for the `party` Edge Function

What the function must do, and what it can rely on SQL for:

1. **Origin, body shape, rate caps.** Check `Origin` against `ALLOWED_ORIGINS` and the JSON shape of each request. Before create
   and join, call `party_network_hit(ipHash, 'create' or 'join', limit, window)` with the salted daily IP hash (as `track` computes
   it: `sha256(salt|ip|<ip>)`) and refuse with 429 when it returns false. SQL re-checks nicknames (trimmed, spaces collapsed, 1 to 12
   ASCII letters, digits and single spaces), but the function should send its own friendly message first.
2. **Tokens.** Pass the raw token from the request straight to the SQL function. Never hash, log or store it. Only create and join
   return a token.
3. **Start.** Read the room (`start_tier`) and count the present players (`gone_at is null`, at most 8), deal with
   `dealDeck(seed, players, dataset, { startTier })`, and send `p_deck = deck.map(e => ({ parts: e.category, tier: e.tier,
   pool: e.pool, seconds: <the tier's seconds from partyConfig> }))` to `party_start`. Host, lobby and player-count checks are SQL's.
4. **Answer.** Read the room (`status`, `game_no`, `round`, `category_no`, `turn_player_id`), the category (`party_categories` where
   `room_id`, `game_no` and `deck_no = category_no`) and the species already used (`party_answers` where `room_id`, `game_no`,
   `round`). Run `checkAnswer(category, pokemon, usedSpecies)`. If it fails, reply with its reason and **do not call SQL** (a wrong
   answer costs time, not a life, and nothing is written). If it fits, compute `p_pool_exhausted` = no unused species fits once this
   one is added (`speciesLeft(...) === 0`), and call `party_apply_answer(room, player, token, pokemon.id, pokemon.dexNumber,
   exhausted)`. SQL then decides the turn, the deadline (with the grace), the "already used" race, lives and rounds, so a stale read
   by the function does no harm.
5. **Errors.** Suggested replies for `{ok:false}` codes: `bad_token` 401; `not_host`, `not_your_turn` 403; `no_room`, `no_player` 404;
   `not_lobby`, `not_playing`, `not_over`, `room_full`, `too_few_players`, `already_used`, `too_late` 409; `bad_nickname`,
   `bad_settings`, `bad_deck`, `bad_answer` 400. A thrown SQL error is a 500.
6. **Not the function's job:** timeouts (clients call `party_timeout` at zero, cron backs them up), heartbeats (clients call
   `party_heartbeat` every 4 s; it returns `server_time` for the clock offset), and Realtime (clients subscribe to the tables).

**For the client (task 6):** a `party_timeout` call made exactly when the countdown hits zero lands inside the 300 ms grace and
returns `acted: false`. That is expected, not an error. Call it again about 400 ms after zero (pass `p_turn_no` so a late retry
can't hit the next turn); the every-second sweep also times the turn out within about 1 s if no client does. Treat the room row
arriving over Realtime as the result, not the call's reply.

## Party Edge Function

`supabase/functions/party/`: `handler.ts` is the pure request handling (unit-tested with a fake database in `handler.test.ts`, run by
`npm test`), `index.ts` wires in the service-role client and `_shared/party/pokemon.json`. `verify_jwt = false` (config.toml, and
`--no-verify-jwt` in the deploy workflow): browsers send no Supabase key; players prove who they are with their own secret token, which SQL checks.
The function's own CI checks are `deno check` of every function and a smoke test (`supabase/tests/functions/party-smoke.mjs`: create, join,
start, answer against `supabase functions serve`) in `.github/workflows/supabase-test.yml`.

**Request.** `POST https://inxvlunfwsssifvjkgtz.supabase.co/functions/v1/party`, `Content-Type: application/json` (or `text/plain`), body at most 4 KB:
`{"action": "<name>", ...fields}`. The `Origin` header must be in `ALLOWED_ORIGINS` (else 403, no CORS headers); `OPTIONS` answers 204.
Unknown fields are ignored. Responses are always JSON with `Cache-Control: no-store`.

**Response.** Every response body has `server_time` (epoch milliseconds, the server's clock when it answered), so a client can estimate
its clock offset (`offset = server_time - (sendTime + receiveTime) / 2`). Success is HTTP 200 with `{"ok": true, ...}`. A refusal is
`{"ok": false, "error": "<code>", ...}` with the status below. `deadline` values are Postgres timestamps (ISO strings); the clock
offset applies to them too.

Field formats (checked before anything else; a bad one is 400 and nothing happens):

| Field | Rule | Error |
| --- | --- | --- |
| `nickname` | trimmed, spaces collapsed, 1 to 12 letters (A-Z, a-z), digits and single spaces | `bad_nickname` |
| `code` | 4 letters from `BCDFGHJKMNPQRSTVWXYZ`, any case | `bad_code` |
| `room_id`, `player_id`, `target_id` | uuid | `bad_room`, `bad_player`, `bad_target` |
| `token` | 64 lowercase hex characters (401 `bad_token` if malformed too) | `bad_token` |
| `lives` | integer 1 to 5 | `bad_settings` |
| `start_tier` | `easy`, `medium`, `hard` or `expert` | `bad_settings` |
| `pokemon_id` | positive integer that exists in the dataset | `bad_answer` |

Actions (`auth` = `room_id`, `player_id`, `token` as returned by create or join):

| `action` | Body | Success (200) | Refusals |
| --- | --- | --- | --- |
| `create` | `nickname`, optional `lives` (default 3), optional `start_tier` (default `easy`) | `{ok, room_id, code, player_id, token, nickname, icon, status: 'lobby'}`. **The only time the token is returned (with join): store it.** | `429 rate_limited` (per network), `bad_nickname`, `bad_settings` |
| `join` | `code`, `nickname` | same shape; the nickname may come back changed ("Ash 2"). Joining a running game watches until the next one. | `429 rate_limited`, `bad_code`, `404 no_room`, `bad_nickname`, `409 room_full` |
| `rejoin` | `player_id`, `token` | `{ok, room_id, code, player_id, nickname, icon, status}` (no token); counts as a heartbeat | `401 bad_token` |
| `settings` | auth, `lives`, `start_tier` | `{ok}` | `403 not_host`, `409 not_lobby`, `bad_settings` |
| `start` | auth | `{ok, game_no, players}`; deals the deck (seeded random, sized for the players present, from the room's `start_tier`) | `401 bad_token`, `403 not_host`, `404 no_room`, `409 not_lobby`, `409 too_few_players` |
| `answer` | auth, `pokemon_id` | `{ok, result: 'passed' or 'cleared', round, turn_player_id, deadline, turn_no}` (see below) | see below |
| `remove` | auth, `target_id` | `{ok}` | `403 not_host`, `404 no_player` (unknown, self, or already gone) |
| `leave` | auth | `{ok}`; the token stops working | `401 bad_token` |
| `play_again` | auth | `{ok}`; the room goes back to the lobby (the host then calls `start` again) | `403 not_host`, `409 not_over` |

**Answering.** Only the player whose turn it is may answer; the function checks the answer against the category with the shared engine
first.

- A wrong answer is **HTTP 200** with `{"ok": false, "error": "wrong_answer", "why": "part" | "used", "reason": "Squirtle isn't a Fire type", "part": {...}}`
  (`part`, the failed `Part` JSON, only when `why` is `part`). Nothing is written and the timer keeps running: show `reason` and let them try again.
  `why: "used"` means the species was already said this round.
- A valid answer is passed to `party_apply_answer`, and its result is returned: `result: 'passed'` (next player's turn, new `deadline`) or
  `'cleared'` (a full lap, or the pool ran out: no life lost, next round). Read the new room state from Realtime.
- `409 too_late`: the answer arrived after `deadline + 300 ms`. The turn is timed out in the same transaction; the reply carries
  `timeout` (the timeout result). `409 already_used` is the same race lost to another request. `403 not_your_turn`, `409 not_playing`,
  `404 no_room`, `400 bad_answer` (unknown Pokémon id) change nothing.

**Statuses.** `400` bad field or JSON (`invalid_json`, `invalid_body`, `unknown_action`, the field errors above, `bad_settings`, `bad_deck`, `bad_answer`);
`401 bad_token`; `403 forbidden` (origin), `not_host`, `not_your_turn`; `404 no_room`, `no_player`; `405 method_not_allowed`; `409 not_lobby`, `not_playing`,
`not_over`, `room_full`, `too_few_players`, `already_used`, `too_late`; `413 too_large`; `429 rate_limited`; `500 server_error` (a database error;
only its code is logged, never a token or the message).

**Caps.** `create`: 20 per network per hour; `join`: 120 per network per hour (`party_network_hit` with `sha256(salt|ip|<ip>)`, the same daily
salt as `track`, kept in `_shared/network.ts`). Override with the function secrets `MAX_PARTY_CREATES_PER_HOUR` and `MAX_PARTY_JOINS_PER_HOUR`.
A request that carries no IP skips the cap, as in `track`. Not rate limited: `rejoin`, `settings`, `start`, `answer`, `remove`, `leave`,
`play_again` (they need a valid token, and `start` checks the token before it deals the deck).

Not handled here (the client calls SQL directly): `party_timeout` at zero, `party_heartbeat` every 4 s, and Realtime reads (see "Party database").
