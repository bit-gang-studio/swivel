import { useEffect, useRef, useState } from 'react'

/** Find in page. Enter: next, Shift+Enter: previous, Esc: close. */
export function FindBar({ onClose, focusToken }: { onClose: () => void; focusToken: number }) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState({ matches: 0, active: 0 })

  useEffect(() => window.swivel.on('find', setResult), [])
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusToken])

  // Search as you type.
  useEffect(() => {
    const t = setTimeout(() => void window.swivel.find({ text, backwards: false, restart: true }), 120)
    return () => clearTimeout(t)
  }, [text])

  // Clear highlights when the bar closes.
  useEffect(() => () => void window.swivel.find({ text: '', backwards: false, restart: true }), [])

  const step = (backwards: boolean) => void window.swivel.find({ text, backwards, restart: false })

  useEffect(() => {
    const onCommand = (c: string) => {
      if (c === 'find-next') step(false)
      if (c === 'find-previous') step(true)
    }
    return window.swivel.on('command', onCommand)
  })

  return (
    <div className="findbar" role="search">
      <label className="find-input">
        <span className="sr-only">Find in page</span>
        <input
          ref={input}
          value={text}
          placeholder="Find in page"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey)
            if (e.key === 'Escape') onClose()
          }}
        />
      </label>
      <span className="find-count" aria-live="polite">
        {text ? `${result.active}/${result.matches}` : ''}
      </span>
      <button type="button" className="icon" aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => step(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>
      </button>
      <button type="button" className="icon" aria-label="Next match" title="Next (Enter)" onClick={() => step(false)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <button type="button" className="icon" aria-label="Close find" title="Close (Esc)" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
