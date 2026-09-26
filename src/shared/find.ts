export interface FindRequest {
  text: string
  /** Search backwards (Shift+Enter). */
  backwards: boolean
  /** A new search: start from the top instead of the current match. */
  restart: boolean
}

export interface FindResult {
  matches: number
  /** 1-based index of the current match, 0 if none. */
  active: number
}

/**
 * Runs inside the page (it must stay self-contained): finds every visible match, selects the
 * next or previous one and scrolls it into view. Matches are cached on window, so stepping
 * through them doesn't rescan; a MutationObserver marks the cache stale when the page changes.
 * Only text that contains the search pays for a visibility (layout) check. Works the same in
 * every engine (window.find skips some text, such as button labels, in Firefox).
 * An empty text clears the search.
 */
export function findInPage({ text, backwards, restart }: FindRequest): FindResult {
  type Hit = [Text, number]
  type State = { text: string; index: number; hits: Hit[]; stale: boolean; observer?: MutationObserver }
  const w = window as unknown as { __swivelFind?: State }
  const state = (w.__swivelFind ??= { text: '', index: -1, hits: [], stale: true })
  if (!state.observer) {
    state.observer = new MutationObserver(() => (state.stale = true))
    state.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  }
  const selection = getSelection()
  if (!text) {
    selection?.removeAllRanges()
    state.text = ''
    state.index = -1
    state.hits = []
    return { matches: 0, active: 0 }
  }

  if (text !== state.text || state.stale) {
    // Our own selection changes don't mutate the DOM, so the cache stays valid while stepping.
    const needle = text.toLowerCase()
    const hits: Hit[] = []
    const visible = new Map<Element, boolean>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const hay = node.data.toLowerCase()
      let i = hay.indexOf(needle)
      if (i === -1) continue
      const el = node.parentElement
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
      let shown = visible.get(el)
      if (shown === undefined) {
        shown = el.getClientRects().length > 0 // Matches browsers' own find better than checkVisibility().
        visible.set(el, shown)
      }
      if (!shown) continue
      for (; i !== -1; i = hay.indexOf(needle, i + needle.length)) hits.push([node, i])
    }
    const sameText = text === state.text
    state.hits = hits
    state.stale = false
    state.text = text
    if (!sameText) restart = true
  }

  const hits = state.hits
  if (!hits.length) {
    selection?.removeAllRanges()
    state.index = -1
    return { matches: 0, active: 0 }
  }
  if (restart || state.index < 0) state.index = backwards ? hits.length - 1 : 0
  else state.index = (Math.min(state.index, hits.length - 1) + (backwards ? -1 : 1) + hits.length) % hits.length
  const [node, offset] = hits[state.index]
  const range = document.createRange()
  range.setStart(node, offset)
  range.setEnd(node, offset + text.length)
  selection?.removeAllRanges()
  selection?.addRange(range)
  const box = range.getBoundingClientRect()
  if (box.top < 0 || box.bottom > innerHeight) window.scrollBy({ top: box.top - innerHeight / 2 })
  return { matches: hits.length, active: state.index + 1 }
}
