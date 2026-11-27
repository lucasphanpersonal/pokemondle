interface PartyHeaderProps {
  onHelp: () => void
}

/**
 * The Party page's own title bar: the Pokémondle title (a link home to the main game), a Party label and Help.
 * No Daily / Endless switch. Same strip and 44px controls as the main header (Header.tsx); with only one button
 * on the right, the title keeps its 12px size on every phone (the main header shrinks it below 390px for room).
 */
export function PartyHeader({ onHelp }: PartyHeaderProps) {
  return (
    <header className="ds-titlebar px-2 py-2 sm:px-5 sm:py-3">
      <div className="mx-auto flex max-w-5xl lg:max-w-[80rem] big:max-w-[80rem] items-center justify-between gap-1.5 sm:gap-2">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <h1 className="text-[12px] whitespace-nowrap sm:text-xl">
            {/*
              The page lives one folder below the site root (/party/ on pokemondle.io, /pokemondle/party/ on GitHub
              Pages), so "../" is the main game in both places. The link fills the 44px row so it is easy to tap.
            */}
            <a href="../" className="ds-focus flex min-h-11 items-center" aria-label="Pokémondle (back to the main game)">
              POKÉMONDLE
            </a>
          </h1>
          {/* A label, not a button: a plain outlined tag rather than a bevel, so it doesn't look tappable. */}
          <span className="border-2 border-current px-1 py-1 text-[9px] leading-none sm:px-2 sm:py-1.5 sm:text-xs">
            PARTY
          </span>
        </div>
        <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Party controls">
          <button
            type="button"
            onClick={onHelp}
            aria-label="How to play Party"
            className="ds-button bevel-paper min-w-11 h-11 text-[10px] text-ds-ink"
          >
            ?
          </button>
        </nav>
      </div>
    </header>
  )
}
