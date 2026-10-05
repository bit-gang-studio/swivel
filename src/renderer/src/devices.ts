import type { EngineId, MobileKind, Viewport } from '../../shared/types'

export interface Device {
  name: string
  group: 'Phones' | 'Tablets' | 'Computers'
  engine: EngineId
  viewport: Viewport
  /** Phones and tablets start in mobile mode: their browser ID, and touch where the engine can. */
  mobile?: MobileKind
}

/** Devices to add as frames: each sets the engine its real browser uses, and its screen size. */
export const DEVICES: Device[] = [
  { name: 'iPhone 15', group: 'Phones', engine: 'webkit', viewport: { width: 393, height: 852 }, mobile: 'phone' },
  { name: 'iPhone 15 Pro Max', group: 'Phones', engine: 'webkit', viewport: { width: 430, height: 932 }, mobile: 'phone' },
  { name: 'iPhone SE', group: 'Phones', engine: 'webkit', viewport: { width: 375, height: 667 }, mobile: 'phone' },
  { name: 'Pixel 8', group: 'Phones', engine: 'chromium', viewport: { width: 412, height: 915 }, mobile: 'phone' },
  { name: 'Galaxy S24', group: 'Phones', engine: 'chromium', viewport: { width: 360, height: 780 }, mobile: 'phone' },
  { name: 'iPad Air', group: 'Tablets', engine: 'webkit', viewport: { width: 820, height: 1180 }, mobile: 'tablet' },
  { name: 'iPad Pro 12.9', group: 'Tablets', engine: 'webkit', viewport: { width: 1024, height: 1366 }, mobile: 'tablet' },
  { name: 'Galaxy Tab S9', group: 'Tablets', engine: 'chromium', viewport: { width: 800, height: 1280 }, mobile: 'tablet' },
  { name: 'Laptop', group: 'Computers', engine: 'chromium', viewport: { width: 1280, height: 800 } },
  { name: 'Desktop', group: 'Computers', engine: 'chromium', viewport: { width: 1440, height: 900 } },
  { name: 'Large desktop', group: 'Computers', engine: 'chromium', viewport: { width: 1920, height: 1080 } }
]

/** Widths a dragged frame edge snaps to: common phone, tablet and desktop breakpoints. */
export const SNAP_WIDTHS = [390, 768, 1024, 1280, 1440]

/** A named group of frames, such as "Responsive" or "Browsers". */
export interface FrameSet {
  name: string
  frames: { engine: EngineId; viewport: Viewport; mobile?: MobileKind }[]
  builtIn?: boolean
}

const at = (engine: EngineId, width: number, height: number) => ({ engine, viewport: { width, height } })

export const BUILT_IN_SETS: FrameSet[] = [
  { name: 'Responsive', builtIn: true, frames: [at('chromium', 1440, 900), at('chromium', 1280, 800), at('chromium', 820, 1180), at('chromium', 390, 844)] },
  { name: 'Browsers', builtIn: true, frames: [at('chromium', 1280, 800), at('firefox', 1280, 800), at('webkit', 1280, 800)] }
]

const KEY = 'swivel.sets'

/** Sets the user saved (on this computer; they hold engines and sizes, no site data). */
export function loadSets(): FrameSet[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as FrameSet[]
    return Array.isArray(saved) ? saved.filter((s) => s?.name && Array.isArray(s.frames)) : []
  } catch {
    return []
  }
}

export function saveSets(sets: FrameSet[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sets))
  } catch {
    // Storage unavailable; sets just aren't remembered.
  }
}
