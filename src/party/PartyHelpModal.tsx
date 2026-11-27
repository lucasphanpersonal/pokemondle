import { DisplaySettings, FanProjectNote } from '../components/HelpSections'
import { Modal } from '../components/Modal'
import { PARTY_CONFIG } from '../config/partyConfig.ts'

interface PartyHelpModalProps {
  onClose: () => void
}

/**
 * Party's Help: the rules in short, then the same Display & sound settings as the main Help.
 * Placeholder wording from the design's Game rules; task 12 finalises it.
 */
export function PartyHelpModal({ onClose }: PartyHelpModalProps) {
  return (
    <Modal title="How to play Party" onClose={onClose}>
      <div className="space-y-4 tx-10 leading-5">
        <p>
          {PARTY_CONFIG.minPlayers} to {PARTY_CONFIG.maxPlayers} friends take turns naming a Pokémon that fits the
          category everyone can see, like <strong>Fire type</strong> or <strong>Fire type, Stage 2</strong>.
        </p>
        <ul className="space-y-2">
          <li>
            Your turn has a timer. A valid answer passes the turn: it must fit every part of the category, and nobody may
            have named that species this round.
          </li>
          <li>A wrong answer only costs time. Try again until the timer runs out.</li>
          <li>Run out of time and you lose a life. A new category starts, and you go first.</li>
          <li>If everyone answers, the round is cleared and the next category is harder.</li>
          <li>Forms count (Alolan Ninetales is an Ice type), one per species each round.</li>
          <li>Everyone starts with {PARTY_CONFIG.livesDefault} lives. The last player with lives left wins.</li>
        </ul>
      </div>
      <DisplaySettings />
      <FanProjectNote />
    </Modal>
  )
}
