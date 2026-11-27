import { useId, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { PARTY_CONFIG } from '../../config/partyConfig.ts'
import { backspaceBox, boxesFrom, fullCode, hasRefusedLetter, pasteIntoBoxes, typeIntoBox, type BoxesChange } from '../codeBoxes.ts'
import { loadNickname, NICKNAME_MAX, nicknameError, normaliseNickname, saveNickname } from '../nickname.ts'

/**
 * The Party start screen: pick a nickname, then host a room or join one by its 4-letter code.
 *
 * Props (presentational: the room connection lives in the caller):
 * - `initialCode`: a valid code from the address (an invite link, /party/#KPZW). It fills the letter boxes and makes
 *   Join the main (red) action, with Host a room white below it.
 * - `busy`: a host or join request is on its way; the buttons are disabled and the pressed one says so.
 * - `error`: the last refusal in words ("That room is full."), shown above the buttons.
 * - `onHost(nickname)`: Host a room, with a valid, normalised nickname.
 * - `onJoin(code, nickname)`: Join, with all 4 letters (upper case, from PARTY_CONFIG.roomCodeAlphabet) and a valid,
 *   normalised nickname.
 * - `headingRef`: PartyApp focuses the heading when the screen changes.
 *
 * The nickname is checked here (1 to 12 letters, digits and spaces) and remembered for next time.
 */
export interface StartScreenProps {
  initialCode?: string
  busy: boolean
  error?: string
  onHost: (nickname: string) => void
  onJoin: (code: string, nickname: string) => void
  headingRef?: RefObject<HTMLHeadingElement | null>
}

export function StartScreen({ initialCode, busy, error, onHost, onJoin, headingRef }: StartScreenProps) {
  const [name, setName] = useState(loadNickname)
  // The name's problem shows once the player tries to go on, or straight away for a character a name can't hold.
  const [nameTried, setNameTried] = useState(false)
  const [boxes, setBoxes] = useState(() => boxesFrom(initialCode))
  const [codeTried, setCodeTried] = useState(false)
  const [refused, setRefused] = useState(false)
  const [pressed, setPressed] = useState<'host' | 'join' | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const boxRefs = useRef<(HTMLInputElement | null)[]>([])
  const nameId = useId()
  const codeId = useId()

  const nameProblem = nicknameError(name)
  const shownNameProblem = nameTried || (name.trim() !== '' && nameProblem !== 'Type a name first.') ? nameProblem : null
  const code = fullCode(boxes)
  const codeProblem = codeTried && !code ? `Type all ${PARTY_CONFIG.roomCodeLength} letters of the room code.` : null
  const codeHint = refused ? 'Room codes have no vowels and no L.' : null
  const joinFirst = initialCode !== undefined

  const checkName = (): string | null => {
    setNameTried(true)
    if (nameProblem) {
      nameRef.current?.focus()
      return null
    }
    const clean = normaliseNickname(name)
    saveNickname(clean)
    return clean
  }

  const host = () => {
    const nickname = checkName()
    if (!nickname) return
    setPressed('host')
    onHost(nickname)
  }

  const join = () => {
    setCodeTried(true)
    const nickname = checkName()
    if (!nickname) return
    if (!code) {
      boxRefs.current[boxes.findIndex((b) => b === '')]?.focus()
      return
    }
    setPressed('join')
    onJoin(code, nickname)
  }

  // Enter in the name box takes the main path: Join when the code came from a link or is typed in full, else Host.
  const submit = (e: FormEvent | KeyboardEvent) => {
    e.preventDefault()
    if (busy) return
    if (joinFirst || code) join()
    else host()
  }

  const apply = (change: BoxesChange, typed?: string) => {
    setBoxes(change.boxes)
    setRefused(typed !== undefined && hasRefusedLetter(typed))
    boxRefs.current[change.focus]?.focus()
  }

  const onBoxKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      apply(backspaceBox(boxes, i))
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      boxRefs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < boxes.length - 1) {
      e.preventDefault()
      boxRefs.current[i + 1]?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!busy) join()
    }
  }

  const onBoxPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text')
    apply(pasteIntoBoxes(boxes, i, text), text)
  }

  // The refusal shows beside the button that asked (Join's, or Host's: also the place for any other error).
  const errorFor = (which: 'host' | 'join') =>
    error && (pressed ?? (joinFirst ? 'join' : 'host')) === which ? (
      <p role="alert" className="tx-9 leading-4 text-ds-red-dark" data-testid="party-start-error">
        {error}
      </p>
    ) : null

  const hostButton = (
    <button
      type="button"
      onClick={host}
      disabled={busy}
      className={`ds-button h-11 w-full px-3 text-[10px] disabled:opacity-40 ${joinFirst ? 'bevel-paper text-ds-ink' : 'bevel-red text-ds-paper'}`}
    >
      {busy && pressed === 'host' ? 'Hosting…' : 'Host a room'}
    </button>
  )

  const joinGroup = (
    <div className="flex flex-col gap-1.5 sm:gap-2">
      <p id={codeId} className="tx-10 leading-5">
        {joinFirst ? 'Room code' : "Or join a friend's room"}
      </p>
      <div role="group" aria-labelledby={codeId} className="flex gap-1.5 sm:gap-2" data-testid="party-code-boxes">
        {boxes.map((letter, i) => (
          <input
            key={i}
            ref={(el) => {
              boxRefs.current[i] = el
            }}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={i === boxes.length - 1 ? 'go' : 'next'}
            aria-label={`Letter ${i + 1} of ${boxes.length}`}
            aria-invalid={codeProblem !== null && letter === ''}
            value={letter}
            disabled={busy}
            onFocus={(e) => e.target.select()}
            onChange={(e) => apply(typeIntoBox(boxes, i, e.target.value), e.target.value)}
            onKeyDown={onBoxKey(i)}
            onPaste={onBoxPaste(i)}
            // 16px stops iOS Safari zooming into the field; the focused box turns light blue (the caret shows too).
            className="ds-box h-11 w-11 shrink-0 p-0 text-center text-base uppercase outline-none [filter:none] focus:bg-ds-sky-bottom disabled:opacity-40"
          />
        ))}
      </div>
      {(codeProblem ?? codeHint) && (
        <p role="alert" className="tx-9 leading-4 text-ds-red-dark">
          {codeProblem ?? codeHint}
        </p>
      )}
      {errorFor('join')}
      <button
        type="button"
        onClick={join}
        disabled={busy}
        className={`ds-button h-11 w-full px-3 text-[10px] disabled:opacity-40 ${joinFirst ? 'bevel-red text-ds-paper' : 'bevel-paper text-ds-ink'}`}
      >
        {busy && pressed === 'join' ? 'Joining…' : 'Join'}
      </button>
    </div>
  )

  return (
    <section className="ds-box px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-start-title" data-screen="start">
      <h2 id="party-start-title" ref={headingRef} tabIndex={-1} className="mb-3 tx-11 leading-5 outline-none">
        {joinFirst ? `Join room ${initialCode}` : 'Party'}
      </h2>
      <p>
        {joinFirst
          ? 'Pick a name and join your friends. Take turns naming a Pokémon that fits the category.'
          : 'Take turns naming a Pokémon that fits the category before your timer runs out. The last player with lives wins.'}
      </p>
      <form noValidate onSubmit={submit} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <label htmlFor={nameId} className="tx-10 leading-5">
            Your name
          </label>
          {/* The search box's look: a dialog-box frame around a borderless input. */}
          <div className="ds-box flex items-center p-2 pl-4 [filter:none]">
            <input
              ref={nameRef}
              id={nameId}
              type="text"
              autoComplete="nickname"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              value={name}
              disabled={busy}
              aria-invalid={shownNameProblem !== null}
              aria-describedby={`${nameId}-rule`}
              placeholder="Ash"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit(e)}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[11px] placeholder:text-ds-frame sm:text-xs"
            />
          </div>
          <p id={`${nameId}-rule`} role={shownNameProblem ? 'alert' : undefined} className={`tx-9 leading-4 ${shownNameProblem ? 'text-ds-red-dark' : 'text-ds-frame'}`}>
            {shownNameProblem ?? `Up to ${NICKNAME_MAX} letters, digits and spaces.`}
          </p>
        </div>
        {joinFirst ? (
          <>
            {joinGroup}
            <div className="flex flex-col gap-1.5 sm:gap-2">
              <p className="tx-10 leading-5">Or start your own room</p>
              {errorFor('host')}
              {hostButton}
            </div>
          </>
        ) : (
          <>
            {error && pressed !== 'join' ? (
              <div className="flex flex-col gap-1.5 sm:gap-2">
                {errorFor('host')}
                {hostButton}
              </div>
            ) : (
              hostButton
            )}
            {joinGroup}
          </>
        )}
      </form>
    </section>
  )
}
