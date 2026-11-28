import type { CSSProperties, RefObject } from 'react'
import { partLabel } from '../../lib/party/categories.ts'
import type { Category, Part } from '../../lib/party/types.ts'
import { TYPE_LABELS, type TypeName } from '../../lib/typeNotes.ts'
import { sortedParts, tierName } from '../game.ts'

/** Swatches for the colour part, from the Pokédex colour names (the name is written beside it too). */
const COLOR_SWATCH: Record<string, string> = {
  Black: '#303030',
  Blue: '#3070e0',
  Brown: '#a06830',
  Gray: '#a0a0a8',
  Green: '#40a040',
  Pink: '#f090c0',
  Purple: '#9050c0',
  Red: '#e03030',
  White: '#f8f8f8',
  Yellow: '#f0d030',
}

/** A type drawn like the Type tracker's labels: the type's colour with its short all-caps name in shadowed white. */
function TypeChip({ type }: { type: string }) {
  const label = TYPE_LABELS[type as TypeName]
  return (
    <span className="type-label-cell w-24 shrink-0" aria-hidden="true">
      <span
        style={{ '--face': label?.face ?? '#a8a878' } as CSSProperties}
        className="bevel type-label flex h-11 w-full items-center justify-center px-2.5 leading-none"
      >
        {label?.label ?? type.toUpperCase()}
      </span>
    </span>
  )
}

/** A white chip with the part's words ("Stage 2", "Gen 4", "Levitate"), and a swatch for a colour. */
function WordChip({ text, swatch }: { text: string; swatch?: string }) {
  return (
    <span aria-hidden="true" className="bevel bevel-paper inline-flex min-h-11 items-center gap-2 px-2.5 py-1 tx-10 leading-4">
      {swatch && <span className="inline-block h-3 w-3 shrink-0 border-2 border-ds-ink" style={{ background: swatch }} />}
      {text}
    </span>
  )
}

/** One part of the category as its chip(s). A pure type is "PURE" + the type; a pair is both types. */
function PartChip({ part }: { part: Part }) {
  const label = partLabel(part)
  let body
  switch (part.kind) {
    case 'type':
      body = <TypeChip type={part.value} />
      break
    case 'pure':
      body = (
        <>
          <WordChip text="Pure" />
          <TypeChip type={part.value} />
        </>
      )
      break
    case 'pair':
      body = (
        <>
          <TypeChip type={part.value[0]} />
          <TypeChip type={part.value[1]} />
        </>
      )
      break
    case 'color':
      body = <WordChip text={label} swatch={COLOR_SWATCH[part.value]} />
      break
    default:
      body = <WordChip text={label} />
  }
  return (
    <li className="flex items-center gap-1.5 sm:gap-2" data-part={part.kind}>
      <span className="sr-only">{label}</span>
      {body}
    </li>
  )
}

interface CategoryCardProps {
  category: Category
  tier: string
  round: number
  left: number
  headingRef?: RefObject<HTMLHeadingElement | null>
}

/** The category in the middle of the screen: tier and round, the parts as chips, and how many answers are left. */
export function CategoryCard({ category, tier, round, left, headingRef }: CategoryCardProps) {
  return (
    <section className="ds-box flex flex-col gap-3 px-3 py-3 text-center tx-10 leading-5 sm:px-5" aria-labelledby="party-category-title" data-testid="party-category">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="party-category-title" ref={headingRef} tabIndex={-1} className="text-left tx-10 leading-5 outline-none">
          <span className="whitespace-nowrap">Round {round}</span> <span className="whitespace-nowrap text-ds-frame">· {tierName(tier)}</span>
        </h2>
        <p className="ml-auto whitespace-nowrap tx-10 leading-5" data-testid="party-left">
          {left} left
        </p>
      </div>
      <ul className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2" aria-label="Category">
        {sortedParts(category).map((part, i) => (
          <PartChip key={i} part={part} />
        ))}
      </ul>
    </section>
  )
}
