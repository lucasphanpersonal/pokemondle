import { useCallback, useMemo, useState } from 'react'
import { CaptureScene } from './components/CaptureScene'
import { Confetti } from './components/Confetti'
import { GensModal } from './components/GensModal'
import { GiveUpModal } from './components/GiveUpModal'
import { GuessGrid } from './components/GuessGrid'
import { Header } from './components/Header'
import { HelpModal } from './components/HelpModal'
import { HintPrompt } from './components/HintPrompt'
import { HistoryModal } from './components/HistoryModal'
import { PixelBulb } from './components/PixelBulb'
import { PixelGear } from './components/PixelGear'
import { ResultModal } from './components/ResultModal'
import { SearchBar } from './components/SearchBar'
import { TypeTrackerButton, TypeTrackerModal, TypeTrackerPanel } from './components/TypeTracker'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useAnalytics } from './hooks/useAnalytics'
import { useRevealEffects } from './hooks/useRevealEffects'
import { useTypeNotes } from './hooks/useTypeNotes'
import { usePokemondle, type GameMode, type GuessResult } from './hooks/usePokemondle'
import { ALL_GENS, gensLabel } from './lib/gens'
import { computeStats } from './lib/history'
import { POKEDEX } from './lib/pokedex'
import { gameIsShiny } from './lib/shiny'
import { loadJson, saveJson } from './lib/storage'
import type { Pokemon } from './types/pokemon'

/** How many Pokémon each Gen has (index 0 = Gen 1), for the Endless Gen picker. */
const GEN_COUNTS = ALL_GENS.map((gen) => POKEDEX.filter((p) => p.generation === gen).length)

export default function App() {
  const [mode, setMode] = useState<GameMode>('daily')
  // Show the rules automatically on a player's first visit.
  const [showHelp, setShowHelp] = useState(() => loadJson('seen-help') !== true)
  const [showHistory, setShowHistory] = useState(false)
  const [showGens, setShowGens] = useState(false)
  const game = usePokemondle(mode)
  const stats = computeStats(game.history)
  const submitGuess = useAnalytics(game)
  const gameId = `${mode}:${game.gameKey}`

  const { revealing, capture, endCapture, confetti, endConfetti, play, escape } = useRevealEffects(gameId)
  const onGuess = useCallback(
    (pokemon: Pokemon): GuessResult => {
      const { result, applied } = submitGuess(pokemon)
      if (result === 'ok' && applied) {
        // Judge the win by the game the guess landed in, not the rendered one:
        // just after local midnight the rendered game can still be yesterday's.
        play(pokemon, `${applied.mode}:${applied.gameKey}`, applied.status === 'won')
      }
      return result
    },
    [submitGuess, play],
  )

  const [dismissedResult, setDismissedResult] = useState<string | null>(null)
  const finished = game.gameStatus !== 'playing'
  const showResult = finished && !revealing && dismissedResult !== gameId
  // The rare shiny catch (1 in 20 wins), worked out once per game rather than on every render.
  const won = game.gameStatus === 'won'
  const shiny = useMemo(() => won && gameIsShiny(game.gameKey, game.targetPokemon.id), [won, game.gameKey, game.targetPokemon.id])

  // "Give up" (Daily and Endless) asks first. Keyed by game, so switching modes or starting a new game drops a pending ask.
  const [giveUpAsk, setGiveUpAsk] = useState<string | null>(null)
  const showGiveUp = giveUpAsk === gameId && game.canGiveUp
  const confirmGiveUp = () => {
    setGiveUpAsk(null)
    game.giveUp()
    // The ball bursts and the answer runs off before the result screen.
    escape(game.targetPokemon, gameId)
  }

  // The Gen hint. It is pointless when the answer can only come from one Gen (an Endless game limited to one).
  const hintUseful = game.gameGens.length > 1
  const canHint = game.canTakeHint && hintUseful
  const showHint = game.hinted && hintUseful
  // It pops up once per game, after the guess that makes it available has flipped in; after that it is a button.
  // Remembered per mode (the game it was last offered in), so switching modes doesn't offer it again.
  const [hintOffered, setHintOffered] = useState<Record<string, unknown>>(() => {
    const raw = loadJson('hint-offered')
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  })
  const showHintPrompt =
    canHint && hintOffered[mode] !== gameId && !showHelp && !showHistory && !showGens && !showGiveUp && !revealing
  const [hintPromptOpen, setHintPromptOpen] = useState<string | null>(null)
  const closeHintPrompt = () => {
    setHintPromptOpen(null)
    const next = { ...hintOffered, [mode]: gameId }
    setHintOffered(next)
    saveJson('hint-offered', next)
  }
  // Opened from the Gen hint button, or kept open (for its "from Gen N" reply) once the hint is taken.
  const hintPromptShown = showHintPrompt || hintPromptOpen === gameId
  const takeHint = () => {
    setHintPromptOpen(gameId)
    game.takeHint()
  }

  // The type tracker: the player's own notes of ruled-out types, kept per game. Inline from 1024 px; a pop-out below that.
  const typeNotes = useTypeNotes(mode, game.gameKey)
  const trackerInline = useMediaQuery('(min-width: 64rem)')
  const [typesOpen, setTypesOpen] = useState(false)
  const showTypesModal = typesOpen && !trackerInline

  const closeHelp = () => {
    setShowHelp(false)
    saveJson('seen-help', true)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header mode={mode} onModeChange={setMode} onHelp={() => setShowHelp(true)} />
      <main className="mx-auto flex w-full max-w-5xl lg:max-w-[80rem] big:max-w-[80rem] flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6">
        <div className="flex flex-col items-center gap-2 text-center">
          {/*
            The title sits in its own box (the guess box's look) in both modes. In Endless it names the Gens the game
            was drawn from, and a plain pixel gear (no box of its own) opens the Gens picker, view-only mid-game since
            the game keeps its Gens. The gear's tap area is the full 44px but its negative margins keep the box as
            short as the Daily one, so both titles match.
          */}
          {/* The title box and the Gen hint button share one width (the wider of the two), so they stack as a neat column. */}
          <div className="flex max-w-full flex-col items-stretch gap-2">
            <div className="ds-box flex max-w-full items-center justify-center gap-2 px-4 py-2">
              <p className="tx-10 leading-5 sm:text-xs sm:leading-5">
                {mode === 'endless' ? `Endless · ${gensLabel(game.gameGens)}` : `Daily #${game.puzzleNumber}`}
              </p>
              {mode === 'endless' && (
                <button
                  type="button"
                  onClick={() => setShowGens(true)}
                  aria-label="Endless Gens settings"
                  title={game.inProgress ? 'Gens for this game' : 'Choose which Gens Endless picks from'}
                  className="ds-focus-inset -my-3 -mr-3 flex h-11 w-11 shrink-0 items-center justify-center text-ds-ink transition-transform hover:text-ds-frame active:translate-y-px"
                >
                  <PixelGear />
                </button>
              )}
            </div>
            {/*
              Game menu: the Gen hint (Endless's Gens settings are the gear in the title box). Give up lives in the page
              footer, as far from the guess box as it can be. History and the streak are not here: they belong to the end
              of a game, so they live on the result screen.
            */}
            {(canHint || showHint) && (
              <div className="flex flex-col items-stretch">
                {canHint && (
                  <button
                    type="button"
                    onClick={() => setHintPromptOpen(gameId)}
                    className="ds-button bevel-paper inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[9px] sm:px-4 sm:text-[10px]"
                  >
                    <PixelBulb />
                    Gen hint
                  </button>
                )}
                {/* Once taken, the hint button stays in its place pressed in (the "on" look) and shows the Gen. */}
                {showHint && (
                  <p className="ds-button bevel-paper bevel-pressed inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[9px] sm:px-4 sm:text-[10px]">
                    <PixelBulb />
                    <span aria-hidden="true">Hint · Gen {game.targetPokemon.generation}</span>
                    <span className="sr-only">Hint: the answer is from Gen {game.targetPokemon.generation}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-xl">
          <SearchBar
            pokedex={POKEDEX}
            guessedIds={game.guesses.map((g) => g.id)}
            onGuess={onGuess}
            disabled={finished}
            doneText={game.gameStatus === 'lost' ? 'It got away!' : undefined}
            // Once the tiles have flipped, the Guess button's spot reopens the result screen; in Endless, New Pokémon
            // joins it. Red marks the main action, so in Endless that is New Pokémon and See results turns white.
            doneAction={
              finished && !revealing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setDismissedResult(null)}
                    className={`ds-button whitespace-nowrap px-3 text-[10px] ${mode === 'endless' ? 'bevel-paper' : 'bevel-red text-ds-paper'}`}
                  >
                    See results
                  </button>
                  {mode === 'endless' && (
                    <button type="button" onClick={game.startNewEndlessGame} className="ds-button bevel-red whitespace-nowrap px-3 text-[10px] text-ds-paper">
                      New Pokémon
                    </button>
                  )}
                </>
              ) : undefined
            }
            doneWide={mode === 'endless'}
          />
        </div>

        {trackerInline && <TypeTrackerPanel ruledOut={typeNotes.ruledOut} onToggle={typeNotes.toggle} onClear={typeNotes.clear} />}

        {/* Remount per game so only guesses made now animate. */}
        <GuessGrid
          key={gameId}
          guesses={game.guesses}
          feedback={game.feedback}
          headerAction={trackerInline ? undefined : <TypeTrackerButton count={typeNotes.ruledOut.length} onOpen={() => setTypesOpen(true)} />}
        />
      </main>

      {/*
        Give up sits in a footer at the bottom of the page: the same spot at every guess count, far from
        the guess box so the most-tapped control never sits next to the one that ends the game, and never over the
        board. It appears with the first guess (there is nothing to give up before then) and is kept, inert, while the
        last guess's tiles flip (unless that was the first guess, when it was never shown), then gone once the game is over.
      */}
      {(game.canGiveUp || (revealing && game.guesses.length > 1)) && (
        <footer className="mt-auto border-t-2 border-ds-frame/40">
          <div className="mx-auto flex w-full max-w-5xl lg:max-w-[80rem] big:max-w-[80rem] items-center justify-between gap-3 px-3 py-3 sm:px-5">
            <p className="tx-8 leading-4 text-ds-frame">Stuck? Give up to see the answer.</p>
            <button
              type="button"
              // Inert during the final reveal (the game is already over), without fading, so the footer doesn't flicker.
              onClick={() => {
                if (game.canGiveUp) setGiveUpAsk(gameId)
              }}
              aria-disabled={!game.canGiveUp || undefined}
              title="Reveal the answer and end this game"
              className="ds-button bevel-paper h-11 shrink-0 whitespace-nowrap px-3 text-[9px] sm:px-4 sm:text-[10px]"
            >
              Give up
            </button>
          </div>
        </footer>
      )}

      {/* History opens from the result screen and hides it meanwhile; closing History brings the result back. */}
      {showResult && !showHistory && (
        <ResultModal
          mode={mode}
          target={game.targetPokemon}
          feedback={game.feedback}
          puzzleDate={game.gameKey}
          streak={stats.currentStreak}
          bestStreak={stats.bestStreak}
          hinted={game.hinted}
          gaveUp={game.gameStatus === 'lost'}
          shiny={shiny}
          onClose={() => setDismissedResult(gameId)}
          onHistory={() => setShowHistory(true)}
          onNewGame={mode === 'endless' ? game.startNewEndlessGame : undefined}
        />
      )}
      {capture && <CaptureScene key={capture.gameId} kind={capture.kind} pokemon={capture.pokemon} onDone={endCapture} />}
      {confetti && <Confetti onDone={endConfetti} />}
      {showGiveUp && (
        <GiveUpModal mode={mode} guesses={game.guesses.length} streak={stats.currentStreak} onConfirm={confirmGiveUp} onCancel={() => setGiveUpAsk(null)} />
      )}
      {showHistory && (
        <HistoryModal
          key={mode}
          history={game.history}
          endless={game.endlessRecord}
          endlessGames={game.endlessGames}
          initialMode={mode}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showGens && mode === 'endless' && (
        <GensModal
          // Mid-game the box only shows the Gens this game was drawn from; they can change once it is over.
          gens={game.inProgress ? game.gameGens : game.endlessGens}
          locked={game.inProgress}
          counts={GEN_COUNTS}
          gameStarted={game.guesses.length > 0}
          onSave={game.setEndlessGens}
          onClose={() => setShowGens(false)}
        />
      )}
      {hintPromptShown && (
        <HintPrompt
          key={gameId}
          gen={game.targetPokemon.generation}
          guesses={game.guesses.length}
          onTake={takeHint}
          onClose={closeHintPrompt}
        />
      )}
      {showTypesModal && (
        <TypeTrackerModal ruledOut={typeNotes.ruledOut} onToggle={typeNotes.toggle} onClear={typeNotes.clear} onClose={() => setTypesOpen(false)} />
      )}
      {showHelp && <HelpModal onClose={closeHelp} />}
    </div>
  )
}
