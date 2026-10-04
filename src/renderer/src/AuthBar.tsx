import { useEffect, useState, type FormEvent } from 'react'

interface Question {
  id: number
  site: string
  retry: boolean
}

/**
 * A site asks for a username and password (HTTP authentication, e.g. a staging site behind
 * .htaccess). Asked once for the window: every frame signs in with the answer. It's kept in
 * memory only, and forgotten with the window's data.
 */
export function AuthBar() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  useEffect(() => window.swivel.on('auth', (q) => setQuestions((all) => [...all, q])), [])

  const question = questions[0]
  if (!question) return null

  const answer = (credentials: { username: string; password: string } | null) => {
    window.swivel.answerAuth(question.id, credentials)
    setQuestions((all) => all.slice(1))
    setPassword('')
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    answer({ username, password })
  }

  return (
    <form className="authbar" onSubmit={onSubmit} onKeyDown={(e) => e.key === 'Escape' && answer(null)}>
      <span>
        {question.retry && <span className="retry">That wasn't accepted. </span>}
        Sign in to <strong>{question.site}</strong>
      </span>
      <input autoFocus aria-label="Username" placeholder="Username" autoComplete="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
      <input aria-label="Password" placeholder="Password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Sign in</button>
      <button type="button" onClick={() => answer(null)}>
        Cancel
      </button>
    </form>
  )
}
