import { useEffect, useState } from 'react'
import type { EngineId } from '../../shared/types'
import type { StorageAction, StorageSnapshot, StoredCookie, StoredItem } from '../../shared/storage'
import { engineLabel } from './engines'

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** A value differs between engines: some have it and some don't, or they hold different values. */
const differs = (values: Partial<Record<EngineId, string>>, engines: EngineId[]) => new Set(engines.map((e) => values[e] ?? '\u0000')).size > 1

/**
 * What this window has stored, side by side per engine: cookies, local storage and session
 * storage, with database and cache sizes. Rows that differ between engines are marked. A value
 * can be edited or deleted in every engine at once.
 */
export function StoragePanel() {
  const [data, setData] = useState<StorageSnapshot | null>(null)
  /** The value being edited: which row, and its text. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const refresh = () => void window.swivel.storage().then((s) => s && setData(s))
  // Kept current while open: pages change their storage at any time.
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])
  const act = (action: StorageAction) => void window.swivel.storageAction(action).then(() => setTimeout(refresh, 150))

  if (!data) return <section className="storage" aria-label="Storage" />
  const { engines } = data
  const locals = data.items.filter((i) => i.area === 'local')
  const sessions = data.items.filter((i) => i.area === 'session')

  /** One engine's value in a row: click to edit it everywhere. */
  const cell = (id: string, engine: EngineId, value: string | undefined, save: (text: string) => void, copied = false) => {
    if (editing?.id === `${id}\n${engine}`)
      return (
        <td key={engine}>
          <input
            autoFocus
            aria-label="Value"
            value={editing.text}
            onChange={(e) => setEditing({ id: editing.id, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                save(editing.text)
                setEditing(null)
              } else if (e.key === 'Escape') setEditing(null)
            }}
            onBlur={() => setEditing(null)}
          />
        </td>
      )
    return (
      <td key={engine} className={value === undefined ? 'missing' : undefined}>
        {value === undefined ? (
          'not set'
        ) : (
          <button type="button" className="value" data-tip="Click to edit this value in every engine" onClick={() => setEditing({ id: `${id}\n${engine}`, text: value })}>
            {value || '(empty)'}
          </button>
        )}
        {copied && (
          <span className="copied" data-tip="This engine didn't set this cookie itself: it was copied here by sign-in sharing">
            copied
          </span>
        )}
      </td>
    )
  }

  const cookieRow = (c: StoredCookie) => (
    <tr key={c.key} className={differs(c.values, engines) ? 'differs' : undefined}>
      <th scope="row">
        {c.name}
        {c.httpOnly && (
          <span className="flag" data-tip="HttpOnly: the page's own scripts can't read this cookie">
            HttpOnly
          </span>
        )}
      </th>
      <td className="site">{c.domain.replace(/^\./, '')}</td>
      {engines.map((e) => cell(c.key, e, c.values[e], (value) => act({ type: 'set-cookie', key: c.key, value }), !!c.from && c.from !== e && c.values[e] !== undefined))}
      <td>
        <button type="button" className="delete" aria-label={`Delete cookie ${c.name}`} data-tip="Delete this cookie in every engine" onClick={() => act({ type: 'delete-cookie', key: c.key })}>
          ×
        </button>
      </td>
    </tr>
  )

  const itemRow = (i: StoredItem) => {
    const id = `${i.area}\n${i.origin}\n${i.key}`
    return (
      <tr key={id} className={differs(i.values, engines) ? 'differs' : undefined}>
        <th scope="row">{i.key}</th>
        <td className="site">{i.origin.replace(/^https?:\/\//, '')}</td>
        {engines.map((e) => cell(id, e, i.values[e], (value) => act({ type: 'set-item', origin: i.origin, area: i.area, key: i.key, value })))}
        <td>
          <button type="button" className="delete" aria-label={`Delete ${i.key}`} data-tip="Delete this item in every engine" onClick={() => act({ type: 'delete-item', origin: i.origin, area: i.area, key: i.key })}>
            ×
          </button>
        </td>
      </tr>
    )
  }

  const table = (title: string, rows: React.ReactNode[], empty: string, note?: string) => (
    <>
      <h3>
        {title} <span className="count">{rows.length}</span>
        {note && <span className="note">{note}</span>}
      </h3>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Site</th>
              {engines.map((e) => (
                <th key={e} scope="col">
                  {engineLabel(e)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </>
  )

  return (
    <section className="storage" aria-label="Storage">
      <header>
        <h2>Storage</h2>
        <label data-tip="On: sign in on one frame and every engine is signed in (cookies are copied between engines). Off: each engine keeps its own cookies, to test how each really handles them.">
          <input type="checkbox" checked={data.sharing} onChange={(e) => act({ type: 'share', on: e.target.checked })} />
          Share sign-in across engines
        </label>
        <span className="spacer" />
        <button type="button" data-tip="Delete every cookie in this window, in every engine" disabled={!data.cookies.length} onClick={() => act({ type: 'clear-cookies' })}>
          Clear cookies
        </button>
        <button type="button" data-tip="Clear local and session storage on the open pages, in every engine" disabled={!data.items.length} onClick={() => act({ type: 'clear-items' })}>
          Clear storage
        </button>
      </header>
      {!engines.length && <p className="empty">Open a page to see what it stores.</p>}
      {engines.length > 0 && (
        <>
          {table('Cookies', data.cookies.map(cookieRow), 'No cookies.')}
          {table('Local storage', locals.map(itemRow), 'Nothing in local storage on the open pages.')}
          {table('Session storage', sessions.map(itemRow), 'Nothing in session storage on the open pages.', "Each frame has its own; this shows each engine's first frame.")}
          <h3>Databases and caches</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">Engine</th>
                <th scope="col">Stored by this site</th>
                <th scope="col">IndexedDB</th>
                <th scope="col">Cache storage</th>
              </tr>
            </thead>
            <tbody>
              {engines.map((e) => {
                const u = data.usage[e]
                return (
                  <tr key={e}>
                    <th scope="row">{engineLabel(e)}</th>
                    <td>{u ? size(u.bytes) : 'unknown'}</td>
                    <td>{u?.databases.length ? u.databases.join(', ') : 'none'}</td>
                    <td>{u?.caches.length ? u.caches.join(', ') : 'none'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
