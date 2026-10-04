/**
 * Sync between frames: scroll, click or type in one frame and the others repeat it.
 * A small script in every page reports what the user does there (through the console, the one
 * channel every engine already gives Swivel); the window's host passes it to the other frames,
 * whose scripts apply it.
 * - Scroll: by how far down the page (a fraction), since each layout has its own height.
 * - Click: on the same element, found by its place in the page. Links and form submits aren't
 *   repeated: the frame that was clicked navigates, and the others follow it.
 * - Typing: the field's value is copied to the same field.
 */
export const SYNC_PREFIX = '​swivel-sync:'

export type SyncMessage =
  | { t: 'scroll'; x: number; y: number }
  | { t: 'click'; s: string }
  | { t: 'input'; s: string; v: string | boolean }

/** Runs in the page. Self-contained: it is sent as source text. */
function install(prefix: string): void {
  type Message = { t: 'scroll'; x: number; y: number } | { t: 'click'; s: string } | { t: 'input'; s: string; v: string | boolean }
  const w = window as unknown as { __swivelSync?: { apply: (m: Message) => void } }
  if (w.__swivelSync) return
  /** While set, scrolling here was caused by another frame and isn't reported back. */
  let quietUntil = 0
  const send = (m: Message) => console.log(prefix + JSON.stringify(m))

  /** A selector for an element by its place in the page (an id when it has a unique one). */
  const pathTo = (target: Element): string => {
    const parts: string[] = []
    let el: Element | null = target
    while (el && el !== document.documentElement) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id))
        return parts.join('>')
      }
      let n = 1
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) n++
      parts.unshift(`${el.localName}:nth-child(${n})`)
      el = el.parentElement
    }
    return 'html>' + parts.join('>')
  }
  const range = () => {
    const d = document.scrollingElement ?? document.documentElement
    return { x: d.scrollWidth - innerWidth, y: d.scrollHeight - innerHeight }
  }

  let pending = false
  addEventListener(
    'scroll',
    () => {
      if (Date.now() < quietUntil || pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        const max = range()
        send({ t: 'scroll', x: max.x > 0 ? scrollX / max.x : 0, y: max.y > 0 ? scrollY / max.y : 0 })
      })
    },
    { passive: true }
  )
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target : null
      if (!e.isTrusted || !el) return
      // A click that navigates is left to this frame; the others follow where it goes.
      const link = el.closest('a[href]')
      if (link && !(link.getAttribute('href') ?? '').startsWith('#')) return
      const button = el.closest('button, input[type=submit], input[type=image]') as HTMLButtonElement | HTMLInputElement | null
      if (button?.form && (button.type === 'submit' || button.type === 'image')) return
      send({ t: 'click', s: pathTo(el) })
    },
    true
  )
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target
      if (!e.isTrusted) return
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) send({ t: 'input', s: pathTo(el), v: el.checked })
      else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) send({ t: 'input', s: pathTo(el), v: el.value })
    },
    true
  )

  w.__swivelSync = {
    apply(m) {
      if (m.t === 'scroll') {
        quietUntil = Date.now() + 250
        const max = range()
        scrollTo({ left: m.x * Math.max(0, max.x), top: m.y * Math.max(0, max.y), behavior: 'instant' as ScrollBehavior })
        return
      }
      const el = document.querySelector(m.s)
      if (!el) return
      if (m.t === 'click') return (el as HTMLElement).click()
      // Set through the element's own setter, so frameworks that track the value notice.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, typeof m.v === 'boolean' ? 'checked' : 'value')?.set?.call(el, m.v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
}

/** Script that installs sync in a page (safe to run again). */
export const syncInstallScript = `(${install.toString()})(${JSON.stringify(SYNC_PREFIX)})`

/** Script that repeats another frame's scroll, click or typing in a page. */
export const syncApplyScript = (message: SyncMessage) => `window.__swivelSync && window.__swivelSync.apply(${JSON.stringify(message)})`
