import { Route, Routes } from 'react-router-dom'
import { Broadcaster } from './pages/Broadcaster'
import { Landing } from './pages/Landing'
import { NotFound } from './pages/NotFound'
import { Viewer } from './pages/Viewer'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/b/:roomId" element={<Broadcaster />} />
      <Route path="/watch/:roomId" element={<Viewer />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
