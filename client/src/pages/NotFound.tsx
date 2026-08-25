import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main className="screen-message">
      <h1>Página não encontrada</h1>
      <p>
        <Link to="/">Voltar ao início</Link>
      </p>
    </main>
  )
}
