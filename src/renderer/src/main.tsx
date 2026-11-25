import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { FloatingBarApp } from './FloatingBarApp'

const isFloatingBar =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mode') === 'floating-bar'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isFloatingBar ? <FloatingBarApp /> : <App />}</StrictMode>
)
