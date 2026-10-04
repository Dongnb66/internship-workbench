import { reportDiag } from './lib/diag'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 手机版式诊断（?diag=1 时才做事；见 src/lib/diag.ts）
setTimeout(reportDiag, 2500)
