import { describe, it, expect } from 'vitest'
import { repairTruncatedJson, tryParseCompact, parseCompactFromResponse } from '../backend/src/services/appGenerator'

describe('repairTruncatedJson', () => {
  it('returns valid JSON unchanged', () => {
    const json = '{"modules":[{"name":"Test"}]}'
    expect(repairTruncatedJson(json)).toBe(json)
  })

  it('closes unclosed braces', () => {
    const truncated = '{"modules":[{"name":"Test"'
    const repaired = repairTruncatedJson(truncated)
    expect(() => JSON.parse(repaired)).not.toThrow()
    const parsed = JSON.parse(repaired)
    expect(parsed.modules[0].name).toBe('Test')
  })

  it('closes unclosed brackets', () => {
    const truncated = '{"modules":[{"name":"A"},{"name":"B"'
    const repaired = repairTruncatedJson(truncated)
    expect(() => JSON.parse(repaired)).not.toThrow()
  })

  it('removes trailing commas at end of truncated JSON', () => {
    const truncated = '{"modules":[{"name":"Test"},'
    const repaired = repairTruncatedJson(truncated)
    expect(() => JSON.parse(repaired)).not.toThrow()
    const parsed = JSON.parse(repaired)
    expect(parsed.modules).toHaveLength(1)
  })

  it('handles truncation mid-string', () => {
    const truncated = '{"modules":[{"name":"Trun'
    const repaired = repairTruncatedJson(truncated)
    expect(() => JSON.parse(repaired)).not.toThrow()
  })

  it('strips dangling keys', () => {
    const truncated = '{"modules":[{"name":"Test","descri'
    const repaired = repairTruncatedJson(truncated)
    expect(() => JSON.parse(repaired)).not.toThrow()
  })
})

describe('tryParseCompact', () => {
  it('parses valid compact JSON', () => {
    const json = JSON.stringify({ app_name: 'Test', modules: [{ name: 'Mod', forms: [] }] })
    const result = tryParseCompact(json)
    expect(result).not.toBeNull()
    expect(result!.app_name).toBe('Test')
  })

  it('returns null for non-compact JSON', () => {
    const json = '{"foo": "bar"}'
    expect(tryParseCompact(json)).toBeNull()
  })

  it('returns null for empty modules', () => {
    const json = '{"modules": []}'
    expect(tryParseCompact(json)).toBeNull()
  })

  it('repairs and parses truncated compact JSON', () => {
    const truncated = '{"app_name":"Test","modules":[{"name":"Mod","forms":[{"name":"F1"'
    const result = tryParseCompact(truncated)
    expect(result).not.toBeNull()
    expect(result!.modules).toHaveLength(1)
  })

  it('returns null for completely invalid text', () => {
    expect(tryParseCompact('not json at all')).toBeNull()
  })
})

describe('parseCompactFromResponse', () => {
  const validCompact = { app_name: 'Test', modules: [{ name: 'Mod', forms: [{ name: 'Form' }] }] }

  it('extracts JSON from markdown code blocks', () => {
    const response = `Here's the app:\n\n\`\`\`json\n${JSON.stringify(validCompact)}\n\`\`\`\n\nLet me know!`
    const result = parseCompactFromResponse(response)
    expect(result).not.toBeNull()
    expect(result!.app_name).toBe('Test')
  })

  it('extracts JSON from truncated code blocks (no closing ```)', () => {
    const response = `\`\`\`json\n${JSON.stringify(validCompact)}`
    const result = parseCompactFromResponse(response)
    expect(result).not.toBeNull()
  })

  it('extracts JSON from bare braces', () => {
    const response = `Here is the definition: ${JSON.stringify(validCompact)} -- done`
    const result = parseCompactFromResponse(response)
    expect(result).not.toBeNull()
  })

  it('returns null for response with no JSON', () => {
    expect(parseCompactFromResponse('No JSON here at all')).toBeNull()
  })

  it('returns null for response with non-compact JSON', () => {
    expect(parseCompactFromResponse('{"foo": "bar"}')).toBeNull()
  })

  it('prefers the last code block', () => {
    const wrong = { app_name: 'Wrong', modules: [{ name: 'W', forms: [{ name: 'WF' }] }] }
    const right = { app_name: 'Right', modules: [{ name: 'R', forms: [{ name: 'RF' }] }] }
    const response = `\`\`\`json\n${JSON.stringify(wrong)}\n\`\`\`\nFixed:\n\`\`\`json\n${JSON.stringify(right)}\n\`\`\``
    const result = parseCompactFromResponse(response)
    expect(result!.app_name).toBe('Right')
  })
})
