import { describe, it, expect } from 'vitest'
import { validateXPath } from '../backend/src/utils/xpathValidator'

describe('xpathValidator', () => {
  it('returns no warnings for valid expressions', () => {
    expect(validateXPath('. > 0 and . < 150')).toEqual([])
    expect(validateXPath('/data/age > 18')).toEqual([])
    expect(validateXPath("selected(/data/choice, 'yes')")).toEqual([])
    expect(validateXPath("true()")).toEqual([])
    expect(validateXPath("if(/data/q = 'a', 'b', 'c')")).toEqual([])
    expect(validateXPath("count(/data/repeat) > 0")).toEqual([])
  })

  it('returns no warnings for empty/null input', () => {
    expect(validateXPath('')).toEqual([])
    expect(validateXPath('  ')).toEqual([])
  })

  it('detects unbalanced parentheses', () => {
    const w = validateXPath('count(/data/items')
    expect(w.some(w => w.message.includes('parentheses'))).toBe(true)
  })

  it('detects unbalanced brackets', () => {
    const w = validateXPath("/data/items[position() > 1")
    expect(w.some(w => w.message.includes('brackets'))).toBe(true)
  })

  it('detects unbalanced single quotes', () => {
    const w = validateXPath("/data/q = 'yes")
    expect(w.some(w => w.message.includes('single quotes'))).toBe(true)
  })

  it('detects unbalanced double quotes', () => {
    const w = validateXPath('/data/q = "yes')
    expect(w.some(w => w.message.includes('double quotes'))).toBe(true)
  })

  it('detects == instead of =', () => {
    const w = validateXPath("/data/q == 'yes'")
    expect(w.some(w => w.message.includes('=='))).toBe(true)
  })

  it('does not flag != as ==', () => {
    expect(validateXPath("/data/q != 'yes'")).toEqual([])
  })

  it('detects invalid function names', () => {
    expect(validateXPath("length(/data/q)").some(w => w.message.includes('string-length'))).toBe(true)
    expect(validateXPath("substr(/data/q, 1, 3)").some(w => w.message.includes('substring'))).toBe(true)
    expect(validateXPath("parseInt(/data/q)").some(w => w.message.includes('number'))).toBe(true)
  })

  it('detects empty predicate brackets', () => {
    const w = validateXPath("/data/items[]")
    expect(w.some(w => w.message.includes('Empty predicate'))).toBe(true)
  })

  it('detects trailing operator', () => {
    const w = validateXPath("/data/a and")
    expect(w.some(w => w.message.includes('ends with an operator'))).toBe(true)
  })

  it('detects leading operator', () => {
    const w = validateXPath("and /data/a = 1")
    expect(w.some(w => w.message.includes('starts with an operator'))).toBe(true)
  })
})
