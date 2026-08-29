import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../app/globals.css'
import '../../app/studio.css'
import '../../app/tikz-studio.css'
import { TikzStudio } from '../../components/tikz-studio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="math-shell">
      <TikzStudio
        startOpen
        staticPreview
        homeHref={import.meta.env.BASE_URL}
      />
    </main>
  </StrictMode>,
)
