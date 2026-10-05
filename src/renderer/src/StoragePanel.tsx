import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { EngineId } from '../../shared/types'
import type { StorageAction, StorageSnapshot } from '../../shared/storage'
import { decode, setAt, type Json, type JsonPath } from '../../shared/json'
import { engineLabel } from './engines'
import { JsonTree, type JsonSide } from './JsonTree'

type Section = 'cookies' | 'local' | 'session' | 'databases'

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** A value differs between engines: some have it and some don't, or they hold different values. */
const differs = (values: Partial<Record<EngineId, string>>, engines: EngineId[]) => new Set(engines.map((e) => values[e] ?? '\u0000')).size > 1

/**
 * A row's values as a tree, when every engine that has the row holds JSON (or every one a token).
 * edit: write a changed field back; only when every engine holds the same text, so an edit can't
 * quietly overwrite a difference.
 */
function structure(row: Row, engines: EngineId[]): { kind: 'JSON' | 'JWT'; sides: JsonSide[]; edit?: (path: JsonPath, value: Json) => StorageAction } | undefined {
  const decoded = engines.map((e) => (row.values[e] === undefined ? undefined : decode(row.values[e])))
  const first = decoded.find((d) => d)
  if (!first || engines.some((e, i) => row.values[e] !== undefined && decoded[i]?.kind !== first.kind)) return undefined
  const sides = engines.map((engine, i) => ({ engine, value: decoded[i]?.value }))
  if (differs(row.values, engines)) return { kind: first.kind, sides }
  const { encode } = first
  return { kind: first.kind, sides: sides.slice(0, 1), edit: encode && ((path, value) => row.save(encode(setAt(first.value, path, value)))) }
}

/** A row of any section, in one shape. */
interface Row {
  id: string
  name: string
  site: string
  values: Partial<Record<EngineId, string>>
  /** Small labels beside the name, with what they mean. */
  flags: [string, string][]
  /** The engine that set it (cookies): the others hold a copy. */
  from?: EngineId
  save: (value: string) => StorageAction
  remove: StorageAction
}

/**
 * What this window has stored, side by side per engine. Pick a kind on the left; rows that differ
 * between engines are marked, and can be shown alone. Click a row to read its values in full;
 * click a value to edit it in every engine.
 */
export function StoragePanel() {
  const [data, setData] = useState<StorageSnapshot | null>(null)
  const [section, setSection] = useState<Section>('cookies')
  const [filter, setFilter] = useState('')
  const [onlyDifferent, setOnlyDifferent] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  /** The value being edited: which row and engine, and its text. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const refresh = () => void window.swivel.storage().then((s) => s && setData(s))
  // Kept current while open: pages change their storage at any time.
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])
  const act = (action: StorageAction) => void window.swivel.storageAction(action).then(() => setTimeout(refresh, 150))

  if (!data) return <div className="storage" />
  const { engines } = data

  const cookieRows: Row[] = data.cookies.map((c) => ({
    id: c.key,
    name: c.name,
    site: c.domain.replace(/^\./, ''),
    values: c.values,
    flags: [
      ...(c.httpOnly ? [['HttpOnly', "The page's own scripts can't read this cookie"] as [string, string]] : []),
      ...(c.secure ? [['Secure', 'Only sent over HTTPS'] as [string, string]] : []),
      ...(c.expires ? [] : [['Session', 'Gone when the window closes: it has no expiry date'] as [string, string]])
    ],
    from: c.from,
    save: (value) => ({ type: 'set-cookie', key: c.key, value }),
    remove: { type: 'delete-cookie', key: c.key }
  }))
  const itemRows = (area: 'local' | 'session'): Row[] =>
    data.items
      .filter((i) => i.area === area)
      .map((i) => ({
        id: `${i.area}\n${i.origin}\n${i.key}`,
        name: i.key,
        site: i.origin.replace(/^https?:\/\//, ''),
        values: i.values,
        flags: [],
        save: (value) => ({ type: 'set-item', origin: i.origin, area: i.area, key: i.key, value }),
        remove: { type: 'delete-item', origin: i.origin, area: i.area, key: i.key }
      }))
  const rows: Record<Exclude<Section, 'databases'>, Row[]> = { cookies: cookieRows, local: itemRows('local'), session: itemRows('session') }
  const different = (list: Row[]) => list.filter((r) => differs(r.values, engines)).length

  const nav: [Section, string, number | null, number][] = [
    ['cookies', 'Cookies', rows.cookies.length, different(rows.cookies)],
    ['local', 'Local storage', rows.local.length, different(rows.local)],
    ['session', 'Session storage', rows.session.length, different(rows.session)],
    ['databases', 'Databases and caches', null, 0]
  ]

  const needle = filter.trim().toLowerCase()
  const list = section === 'databases' ? [] : rows[section]
  const shown = list.filter((r) => (!onlyDifferent || differs(r.values, engines)) && (!needle || r.name.toLowerCase().includes(needle) || r.site.toLowerCase().includes(needle)))

  /** One engine's value: click to edit it in every engine. */
  const cell = (row: Row, engine: EngineId): ReactNode => {
    const value = row.values[engine]
    const id = `${row.id}\n${engine}`
    if (editing?.id === id)
      return (
        <td key={engine}>
          <input
            autoFocus
            aria-label="Value"
            value={editing.text}
            onChange={(e) => setEditing({ id, text: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                act(row.save(editing.text))
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
          <button
            type="button"
            className="value"
            data-tip="Click to edit this value in every engine"
            onClick={(e) => {
              e.stopPropagation()
              setEditing({ id, text: value })
            }}
          >
            {value || '(empty)'}
          </button>
        )}
        {value !== undefined && row.from && row.from !== engine && (
          <span className="copied" data-tip={`${engineLabel(engine)} didn't set this cookie itself: it was copied from ${engineLabel(row.from)} by sign-in sharing`}>
            copied
          </span>
        )}
      </td>
    )
  }

  return (
    <div className="storage">
      <nav aria-label="Kinds of storage">
        {nav.map(([id, label, count, diff]) => (
          <button key={id} type="button" aria-current={section === id} onClick={() => setSection(id)}>
            <span className="label">{label}</span>
            {diff > 0 && (
              <span className="diff" data-tip={`${diff} ${diff === 1 ? 'differs' : 'differ'} between engines`}>
                {diff}
              </span>
            )}
            {count !== null && <span className="count">{count}</span>}
          </button>
        ))}
        <label className="share" data-tip="On: sign in on one frame and every engine is signed in (cookies are copied between engines). Off: each engine keeps its own cookies, to test how each really handles them.">
          <input type="checkbox" checked={data.sharing} onChange={(e) => act({ type: 'share', on: e.target.checked })} />
          Share sign-in across engines
        </label>
      </nav>

      <div className="storage-main">
        {!engines.length ? (
          <p className="empty">Open a page to see what it stores.</p>
        ) : section === 'databases' ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Engine</th>
                <th scope="col">Stored by the open site</th>
                <th scope="col">IndexedDB databases</th>
                <th scope="col">Caches</th>
              </tr>
            </thead>
            <tbody>
              {engines.map((e) => {
                const u = data.usage[e]
                return (
                  <tr key={e}>
                    <th scope="row">{engineLabel(e)}</th>
                    <td>{u ? size(u.bytes) : 'unknown'}</td>
                    <td className="wrap">{u?.databases.length ? u.databases.join(', ') : 'none'}</td>
                    <td className="wrap">{u?.caches.length ? u.caches.join(', ') : 'none'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <>
            <div className="panel-tools">
              <input type="search" aria-label="Filter by name or site" placeholder="Filter by name or site" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <label data-tip="Show only rows whose value isn't the same in every engine">
                <input type="checkbox" checked={onlyDifferent} onChange={(e) => setOnlyDifferent(e.target.checked)} />
                Differences only
              </label>
              <span className="spacer" />
              <span className="muted">{shown.length === list.length ? `${list.length} items` : `${shown.length} of ${list.length}`}</span>
              <button
                type="button"
                className="plain"
                data-tip={section === 'cookies' ? 'Delete every cookie in this window, in every engine' : 'Clear local and session storage on the open pages, in every engine'}
                disabled={!list.length}
                onClick={() => act({ type: section === 'cookies' ? 'clear-cookies' : 'clear-items' })}
              >
                {section === 'cookies' ? 'Clear cookies' : 'Clear storage'}
              </button>
            </div>
            {section === 'session' && <p className="note">Each frame has its own session storage; this shows each engine's first frame.</p>}
            {shown.length ? (
              <div className="storage-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className="name">
                        Name
                      </th>
                      <th scope="col" className="site">
                        Site
                      </th>
                      {engines.map((e) => (
                        <th key={e} scope="col">
                          {engineLabel(e)}
                        </th>
                      ))}
                      <th className="act" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => {
                      const tree = structure(row, engines)
                      return (
                        <Fragment key={row.id}>
                          <tr className={[differs(row.values, engines) && 'differs', open === row.id && 'open'].filter(Boolean).join(' ') || undefined} onClick={() => setOpen(open === row.id ? null : row.id)}>
                            <th scope="row" data-tip={open === row.id ? 'Click to shorten the values' : 'Click to show the values in full'}>
                              {row.name}
                              {[...row.flags, ...(tree ? [[tree.kind, tree.kind === 'JWT' ? 'A token (JWT): click to see it decoded' : 'Holds JSON: click to see it as a tree'] as [string, string]] : [])].map(([flag, meaning]) => (
                                <span key={flag} className="flag" data-tip={meaning}>
                                  {flag}
                                </span>
                              ))}
                            </th>
                            <td className="site">{row.site}</td>
                            {engines.map((e) => cell(row, e))}
                            <td className="act">
                              <button
                                type="button"
                                className="delete"
                                aria-label={`Delete ${row.name}`}
                                data-tip="Delete this in every engine"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  act(row.remove)
                                }}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                          {open === row.id && tree && (
                            <tr className="detail">
                              <td colSpan={engines.length + 3}>
                                <JsonTree sides={tree.sides} kind={tree.kind} onEdit={tree.edit && ((path, value) => act(tree.edit!(path, value)))} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">{list.length ? 'Nothing matches.' : section === 'cookies' ? 'No cookies.' : 'Nothing stored here by the open pages.'}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
