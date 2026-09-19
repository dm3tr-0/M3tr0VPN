import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// JetBrains Mono (веса, используемые в UI)
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'

import './assets/global.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
