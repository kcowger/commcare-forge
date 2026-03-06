import { describe, it, expect } from 'vitest'
import { getResources, readResource } from '../../mcp-server/src/resources'

describe('MCP Resources', () => {
  it('lists two resources', () => {
    const resources = getResources()
    expect(resources).toHaveLength(2)
    expect(resources.map(r => r.uri)).toContain('commcare://reference')
    expect(resources.map(r => r.uri)).toContain('commcare://compact-schema')
  })

  it('reads the CommCare reference', () => {
    const content = readResource('commcare://reference')
    expect(content).toContain('XForm XML Structure')
    expect(content).toContain('<h:html')
  })

  it('reads the compact JSON schema', () => {
    const content = readResource('commcare://compact-schema')
    expect(content).toContain('app_name')
    expect(content).toContain('case_type')
    expect(content).toContain('Reserved Case Property Names')
  })

  it('throws for unknown URI', () => {
    expect(() => readResource('commcare://unknown')).toThrow()
  })
})
