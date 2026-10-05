import { Script } from 'node:vm'

/** Whether source parses as the body of an async function. */
function parses(body: string): boolean {
  try {
    new Function(`return (async () => {\n${body}\n})`)
    return true
  } catch {
    return false
  }
}

/**
 * Turn a line typed at the console prompt into a function body that returns its value, without
 * running it. Checked here rather than in the page: a script that doesn't parse fails silently
 * there.
 * - An expression: its value.
 * - Statements: the value of the last one when it's an expression ("const x = 2; x * 3" gives
 *   6, as a browser's console does), otherwise nothing.
 * - Not JavaScript: the error, worded for the line as typed.
 */
export function parseLine(code: string): { body: string } | { syntaxError: string } {
  const expression = `return (\n${code}\n)`
  if (parses(expression)) return { body: expression }
  if (parses(code)) {
    // Try the text after each semicolon, from the end, as the expression whose value is wanted.
    const trimmed = code.replace(/[;\s]+$/, '')
    for (let at = trimmed.lastIndexOf(';'); at >= 0; at = trimmed.lastIndexOf(';', at - 1)) {
      const body = `${trimmed.slice(0, at + 1)}\nreturn (\n${trimmed.slice(at + 1)}\n)`
      if (trimmed.slice(at + 1).trim() && parses(body)) return { body }
    }
    return { body: code }
  }
  try {
    new Script(code)
  } catch (err) {
    return { syntaxError: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }
  return { syntaxError: 'SyntaxError: this line is not complete JavaScript' }
}
