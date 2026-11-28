import { useState, type RefObject } from 'react'
import { ResultMark } from '../../components/ResultMark.tsx'
import { SpriteImg } from '../../components/SpriteImg.tsx'
import { iconSources } from '../../lib/pokedex.ts'
import { tierName } from '../game.ts'
import { winnerText } from '../moments.ts'
import type { GameOverView, ResultPlayer } from '../types.ts'
import { CategoryChips } from './CategoryCard.tsx'
import { Crown } from './LobbyScreen.tsx'
import { TimeUpPanel } from './RoundMoments.tsx'

/**
 * The game over screen: the winner's sprite and name, the time's up that ended the game (once more, if it ended that
 * way), a table of answers given and lives lost per player, the hardest category anyone cleared, then red Play again
 * (host only; the room goes back to the lobby, where Start deals a new game) and white Leave. Guests see "Waiting for
 * the host…" instead of Play again. No share button or result grid. Presentational: the room connection lives in the
 * caller.
 *
 * Phones get one column (winner, final time's up, table, hardest category, buttons); from 1024 px the table sits beside
 * the rest.
 */
export interface GameOverScreenProps {
  view: GameOverView
  busy?: boolean
  error?: string
  onPlayAgain: () => void
  onLeave: () => void
  headingRef?: RefObject<HTMLHeadingElement | null>
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export function GameOverScreen({ view, busy, error, onPlayAgain, onLeave, headingRef }: GameOverScreenProps) {
  const [reduceMotion] = useState(prefersReducedMotion)
  // The final burst plays from when the screen opened.
  const [openedAt] = useState(() => Date.now())
  const winner = view.winner
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start" data-screen="over">
      <section className="ds-box flex flex-col items-center gap-3 px-4 py-4 text-center tx-10 leading-5 sm:px-5" aria-labelledby="party-over-title">
        <h2 id="party-over-title" ref={headingRef} tabIndex={-1} className="tx-12 leading-6 outline-none">
          Game over
        </h2>
        <div className="flex flex-col items-center gap-1" data-testid="party-winner">
          {winner && <Crown />}
          {winner && (
            <SpriteImg
              sources={iconSources({ id: winner.icon, dexNumber: winner.icon })}
              crop={24}
              alt=""
              width={80}
              height={80}
              className="h-20 w-20 shrink-0"
            />
          )}
          <p className="tx-12 leading-6 [overflow-wrap:anywhere]">{winnerText(winner, view.meId)}</p>
          <p className="text-ds-frame">
            {view.rounds} {view.rounds === 1 ? 'round' : 'rounds'} played
          </p>
        </div>
      </section>

      {view.finalTimeout && (
        <TimeUpPanel
          end={view.finalTimeout}
          startedAt={openedAt}
          eventAt={openedAt}
          meId={view.meId}
          reduceMotion={reduceMotion}
          className="lg:col-start-1"
        />
      )}

      <ResultsTable players={view.players} />

      <section className="ds-box flex flex-col gap-3 px-4 py-4 text-center tx-10 leading-5 sm:px-5 lg:col-start-1" aria-labelledby="party-hardest-title" data-testid="party-hardest">
        <h3 id="party-hardest-title" className="text-left tx-11 leading-5">
          Hardest category cleared
        </h3>
        {view.hardest ? (
          <>
            <p className="text-left text-ds-frame">{tierName(view.hardest.tier)}</p>
            <CategoryChips category={view.hardest.category} label="Hardest category cleared" />
          </>
        ) : (
          <p className="text-left text-ds-frame">No round was cleared this game.</p>
        )}
      </section>

      <div className="flex flex-col gap-1.5 sm:gap-2 lg:col-start-1">
        {error && (
          <p role="alert" className="tx-9 leading-4 text-ds-red-dark" data-testid="party-over-error">
            {error}
          </p>
        )}
        {view.isHost ? (
          <button
            type="button"
            onClick={onPlayAgain}
            disabled={busy}
            className="ds-button bevel-red h-11 w-full px-3 text-[10px] text-ds-paper disabled:opacity-40"
          >
            Play again
          </button>
        ) : (
          <p className="ds-box px-4 py-3 text-center tx-10 leading-5" role="status" data-testid="party-waiting-host">
            Waiting for the host…
          </p>
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
    </div>
  )
}

/** Answers given and lives lost per player, the winner first. */
function ResultsTable({ players }: { players: ResultPlayer[] }) {
  return (
    <section
      className="ds-box px-3 py-4 tx-10 leading-5 sm:px-5 lg:col-start-2 lg:row-span-4 lg:row-start-1"
      aria-labelledby="party-results-title"
    >
      <h3 id="party-results-title" className="mb-3 tx-11 leading-5">
        Results
      </h3>
      <table className="w-full border-collapse" data-testid="party-results">
        <thead>
          {/* Bottom-aligned, so a heading that wraps on a narrow phone ("Lives / lost") still lines up with the others. */}
          <tr className="tx-8 leading-4 text-ds-frame">
            <th scope="col" className="pb-2 text-left align-bottom font-normal">
              Player
            </th>
            <th scope="col" className="pb-2 pl-1 sm:pl-3 text-right align-bottom font-normal">
              Answers
            </th>
            <th scope="col" className="pb-2 pl-1 sm:pl-3 text-right align-bottom font-normal sm:whitespace-nowrap">
              Lives lost
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id} data-player={p.id} className="border-t-2 border-ds-frame/30">
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="flex min-h-11 items-center gap-1.5 sm:gap-2">
                  <SpriteImg
                    sources={iconSources({ id: p.icon, dexNumber: p.icon })}
                    crop={24}
                    alt=""
                    width={40}
                    height={40}
                    className={`h-10 w-10 shrink-0 ${p.out || p.gone ? 'grayscale' : ''}`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="leading-5 [overflow-wrap:anywhere]">
                      {p.nickname}
                      {p.isMe && <span className="text-ds-frame"> (you)</span>}
                    </span>
                    <span className="flex items-center gap-1 tx-8 leading-4 text-ds-frame">
                      {p.isWinner ? (
                        <>
                          <Crown />
                          Winner
                        </>
                      ) : p.gone ? (
                        'Left'
                      ) : p.out ? (
                        <>
                          <ResultMark kind="mismatch" scale={1} className="" />
                          Out
                        </>
                      ) : (
                        `${p.lives} ${p.lives === 1 ? 'life' : 'lives'} left`
                      )}
                    </span>
                  </span>
                </span>
              </th>
              <td className="py-1.5 pl-1 sm:pl-3 text-right tabular-nums">{p.answers}</td>
              <td className="py-1.5 pl-1 sm:pl-3 text-right tabular-nums">{p.livesLost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
