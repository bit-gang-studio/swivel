import { describe, expect, it } from 'vitest'
import { decode, matches, merge, pathText, setAt, timestamp, typed } from './json'

const jwt = (payload: object) => [{ alg: 'none' }, payload].map((p) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(p)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')).join('.') + '.sig'

describe('JSON viewer', () => {
  it('finds a structure in text: JSON, URL-encoded JSON, a token', () => {
    expect(decode('{"a":1}')?.value).toEqual({ a: 1 })
    expect(decode('hello')).toBeUndefined()
    expect(decode('12')).toBeUndefined()
    const cookie = decode(encodeURIComponent('{"a":[1]}'))
    expect(cookie?.value).toEqual({ a: [1] })
    expect(cookie?.encode?.({ a: [2] })).toBe(encodeURIComponent('{"a":[2]}'))
    const token = decode(jwt({ sub: 'é', exp: 1900000000 }))
    expect(token).toMatchObject({ kind: 'JWT', value: { header: { alg: 'none' }, payload: { sub: 'é', exp: 1900000000 } } })
    expect(token?.encode).toBeUndefined()
  })

  it('reads numbers that are dates', () => {
    expect(timestamp(1900000000)).toBe(1900000000000)
    expect(timestamp(1900000000000)).toBe(1900000000000)
    expect(timestamp(42)).toBeUndefined()
    expect(timestamp(1900000000.5)).toBeUndefined()
  })

  it("merges the engines' values into one tree and marks what differs", () => {
    const tree = merge([{ user: { name: 'a', roles: ['x'] }, theme: 'dark' }, { user: { name: 'a', roles: ['x', 'y'] }, theme: 'dark' }, undefined])
    expect(tree.same).toBe(false)
    const [user, theme] = tree.children!
    expect(theme.values).toEqual(['dark', 'dark', undefined])
    expect(merge([{ a: 1, b: 2 }, { b: 2, a: 1 }]).same).toBe(true)
    const [name, roles] = merge([{ name: 'a', roles: ['x'] }, { name: 'a', roles: ['x', 'y'] }]).children!
    expect(name.same).toBe(true)
    expect(roles.same).toBe(false)
    expect(roles.children!.map((c) => c.same)).toEqual([true, false])
    expect(roles.children![1].values).toEqual([undefined, 'y'])
    expect(user.kind).toBe('object')
    // Different shapes in the same place: a leaf, a value per side.
    expect(merge([{ a: 1 }, 'text']).kind).toBe('leaf')
  })

  it('opens text that holds JSON or a token', () => {
    const node = merge([{ session: '{"id":7}', token: jwt({ sub: 'me' }) }]).children!
    expect(node[0]).toMatchObject({ decoded: 'JSON', kind: 'object' })
    expect(node[0].children![0]).toMatchObject({ path: ['session', 'id'], values: [7] })
    expect(node[1].decoded).toBe('JWT')
  })

  it('writes paths, sets a field, reads typed values, searches', () => {
    expect(pathText(['user', 'roles', 0, 'first-name'])).toBe('user.roles[0]["first-name"]')
    const root = { user: { roles: ['x', 'y'] }, n: 1 }
    expect(setAt(root, ['user', 'roles', 1], 'z')).toEqual({ user: { roles: ['x', 'z'] }, n: 1 })
    expect(root.user.roles[1]).toBe('y')
    expect([typed('12'), typed('true'), typed('"a"'), typed('plain text')]).toEqual([12, true, 'a', 'plain text'])
    const tree = merge([{ user: { name: 'Ada' }, n: 1 }])
    expect(tree.children!.map((c) => matches(c, 'ada'))).toEqual([true, false])
    expect(matches(tree.children![1], 'n')).toBe(true)
  })
})
