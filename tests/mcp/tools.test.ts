import { describe, it, expect, afterAll } from 'vitest'
import { handleValidate, handleBuild, getToolDefinitions } from '../../mcp-server/src/tools'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

describe('validate_commcare_app', () => {
  it('returns valid for a correct compact JSON', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Patients',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            questions: [
              { id: 'name', type: 'text', label: 'Name', required: true }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
  })

  it('returns errors for missing case_type', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Patients',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            questions: [
              { id: 'name', type: 'text', label: 'Name' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.length).toBeGreaterThan(0)
    expect(result.errors!.some(e => e.includes('case_type'))).toBe(true)
  })

  // Missing app_name and empty modules are now caught by the Zod schema
  // at the MCP/tool boundary before handleValidate runs.
  // See tests/schemas/compactApp.test.ts for those validations.

  it('returns errors for reserved property names in case_properties', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            case_properties: { 'status': 'status_field' },
            questions: [
              { id: 'name', type: 'text', label: 'Name' },
              { id: 'status_field', type: 'text', label: 'Status' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('reserved'))).toBe(true)
  })

  it('returns errors for registration form without case_name_field', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            questions: [
              { id: 'name', type: 'text', label: 'Name' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('case_name_field'))).toBe(true)
  })

  it('returns errors for form with no questions', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            questions: []
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('no questions'))).toBe(true)
  })

  it('returns errors for select question without options', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          forms: [{
            name: 'Survey',
            type: 'survey',
            questions: [
              { id: 'choice', type: 'select1', label: 'Pick', options: [] }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('no options'))).toBe(true)
  })

  it('validates a valid survey app (no case_type needed)', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Survey App',
        modules: [{
          name: 'Surveys',
          forms: [{
            name: 'Feedback',
            type: 'survey',
            questions: [
              { id: 'feedback', type: 'text', label: 'Your feedback' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(true)
  })

  it('returns errors for case_properties mapping to nonexistent question', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            case_properties: { visit_age: 'nonexistent_q' },
            questions: [
              { id: 'name', type: 'text', label: 'Name' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes("doesn't exist"))).toBe(true)
  })

  it('returns errors for case_name_field referencing nonexistent question', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'nonexistent',
            questions: [
              { id: 'name', type: 'text', label: 'Name' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes("doesn't match"))).toBe(true)
  })
})

describe('build_commcare_app', () => {
  const testOutputDir = join(tmpdir(), `mcp-test-${randomUUID()}`)

  afterAll(() => {
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true })
    }
  })

  it('builds a valid app and writes .ccz and .hq.json', async () => {
    const result = await handleBuild({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Patients',
          case_type: 'patient',
          forms: [{
            name: 'Register Patient',
            type: 'registration',
            case_name_field: 'patient_name',
            case_properties: { age: 'age' },
            questions: [
              { id: 'patient_name', type: 'text', label: 'Patient Name', required: true },
              { id: 'age', type: 'int', label: 'Age' }
            ]
          }],
          case_list_columns: [{ field: 'age', header: 'Age' }]
        }]
      },
      output_dir: testOutputDir
    })
    expect(result.success).toBe(true)
    expect(result.ccz_path).toBeDefined()
    expect(result.hq_json_path).toBeDefined()
    expect(existsSync(result.ccz_path!)).toBe(true)
    expect(existsSync(result.hq_json_path!)).toBe(true)
  })

  it('returns errors for compact JSON with semantic validation issues', async () => {
    const result = await handleBuild({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            questions: [{ id: 'name', type: 'text', label: 'Name' }]
          }]
        }]
      }
    })
    // Missing case_type on module with registration form
    expect(result.success).toBe(false)
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('returns errors for compact JSON with reserved case properties', async () => {
    const result = await handleBuild({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            case_properties: { status: 'name' },
            questions: [
              { id: 'name', type: 'text', label: 'Name' }
            ]
          }]
        }]
      }
    })
    expect(result.success).toBe(false)
    expect(result.errors!.some(e => e.includes('reserved'))).toBe(true)
  })

  it('builds a survey app without case management', async () => {
    const surveyOutputDir = join(testOutputDir, 'survey')
    const result = await handleBuild({
      compact_json: {
        app_name: 'Survey App',
        modules: [{
          name: 'Surveys',
          forms: [{
            name: 'Feedback Form',
            type: 'survey',
            questions: [
              { id: 'feedback', type: 'text', label: 'Your Feedback', required: true },
              { id: 'rating', type: 'select1', label: 'Rating', options: [
                { value: 'good', label: 'Good' },
                { value: 'bad', label: 'Bad' }
              ]}
            ]
          }]
        }]
      },
      output_dir: surveyOutputDir
    })
    expect(result.success).toBe(true)
    expect(existsSync(result.ccz_path!)).toBe(true)
    expect(existsSync(result.hq_json_path!)).toBe(true)
  })

  it('uses default output_dir when not specified', async () => {
    // We just test that the function doesn't throw; we clean up the default dir
    const defaultDir = join(process.cwd(), 'commcare-output')
    try {
      const result = await handleBuild({
        compact_json: {
          app_name: 'Default Dir App',
          modules: [{
            name: 'Mod',
            forms: [{
              name: 'Form',
              type: 'survey',
              questions: [
                { id: 'q', type: 'text', label: 'Question' }
              ]
            }]
          }]
        }
      })
      expect(result.success).toBe(true)
      expect(result.ccz_path).toContain('commcare-output')
    } finally {
      if (existsSync(defaultDir)) {
        rmSync(defaultDir, { recursive: true })
      }
    }
  })
})

describe('getToolDefinitions', () => {
  it('returns two tool definitions', () => {
    const tools = getToolDefinitions()
    expect(tools).toHaveLength(2)
  })

  it('defines validate_commcare_app tool', () => {
    const tools = getToolDefinitions()
    const validate = tools.find(t => t.name === 'validate_commcare_app')
    expect(validate).toBeDefined()
    expect(validate!.description).toContain('Validates')
    expect(validate!.inputSchema.required).toContain('compact_json')
  })

  it('defines build_commcare_app tool', () => {
    const tools = getToolDefinitions()
    const build = tools.find(t => t.name === 'build_commcare_app')
    expect(build).toBeDefined()
    expect(build!.description).toContain('Builds')
    expect(build!.inputSchema.required).toContain('compact_json')
    expect(build!.inputSchema.properties.output_dir).toBeDefined()
  })

})
