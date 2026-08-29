import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../app/globals.css'
import '../../app/studio.css'
import { MathStudio } from '../../components/math-studio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="math-shell">
      <MathStudio
        startOpen
        staticPreview
        homeHref={import.meta.env.BASE_URL}
      />
    </main>
  </StrictMode>,
)
