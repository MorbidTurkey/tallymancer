import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
import SessionPage from './pages/SessionPage.jsx'

export default function App() {
  return (
    // BrowserRouter uses the HTML5 History API (clean URLs like /session/abc).
    // This requires the server to serve index.html for all routes — Vite handles
    // this in dev, and Traefik/Nginx can be configured to do so in production.
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {/*
          :token is the UUID from the share link.
          The same route handles both player and audience tokens —
          the role is determined by what the WebSocket server tells us.
        */}
        <Route path="/session/:token" element={<SessionPage />} />
      </Routes>
    </BrowserRouter>
  )
}
