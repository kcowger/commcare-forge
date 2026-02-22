import { describe, it, expect } from 'vitest'
import { SpecStreamParser, stripSpecTags } from '../frontend/src/utils/specParser'

describe('SpecStreamParser', () => {
  it('separates spec content from chat content', () => {
    const parser = new SpecStreamParser()
    const result = parser.processChunk('Hello <app-spec>spec data</app-spec> world')
    expect(result.chatContent).toBe('Hello  world')
    expect(result.specContent).toBe('spec data')
    expect(result.isInsideSpec).toBe(false)
  })

  it('handles spec spanning multiple chunks', () => {
    const parser = new SpecStreamParser()
    parser.processChunk('Before <app-spec>part')
    const r2 = parser.processChunk(' one part')
    expect(r2.isInsideSpec).toBe(true)
    expect(r2.specContent).toBe('part one part')

    const r3 = parser.processChunk(' two</app-spec> after')
    expect(r3.isInsideSpec).toBe(false)
    expect(r3.specContent).toBe('part one part two')
    expect(r3.chatContent).toBe('Before  after')
  })

  it('returns null specContent when no spec tags present', () => {
    const parser = new SpecStreamParser()
    const result = parser.processChunk('Just regular chat text')
    expect(result.chatContent).toBe('Just regular chat text')
    expect(result.specContent).toBeNull()
    expect(result.isInsideSpec).toBe(false)
  })

  it('handles partial open tag at chunk boundary', () => {
    const parser = new SpecStreamParser()
    const r1 = parser.processChunk('text <app-')
    // Should hold the partial tag, flushing text before it
    expect(r1.chatContent).toBe('text ')

    const r2 = parser.processChunk('spec>inside</app-spec>')
    expect(r2.specContent).toBe('inside')
    expect(r2.isInsideSpec).toBe(false)
  })

  it('handles partial close tag at chunk boundary', () => {
    const parser = new SpecStreamParser()
    parser.processChunk('<app-spec>data</app-')
    const r2 = parser.processChunk('spec>after')
    expect(r2.specContent).toBe('data')
    expect(r2.chatContent).toContain('after')
    expect(r2.isInsideSpec).toBe(false)
  })

  it('reset clears all state', () => {
    const parser = new SpecStreamParser()
    parser.processChunk('Hello <app-spec>spec</app-spec>')
    parser.reset()
    const result = parser.processChunk('Fresh start')
    expect(result.chatContent).toBe('Fresh start')
    expect(result.specContent).toBeNull()
  })

  it('accumulates chat across multiple chunks', () => {
    const parser = new SpecStreamParser()
    parser.processChunk('Hello ')
    const r2 = parser.processChunk('world')
    expect(r2.chatContent).toBe('Hello world')
  })
})

describe('stripSpecTags', () => {
  it('strips spec tags and returns both parts', () => {
    const { chat, spec } = stripSpecTags('Before <app-spec>spec content</app-spec> after')
    expect(chat).toBe('Before  after')
    expect(spec).toBe('spec content')
  })

  it('returns null spec when no tags present', () => {
    const { chat, spec } = stripSpecTags('Just text')
    expect(chat).toBe('Just text')
    expect(spec).toBeNull()
  })

  it('handles multiline spec content', () => {
    const { spec } = stripSpecTags('hi <app-spec>\nline1\nline2\n</app-spec> bye')
    expect(spec).toBe('line1\nline2')
  })
})
