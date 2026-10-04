import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let file: string | undefined

/**
 * Diagnostics, always written to Swivel's log folder (~/Library/Logs/swivel/swivel.log on macOS;
 * started fresh each launch): what the window's views were asked to do, for when a frame stays
 * blank on someone's machine.
 */
export function log(...args: unknown[]): void {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  if (process.env.SWIVEL_DEBUG) console.log('[swivel]', line)
  try {
    if (!file) {
      mkdirSync(app.getPath('logs'), { recursive: true })
      file = join(app.getPath('logs'), 'swivel.log')
      writeFileSync(file, '')
    }
    appendFileSync(file, line + '\n')
  } catch {
    // Logging is best effort.
  }
}
