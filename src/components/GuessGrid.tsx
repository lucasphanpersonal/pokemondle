import { useState, useSyncExternalStore } from 'react'
import { GRID_COLUMNS } from '../config/gameConfig'
import type { GuessFeedback } from '../lib/compare'
import type { Pokemon } from '../types/pokemon'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { cardTileSpan, TWO_UP } from '../lib/cardLayout'
import { isBigText, subscribeBigText } from '../lib/display'
import { abilityColumnFit } from '../lib/tileText'
import { FeedbackRow, GuessCard } from './FeedbackRow'
import { PixelBall } from './PixelBall'

/** Tailwind's lg breakpoint (1024 px): the table from here up, cards below. */
const TABLE_QUERY = '(min-width: 64rem)'
/**
 * With Larger text the table needs a quarter more width for the same words, so it starts at
 * 1280 px (and the page widens to match, big:max-w-[80rem] in App.tsx); cards are shown below that.
 */
const BIG_TABLE_QUERY = '(min-width: 80rem)'

/**
 * Share of the table width for each column (sums to 100). Fixed widths stop the
 * Shared Ability text from taking over the table and squeezing the others.
 * Each leaves room for the common words at full size; anything longer shrinks to fit inside the tile padding (.tile-fit in index.css) or wraps at a soft hyphen (lib/tileText.ts).
 * Pokémon is widest so almost every name (all but "Paldean Tauros (Combat Breed)") fits on three lines at 7px or more;
 * Shared Ability is sized by line count (abilityFit in FeedbackRow.tsx), so three long abilities still stay inside the tile.
 * Egg Group is wide enough for "Undiscovered" on one line at 7px, so it never splits as "Undis- / covered".
 */
const COLUMN_WIDTHS = [13.298, 10.437, 10.437, 7.447, 7.447, 9.374, 8.511, 9.043, 11.706, 12.3]

/** Phone key: the labels of the card's two tile rows, in column order. */
const KEY_TOP = ['Type 1', 'Type 2', 'Height']
const KEY_BOTTOM = ['Weight', 'Color', 'Evolution', 'Form']

interface GuessGridProps {
  guesses: Pokemon[]
  feedback: GuessFeedback[]
}

/**
 * The guess table. Newest guess on top. Only guesses made after the grid
 * mounted flip in, so a game restored on reload (or a mode switch, which
 * remounts the grid) appears instantly.
 *
 * Phones and tablets under 1024 px show one compact card per guess (no sideways
 * scrolling); larger tablets and desktops show the full ten-column table.
 * Only the layout that fits is rendered, so each guess's tiles exist once in the DOM.
 */
export function GuessGrid({ guesses, feedback }: GuessGridProps) {
  const abilityColumn = abilityColumnFit(guesses, feedback)
  const bigText = useSyncExternalStore(subscribeBigText, isBigText, () => false)
  const twoUp = TWO_UP[bigText ? 'big' : 'normal']
  const showTable = useMediaQuery(bigText ? BIG_TABLE_QUERY : TABLE_QUERY)
  // Captured once at mount: how many guesses were restored rather than made now.
  const [restoredCount, setRestoredCount] = useState(guesses.length)
  // Crossing the breakpoint (rotating an iPad) mounts the other layout's rows;
  // treat every guess so far as restored so they don't flip in a second time.
  const [layoutShown, setLayoutShown] = useState(showTable)
  if (layoutShown !== showTable) {
    setLayoutShown(showTable)
    setRestoredCount(guesses.length)
  }

  if (guesses.length === 0) {
    return (
      <div className="ds-box p-6 text-center tx-10 leading-5 text-ds-frame">
        Make your first guess to start!
      </div>
    )
  }

  return (
    <div className="ds-box p-2 sm:p-3">
      {/*
        The guess count heads the board it counts: "Your guesses" and a Poké Ball ×N, above a dashed line like the
        ones between cards. Lined up with the tiles' outer edge (the table's border spacing, the cards' padding).
      */}
      <div className="mx-1 mb-2 flex items-center justify-between gap-2 border-b-2 border-dashed border-ds-frame/30 pb-2 tx-10 leading-5">
        <h2 className="font-normal">Your guesses</h2>
        <p className="inline-flex items-center gap-1.5">
          <PixelBall />
          <span aria-hidden="true">×{guesses.length}</span>
          <span className="sr-only">{guesses.length === 1 ? '1 guess' : `${guesses.length} guesses`}</span>
        </p>
      </div>
      {showTable ? (
        <div>
          <table className="w-full table-fixed border-separate border-spacing-1">
            <colgroup>
              {COLUMN_WIDTHS.map((w, i) => (
                <col key={GRID_COLUMNS[i]} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {GRID_COLUMNS.map((col) => (
                  <th key={col} scope="col" className="p-1 text-center tx-9 leading-3 font-normal">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guesses
                .map((g, i) => ({ g, f: feedback[i], i }))
                .reverse()
                .map(({ g, f, i }) => (
                  <FeedbackRow key={g.id} guess={g} feedback={f} animate={i >= restoredCount} abilityColumn={abilityColumn} />
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {/*
            Key laid out like the card's two rows of tiles (Egg Group and Ability strips label themselves).
            Phrased as a sentence it wrapped unevenly on narrow phones.
          */}
          <div className={`grid gap-x-3 ${twoUp.grid}`}>
            {/* From 720px wide (iPad portrait; 900px with Larger text) the cards sit two to a row, each with its own copy of the key. */}
            {[0, 1].map((copy) => (
              <div
                key={copy}
                aria-hidden
                className={`mb-2 grid-cols-12 gap-x-1 text-center tx-8 leading-3 text-ds-frame max-[360px]:tx-7 big:leading-4 sm:tx-9 sm:leading-4 ${
                  copy ? twoUp.keyCopy : 'grid'
                }`}
              >
                {[...KEY_TOP, ...KEY_BOTTOM].map((label, i) => (
                  <span key={label} className={cardTileSpan(i)}>
                    {label}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <ul className={`grid grid-cols-1 gap-x-3 ${twoUp.grid}`}>
            {guesses
              .map((g, i) => ({ g, f: feedback[i], i }))
              .reverse()
              .map(({ g, f, i }) => (
                <GuessCard key={g.id} guess={g} feedback={f} animate={i >= restoredCount} bigText={bigText} />
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}
