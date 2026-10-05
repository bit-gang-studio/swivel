import { useState, type ReactNode } from 'react'
import type { EngineId } from '../../shared/types'
import { matches, merge, pathText, timestamp, typed, type Json, type JsonNode, type JsonPath } from '../../shared/json'
import { engineLabel } from './engines'

/** One engine's value. With several, the tree shows them merged and marks where they differ. */
export interface JsonSide {
  engine?: EngineId
  value: Json | undefined
}

/** Children shown under one key before the rest are folded away. */
const MOST = 200

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

const copyText = (value: Json) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
const typeOf = (value: Json) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)
const count = (node: JsonNode): number => 1 + (node.children?.reduce((n, c) => n + count(c), 0) ?? 0)

function Value({ value }: { value: Json }) {
  const at = timestamp(value)
  return (
    <>
      <span className={`value ${typeOf(value)}`}>{JSON.stringify(value)}</span>
      {at !== undefined && (
        <span className="hint" data-tip="This number reads as a date">
          {new Date(at).toLocaleString()}
        </span>
      )}
    </>
  )
}

/**
 * A value as a tree: fold and unfold, search keys and values, copy a value or its path. Numbers
 * that are dates say so, and text that holds JSON or a token opens like any other branch. Given
 * several engines' values, shows one tree with the differences marked. onEdit: a field was changed.
 */
export function JsonTree({ sides, kind, onEdit }: { sides: JsonSide[]; kind?: 'JSON' | 'JWT'; onEdit?: (path: JsonPath, value: Json) => void }) {
  /** Branches folded or unfolded by hand, by path. */
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [onlyDifferent, setOnlyDifferent] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [copied, setCopied] = useState('')

  const root = merge(sides.map((s) => s.value))
  const several = sides.length > 1
  const needle = search.trim().toLowerCase()
  const big = count(root) > 12

  const copyButton = (id: string, label: string, tip: string, text: string) => (
    <button
      type="button"
      className="copy"
      data-tip={tip}
      onClick={(e) => {
        e.stopPropagation()
        void copy(text)
        setCopied(id)
        setTimeout(() => setCopied((now) => (now === id ? '' : now)), 1200)
      }}
    >
      {copied === id ? 'Copied' : label}
    </button>
  )

  function rows(node: JsonNode, depth: number, locked: boolean): ReactNode {
    if (onlyDifferent && node.same) return null
    if (!matches(node, needle)) return null
    const id = JSON.stringify(node.path)
    const key = node.path[node.path.length - 1]
    const first = node.values.find((v) => v !== undefined) as Json
    const pad = { paddingLeft: 8 + depth * 14 }
    const name = (
      <span className="key" data-tip={pathText(node.path)}>
        {key}
      </span>
    )
    const path = copyButton(`${id}:path`, 'Path', `Copy the path: ${pathText(node.path)}`, pathText(node.path))
    const marked = several && !node.same ? 'json-row differs' : 'json-row'

    if (node.children) {
      // Open by default: the top level, anything that differs, and whatever a search found.
      const open = (depth < 1 || (several && !node.same) || !!needle) !== toggled.has(id)
      const shown = node.children.slice(0, MOST)
      return (
        <div key={id} role="treeitem" aria-expanded={open}>
          <div
            className={marked}
            style={pad}
            onClick={() => {
              const next = new Set(toggled)
              if (!next.delete(id)) next.add(id)
              setToggled(next)
            }}
          >
            <span className="twist" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {name}
            <span className="summary">{node.kind === 'array' ? `[${node.children.length}]` : `{${node.children.length}}`}</span>
            {node.decoded && (
              <span className="flag" data-tip={node.decoded === 'JWT' ? 'A token (JWT), decoded: its header and payload' : 'Text that holds JSON, opened'}>
                {node.decoded}
              </span>
            )}
            <span className="actions">
              {node.same && copyButton(`${id}:value`, 'Copy', 'Copy this value', copyText(first))}
              {path}
            </span>
          </div>
          {open && (
            <div role="group">
              {shown.map((child) => rows(child, depth + 1, locked || !!node.decoded))}
              {node.children.length > MOST && (
                <div className="json-row more" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                  … {node.children.length - MOST} more
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    if (several && !node.same)
      return (
        <div key={id} role="treeitem" className={marked} style={pad}>
          <span className="twist" aria-hidden="true" />
          {name}
          <span className="actions">{path}</span>
          {sides.map((side, i) => (
            <div key={i} className="side">
              <span className={`tag ${side.engine}`}>{side.engine ? engineLabel(side.engine) : i + 1}</span>
              {node.values[i] === undefined ? <span className="missing">not set</span> : <Value value={node.values[i] as Json} />}
            </div>
          ))}
        </div>
      )

    const editable = onEdit && !locked
    return (
      <div key={id} role="treeitem" className={marked} style={pad}>
        <span className="twist" aria-hidden="true" />
        {name}
        {editing?.id === id ? (
          <input
            autoFocus
            aria-label={`New value for ${pathText(node.path)}`}
            value={editing.text}
            onChange={(e) => setEditing({ id, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onEdit?.(node.path, typed(editing.text))
                setEditing(null)
              } else if (e.key === 'Escape') setEditing(null)
            }}
            onBlur={() => setEditing(null)}
          />
        ) : editable ? (
          <button type="button" className="edit" data-tip="Click to change this field in every engine" onClick={() => setEditing({ id, text: JSON.stringify(first) })}>
            <Value value={first} />
          </button>
        ) : (
          <Value value={first} />
        )}
        <span className="actions">
          {copyButton(`${id}:value`, 'Copy', 'Copy this value', copyText(first))}
          {path}
        </span>
      </div>
    )
  }

  const body = root.children?.map((child) => rows(child, 0, kind === 'JWT')).filter(Boolean) ?? []
  return (
    <div className="json-tree" onClick={(e) => e.stopPropagation()}>
      {(big || (several && !root.same)) && (
        <div className="json-tools">
          {big && <input type="search" aria-label="Search keys and values" placeholder="Search keys and values" value={search} onChange={(e) => setSearch(e.target.value)} />}
          {several && !root.same && (
            <label data-tip="Show only the fields that aren't the same in every engine">
              <input type="checkbox" checked={onlyDifferent} onChange={(e) => setOnlyDifferent(e.target.checked)} />
              Differences only
            </label>
          )}
        </div>
      )}
      <div role="tree" aria-label={kind === 'JWT' ? 'Decoded token' : 'JSON'}>
        {body.length ? body : <div className="json-row more">{root.children?.length ? 'Nothing matches.' : root.kind === 'array' ? '[] (empty)' : '{} (empty)'}</div>}
      </div>
    </div>
  )
}
