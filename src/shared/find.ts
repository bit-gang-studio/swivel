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
 * Runs inside the page (it must stay self-contained): counts matches, moves the selection to
 * the next one with window.find (supported by Chromium, Firefox and WebKit), and works out which
 * match is selected. An empty text clears the search.
 */
export function findInPage({ text, backwards, restart }: FindRequest): FindResult {
  const selection = getSelection()
  if (!text) {
    selection?.removeAllRanges()
    return { matches: 0, active: 0 }
  }
  const needle = text.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
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
    return { matches: 0, active: 0 }
  }
  if (restart) selection?.removeAllRanges()
  // window.find is non-standard but present in all three engines.
  const find = (window as unknown as { find: (...args: unknown[]) => boolean }).find
  find.call(window, text, false, backwards, true, false, false, false)
  const current = selection && selection.rangeCount ? selection.getRangeAt(0) : null
  let active = 0
  if (current) {
    active = ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, current) === 0) + 1
    if (!active) active = ranges.filter((r) => r.compareBoundaryPoints(Range.START_TO_START, current) < 0).length + 1
  }
  return { matches: ranges.length, active: Math.min(active, ranges.length) }
}
