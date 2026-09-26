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
 * Runs inside the page (it must stay self-contained): finds every match, selects the next or
 * previous one and scrolls it into view. The current match index is kept on window, so it works
 * the same in every engine (window.find skips some text, such as button labels, in Firefox).
 * An empty text clears the search.
 */
export function findInPage({ text, backwards, restart }: FindRequest): FindResult {
  const state = ((window as unknown as { __swivelFind?: { text: string; index: number } }).__swivelFind ??= { text: '', index: -1 })
  const selection = getSelection()
  if (!text) {
    selection?.removeAllRanges()
    state.text = ''
    state.index = -1
    return { matches: 0, active: 0 }
  }
  const needle = text.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    // Skip text nobody can see.
    acceptNode: (n) => {
      const el = n.parentElement
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) return NodeFilter.FILTER_REJECT
      return el.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const hay = (node.nodeValue ?? '').toLowerCase()
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + needle.length)
      ranges.push(r)
    }
  }
  if (!ranges.length) {
    selection?.removeAllRanges()
    state.text = text
    state.index = -1
    return { matches: 0, active: 0 }
  }
  if (restart || state.text !== text || state.index < 0) state.index = backwards ? ranges.length - 1 : 0
  else state.index = (state.index + (backwards ? -1 : 1) + ranges.length) % ranges.length
  state.text = text
  const range = ranges[state.index]
  selection?.removeAllRanges()
  selection?.addRange(range)
  const box = range.getBoundingClientRect()
  if (box.top < 0 || box.bottom > innerHeight) window.scrollBy({ top: box.top - innerHeight / 2 })
  return { matches: ranges.length, active: state.index + 1 }
}
