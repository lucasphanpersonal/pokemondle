import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/press-start-2p/latin-400.css'
import '../index.css'
import { applyBigText, applyCrt, isBigText, isCrtOn } from '../lib/display'
import { PartyApp } from './PartyApp.tsx'

// Entry of the Party page (party/index.html, served at /party/). It has its own bundle, so Daily and Endless don't grow.
applyCrt(isCrtOn())
applyBigText(isBigText())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PartyApp />
  </StrictMode>,
)
