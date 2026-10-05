import { describe, expect, it } from 'vitest'
import { parseLine } from './parse-line'

/** Run a parsed line the way a page would. */
const value = (code: string) => {
  const parsed = parseLine(code)
  if ('syntaxError' in parsed) throw new Error(parsed.syntaxError)
  return (new Function(`return (async () => {\n${parsed.body}\n})`)() as () => Promise<unknown>)()
}

describe('console prompt lines', () => {
  it('gives an expression its value', async () => {
    expect(await value('1 + 1')).toBe(2)
    expect(await value('({ a: 1 }).a')).toBe(1)
    expect(await value('await Promise.resolve(5)')).toBe(5)
  })

  it("gives statements their last expression's value, like a browser's console", async () => {
    expect(await value('const x = 2; x * 3')).toBe(6)
    expect(await value('let s = "a;b"; s.length;')).toBe(3)
    expect(await value('const x = 2')).toBeUndefined()
    expect(await value('for (let i = 0; i < 3; i++) {}')).toBeUndefined()
  })

  it('reports what is wrong with a line that is not JavaScript, as typed', () => {
    expect(parseLine('1 +')).toEqual({ syntaxError: 'SyntaxError: Unexpected end of input' })
    expect(parseLine('let let = 1')).toHaveProperty('syntaxError')
  })
})
