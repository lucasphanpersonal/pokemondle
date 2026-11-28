import type { ReactNode } from 'react'
import { DisplaySettings, FanProjectNote } from '../components/HelpSections'
import { Modal } from '../components/Modal'
import { PARTY_CONFIG, PARTY_TIERS } from '../config/partyConfig.ts'

interface PartyHelpModalProps {
  onClose: () => void
}

/** One part of the rules: a small heading and its sentences. */
function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 tx-11 leading-5">{title}</h3>
      {children}
    </section>
  )
}

const TIER_NAMES = PARTY_TIERS.map((t) => t.name).join(', ')

/**
 * Party's Help: the rules in plain words (hosting and joining, turns, what costs time and what costs a life, laps,
 * winning, Play again), then the same Display & sound settings as the main Help. The numbers come from partyConfig.ts,
 * so the text follows any tuning.
 */
export function PartyHelpModal({ onClose }: PartyHelpModalProps) {
  const { minPlayers, maxPlayers, livesMin, livesMax, livesDefault } = PARTY_CONFIG
  return (
    <Modal title="How to play Party" onClose={onClose}>
      <div className="space-y-4 tx-10 leading-5">
        <p>
          Pokémondle Party is a game for {minPlayers} to {maxPlayers} friends. Take turns naming a Pokémon that fits the
          category on screen, like <strong>Fire type</strong> or <strong>Fire type, Stage 2</strong>, before your time
          runs out.
        </p>
        <Rule title="Host or join">
          <p>
            One player types a name and taps <strong>Host a room</strong>. The room gets a 4-letter code. Friends open the
            invite link the host copies for them, or come to this page and type the code in the four boxes, then pick a
            name and tap <strong>Join</strong>.
          </p>
          <p className="mt-2">
            The host picks the starting lives ({livesMin} to {livesMax}, {livesDefault} if left alone) and the starting
            tier, then taps <strong>Start</strong>.
          </p>
        </Rule>
        <Rule title="Your turn">
          <p>
            Players take turns in the order shown at the top. On your turn your timer runs and your search box opens. Name a
            Pokémon that fits every part of the category and that nobody has named this round. A good answer passes the
            turn to the next player.
          </p>
          <p className="mt-2">Forms count (Alolan Ninetales is an Ice type), but only one per species each round.</p>
        </Rule>
        <Rule title="Wrong answers and time">
          <ul className="space-y-2">
            <li>A wrong answer only costs time. The box says why it didn't fit, and you can try again.</li>
            <li>
              If your time runs out, you lose a life and the category changes. You start the new one. With no lives left
              you're out and watch the rest.
            </li>
          </ul>
        </Rule>
        <Rule title="Clearing a round">
          <p>
            If everyone answers in turn and the round comes back around, it's cleared: nobody loses a life and the next
            category is harder ({TIER_NAMES}).
          </p>
        </Rule>
        <Rule title="Winning">
          <p>
            The last player with lives left wins. The host can tap <strong>Play again</strong> for a new game with the same
            room and players, or anyone can <strong>Leave</strong>.
          </p>
        </Rule>
      </div>
      <DisplaySettings />
      <FanProjectNote />
    </Modal>
  )
}
