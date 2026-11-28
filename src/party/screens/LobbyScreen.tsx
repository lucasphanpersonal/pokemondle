import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PARTY_CONFIG, PARTY_TIERS } from '../../config/partyConfig.ts'
import { ResultMark } from '../../components/ResultMark.tsx'
import { SpriteImg } from '../../components/SpriteImg.tsx'
import { iconSources } from '../../lib/pokedex.ts'
import { inviteLink } from '../route.ts'
import { startBlockedReason, type LobbyPlayer, type LobbyView, type PartySettings } from '../types.ts'

/**
 * The room's lobby: the code in big letters with Copy invite link, the players in join order, the host's settings and
 * Start. Presentational: the room connection lives in the caller.
 *
 * Props:
 * - `view`: the room (LobbyView in ../types.ts: code, status, players, meId, hostId, settings).
 * - `busy`: a request is on its way; the buttons are disabled.
 * - `error`: the last refusal in words, shown above Start / Leave.
 * - `onChangeSettings(settings)`: host only, called on every tap of a lives or tier toggle.
 * - `onStart()`: host only, Start (only pressable with 2 or more players; the server checks again).
 * - `onRemove(playerId)`: host only, after the remove button is tapped twice (the first tap asks).
 * - `onLeave()`: Leave the room.
 * - `headingRef`: PartyApp focuses the heading when the screen changes.
 *
 * Phones get one column (code, players, then settings and buttons); from 768px the settings sit beside the list.
 */
export interface LobbyScreenProps {
  view: LobbyView
  busy: boolean
  error?: string
  onChangeSettings: (settings: PartySettings) => void
  onStart: () => void
  onRemove: (playerId: string) => void
  onLeave: () => void
  headingRef?: RefObject<HTMLHeadingElement | null>
}

export function LobbyScreen({ view, busy, error, onChangeSettings, onStart, onRemove, onLeave, headingRef }: LobbyScreenProps) {
  const isHost = view.hostId === view.meId
  const blocked = startBlockedReason(view)
  const reasonId = useId()
  const late = view.status !== 'lobby'

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start" data-screen="lobby">
      <CodeBox code={view.code} headingRef={headingRef} />

      {late && (
        <p className="ds-box px-4 py-3 tx-10 leading-5 md:col-span-2" role="status" data-testid="party-late">
          A game is already on in this room. You can watch it and you'll play in the next one.
        </p>
      )}

      <PlayerList view={view} isHost={isHost} busy={busy} onRemove={onRemove} />

      <section className="ds-box flex flex-col gap-4 px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-settings-title">
        <h3 id="party-settings-title" className="tx-11 leading-5">
          Settings
        </h3>
        {isHost ? (
          <HostSettings settings={view.settings} disabled={busy || late} onChange={onChangeSettings} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2" data-testid="party-settings-readonly">
            <dt>Starting lives</dt>
            <dd>{view.settings.lives}</dd>
            <dt>Starting tier</dt>
            <dd>{PARTY_TIERS.find((t) => t.id === view.settings.startTier)?.name ?? view.settings.startTier}</dd>
          </dl>
        )}
        <div className="flex flex-col gap-1.5 sm:gap-2">
          {error && (
            <p role="alert" className="tx-9 leading-4 text-ds-red-dark" data-testid="party-lobby-error">
              {error}
            </p>
          )}
          {isHost ? (
            <>
              <button
                type="button"
                onClick={onStart}
                disabled={busy || blocked !== null}
                aria-describedby={blocked ? reasonId : undefined}
                className="ds-button bevel-red h-11 w-full px-3 text-[10px] text-ds-paper disabled:opacity-40"
              >
                Start
              </button>
              {blocked && (
                <p id={reasonId} className="tx-9 leading-4 text-ds-frame">
                  {blocked}
                </p>
              )}
            </>
          ) : (
            !late && (
              <p className="tx-10 leading-5" role="status">
                Waiting for the host to start…
              </p>
            )
          )}
          <button
            type="button"
            onClick={onLeave}
            disabled={busy}
            className="ds-button bevel-paper h-11 w-full px-3 text-[10px] text-ds-ink disabled:opacity-40"
          >
            Leave
          </button>
        </div>
      </section>
    </div>
  )
}

/** The room code in big pixel letters, and Copy invite link. */
function CodeBox({ code, headingRef }: { code: string; headingRef?: RefObject<HTMLHeadingElement | null> }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const linkRef = useRef<HTMLParagraphElement>(null)
  const link = inviteLink(code)

  useEffect(() => {
    if (copied !== 'yes') return
    const t = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(t)
  }, [copied])
  useEffect(() => {
    if (copied === 'failed' && linkRef.current) window.getSelection()?.selectAllChildren(linkRef.current)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('yes')
    } catch {
      // No clipboard (an insecure page, or permission refused): show the link, selected, to copy by hand.
      setCopied('failed')
    }
  }

  return (
    <section
      className="ds-box flex flex-col items-center gap-3 px-4 py-4 text-center tx-10 leading-5 sm:px-5 md:col-span-2"
      aria-labelledby="party-room-title"
    >
      <h2 id="party-room-title" ref={headingRef} tabIndex={-1} className="tx-10 leading-5 outline-none">
        Room code <span className="sr-only">{code.split('').join(' ')}</span>
      </h2>
      <p className="pl-[0.25em] text-[32px] leading-none tracking-[0.25em] sm:text-[40px]" aria-hidden="true" data-testid="party-room-code">
        {code}
      </p>
      <p className="text-ds-frame">Friends join with this code or the invite link.</p>
      <button
        type="button"
        onClick={copy}
        className="ds-button bevel-paper h-11 min-w-[13rem] px-3 text-[10px] text-ds-ink max-sm:w-full"
      >
        {copied === 'yes' ? 'Copied!' : 'Copy invite link'}
      </button>
      <p className="sr-only" aria-live="polite">
        {copied === 'yes' ? 'Invite link copied.' : ''}
      </p>
      {copied === 'failed' && (
        <div className="flex w-full flex-col gap-1.5 sm:gap-2" data-testid="party-link-fallback">
          <p className="tx-9 leading-4" role="alert">
            Couldn't copy here. Copy this link instead:
          </p>
          {/* The whole link wraps and is picked up by one tap (user-select: all), ready to copy. */}
          <p
            ref={linkRef}
            className="ds-box px-3 py-2 text-left tx-10 leading-5 break-all select-all [filter:none]"
            data-testid="party-invite-link"
          >
            {link}
          </p>
        </div>
      )}
    </section>
  )
}

function PlayerList({ view, isHost, busy, onRemove }: { view: LobbyView; isHost: boolean; busy: boolean; onRemove: (id: string) => void }) {
  // The remove button asks first: one tap arms it ("Tap again to remove"), a second tap removes. It disarms itself.
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(null), 4000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <section className="ds-box px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-players-title">
      <h3 id="party-players-title" className="mb-3 tx-11 leading-5">
        Players {view.players.length}/{PARTY_CONFIG.maxPlayers}
      </h3>
      <ul className="flex flex-col gap-1.5 sm:gap-2" data-testid="party-players">
        {view.players.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            me={p.id === view.meId}
            host={p.id === view.hostId}
            armed={armed === p.id}
            canRemove={isHost && p.id !== view.meId}
            busy={busy}
            onRemove={() => {
              if (armed === p.id) {
                setArmed(null)
                onRemove(p.id)
              } else setArmed(p.id)
            }}
          />
        ))}
      </ul>
    </section>
  )
}

interface PlayerRowProps {
  player: LobbyPlayer
  me: boolean
  host: boolean
  armed: boolean
  canRemove: boolean
  busy: boolean
  onRemove: () => void
}

function PlayerRow({ player, me, host, armed, canRemove, busy, onRemove }: PlayerRowProps) {
  return (
    <li className="flex min-h-11 items-center gap-1.5 sm:gap-2" data-player={player.id}>
      <SpriteImg
        sources={iconSources({ id: player.icon, dexNumber: player.icon })}
        crop={24}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="leading-5 break-words">
          {player.nickname}
          {me && <span className="text-ds-frame"> (you)</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 tx-8 leading-4 text-ds-frame">
          {host && (
            <span className="inline-flex items-center gap-1">
              <Crown />
              Host
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 border-2 border-ds-ink ${player.online ? 'bg-fb-match' : 'bg-transparent'}`}
            />
            {player.online ? 'Online' : 'Away'}
          </span>
          {armed && <span className="text-ds-red-dark">Tap again to remove</span>}
        </p>
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={armed ? `Remove ${player.nickname}: tap again to confirm` : `Remove ${player.nickname}`}
          aria-pressed={armed}
          className={`ds-button bevel-paper flex h-11 w-11 shrink-0 items-center justify-center text-ds-ink disabled:opacity-40 ${armed ? 'bevel-pressed' : ''}`}
        >
          <ResultMark kind="mismatch" scale={2} className="" />
        </button>
      )}
    </li>
  )
}

/** The host's crown: 11 x 6 pixel art drawn at 2 px a pixel, gold with an ink outline. */
const CROWN = ['.k...k...k.', 'kYk.kYk.kYk', 'kYYkYYYkYYk', 'kYYYYYYYYYk', 'kYYYYYYYYYk', 'kkkkkkkkkkk']
export function Crown() {
  return (
    <svg width={22} height={12} viewBox="0 0 11 6" shapeRendering="crispEdges" aria-hidden="true" className="shrink-0">
      {CROWN.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c === 'k' ? '#202830' : '#e8c030'} />,
        ),
      )}
    </svg>
  )
}

/** The host's lives (1-5) and starting tier, as rows of toggles: the chosen one green and pressed in. */
function HostSettings({ settings, disabled, onChange }: { settings: PartySettings; disabled: boolean; onChange: (s: PartySettings) => void }) {
  const livesId = useId()
  const tierId = useId()
  const lives = Array.from({ length: PARTY_CONFIG.livesMax - PARTY_CONFIG.livesMin + 1 }, (_, i) => PARTY_CONFIG.livesMin + i)
  return (
    <>
      <div className="flex flex-col gap-1.5 sm:gap-2">
        <p id={livesId}>Starting lives</p>
        <div role="radiogroup" aria-labelledby={livesId} className="grid grid-cols-5 gap-1.5 sm:gap-2" data-testid="party-lives">
          {lives.map((n) => (
            <Toggle key={n} on={settings.lives === n} disabled={disabled} onClick={() => onChange({ ...settings, lives: n })}>
              {n}
            </Toggle>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:gap-2">
        <p id={tierId}>Starting tier</p>
        <div role="radiogroup" aria-labelledby={tierId} className="grid grid-cols-2 gap-1.5 sm:gap-2" data-testid="party-tier">
          {PARTY_TIERS.map((t) => (
            <Toggle key={t.id} on={settings.startTier === t.id} disabled={disabled} onClick={() => onChange({ ...settings, startTier: t.id })}>
              {t.name}
            </Toggle>
          ))}
        </div>
      </div>
    </>
  )
}

/** One choice in a row of toggles, styled like the game's other toggles (Gens picker, Daily / Endless). */
function Toggle({ on, disabled, onClick, children }: { on: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !on && onClick()}
      className={`ds-button h-11 min-w-0 px-2.5 text-[10px] disabled:opacity-40 ${
        on ? 'bevel-green bevel-pressed text-white [text-shadow:1px_1px_0_rgb(0_0_0/0.4)]' : 'bevel-paper text-ds-ink'
      }`}
    >
      {children}
    </button>
  )
}
