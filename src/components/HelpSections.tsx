import { useId, useState } from 'react'
import { isBigText, isCrtOn, setBigText, setCrt } from '../lib/display'
import { VolumeBars } from './VolumeControl'

/*
 * Help dialog sections shared by the main game's Help and the Party page's Help: Display & sound, the pixel on/off
 * switch, and the fan-project note that ends both dialogs.
 */

/** A labelled pixel on/off switch. */
export function PixelSwitch({ label, on, disabled, describedBy, onToggle }: {
  label: string
  on: boolean
  disabled?: boolean
  describedBy?: string
  onToggle: () => void
}) {
  const labelId = useId()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onToggle}
      className={`ds-focus mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left ${disabled ? 'cursor-not-allowed opacity-75' : ''}`}
    >
      <span id={labelId}>{label}</span>
      <span className="flex items-center gap-2" aria-hidden="true">
        <span>{on ? 'ON' : 'OFF'}</span>
        <span
          className={`flex h-6 w-11 items-center border-2 border-ds-frame px-0.5 ${on ? 'justify-end bg-fb-match' : 'justify-start bg-ds-paper'}`}
        >
          <span className="h-4 w-4 bg-ds-frame" />
        </span>
      </span>
    </button>
  )
}

export function DisplaySettings() {
  const [crt, setCrtState] = useState(isCrtOn)
  const [bigText, setBigTextState] = useState(isBigText)
  return (
    <section className="mt-5 border-t-2 border-ds-frame-light pt-4 tx-10 leading-5">
      <h3 className="mb-2 tx-11">Display &amp; sound</h3>
      <PixelSwitch
        label="CRT screen effect"
        on={crt}
        onToggle={() => {
          setCrt(!crt)
          setCrtState(!crt)
        }}
      />
      <p className="mt-1 tx-9 text-ds-frame">Scanlines and a soft glow, like an old handheld.</p>
      <PixelSwitch
        label="Larger text"
        on={bigText}
        onToggle={() => {
          setBigText(!bigText)
          setBigTextState(!bigText)
        }}
      />
      <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
        <span>Volume</span>
        <VolumeBars />
      </div>
    </section>
  )
}

/** The closing note of every Help dialog. */
export function FanProjectNote() {
  return (
    <p className="mt-5 border-t-2 border-ds-frame-light pt-4 tx-9 leading-4 text-ds-frame">
      Pokémondle is an unofficial fan project. It is not affiliated with, endorsed or sponsored by Nintendo, Game Freak or The
      Pokémon Company. Pokémon and all related names are trademarks of their respective owners.
    </p>
  )
}
