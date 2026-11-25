import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { FloatingBarApp } from './FloatingBarApp'

function detectFloatingBarMode(): boolean {
  if (typeof window === 'undefined') return false
  if (window.aiEnergy?.windowMode === 'floating-bar') return true
  if (window.location.hash === '#floating-bar') return true
  return new URLSearchParams(window.location.search).get('mode') === 'floating-bar'
}

const isFloatingBar = detectFloatingBarMode()
if (isFloatingBar && typeof document !== 'undefined') {
  document.documentElement.classList.add('floating-bar-mode')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isFloatingBar ? <FloatingBarApp /> : <App />}</StrictMode>
)
