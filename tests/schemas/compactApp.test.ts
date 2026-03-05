import { describe, it, expect } from 'vitest'
import { compactAppSchema, getCompactAppJsonSchema } from '../../backend/src/schemas/compactApp'
import { validateCompact, expandToHqJson } from '../../backend/src/services/hqJsonExpander'
import type { CompactApp } from '../../backend/src/services/hqJsonExpander'

describe('compactAppSchema', () => {
  it('parses a valid minimal app', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test App',
      modules: [{
        name: 'Module',
        forms: [{
          name: 'Survey',
          type: 'survey',
          questions: [{ id: 'q1', type: 'text', label: 'Question' }]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses a full registration + followup app', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Patient Tracker',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [
          {
            name: 'Register Patient',
            type: 'registration',
            case_name_field: 'patient_name',
            case_properties: { age: 'age', gender: 'gender' },
            questions: [
              { id: 'patient_name', type: 'text', label: 'Patient Name', required: true },
              { id: 'age', type: 'int', label: 'Age', constraint: '. > 0 and . < 150' },
              { id: 'gender', type: 'select1', label: 'Gender', options: [
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' }
              ]}
            ]
          },
          {
            name: 'Follow-up',
            type: 'followup',
            case_preload: { current_age: 'age' },
            case_properties: { last_visit: 'visit_date' },
            questions: [
              { id: 'current_age', type: 'int', label: 'Age', readonly: true },
              { id: 'visit_date', type: 'date', label: 'Visit Date', required: true }
            ]
          }
        ],
        case_list_columns: [{ field: 'age', header: 'Age' }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses recursive group/repeat questions', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{
            id: 'outer_group',
            type: 'group',
            label: 'Outer',
            children: [{
              id: 'inner_repeat',
              type: 'repeat',
              label: 'Inner',
              children: [
                { id: 'deep_q', type: 'text', label: 'Deep Question' }
              ]
            }]
          }]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses close_case boolean', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Discharge',
          type: 'followup',
          close_case: true,
          questions: [{ id: 'reason', type: 'text', label: 'Reason' }]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses close_case conditional', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Discharge',
          type: 'followup',
          close_case: { question: 'confirm', answer: 'yes' },
          questions: [
            { id: 'confirm', type: 'select1', label: 'Confirm?', options: [
              { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
            ]}
          ]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses child_cases', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mothers',
        case_type: 'mother',
        forms: [{
          name: 'Register',
          type: 'registration',
          case_name_field: 'name',
          child_cases: [{
            case_type: 'pregnancy',
            case_name_field: 'due_date',
            case_properties: { trimester: 'trimester' },
            relationship: 'extension'
          }],
          questions: [
            { id: 'name', type: 'text', label: 'Name' },
            { id: 'due_date', type: 'date', label: 'Due Date' },
            { id: 'trimester', type: 'select1', label: 'Trimester', options: [
              { value: '1', label: 'First' }, { value: '2', label: 'Second' }, { value: '3', label: 'Third' }
            ]}
          ]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing app_name', () => {
    const result = compactAppSchema.safeParse({
      modules: [{ name: 'Mod', forms: [{ name: 'F', type: 'survey', questions: [{ id: 'q', type: 'text', label: 'Q' }] }] }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing modules', () => {
    const result = compactAppSchema.safeParse({ app_name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid question type', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'q', type: 'invalid_type', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid form type', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'unknown',
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  /**
   * Kitchen sink test: exercises EVERY field from every CompactApp interface.
   *
   * This is the key schema-vs-interface alignment test. It works in three layers:
   *
   * 1. TypeScript compilation — the fixture is typed as CompactApp, so if we
   *    include a field the interface doesn't have, or misspell one, tsc catches it.
   *
   * 2. Zod parse + key comparison — since z.object() strips unknown keys by default,
   *    we compare the parsed output's keys against the input's keys. If the Zod schema
   *    is missing a field that the interface defines, the key will be silently dropped
   *    and this comparison will catch it.
   *
   * 3. Pipeline validation — validateCompact() and expandToHqJson() confirm the
   *    real pipeline accepts the same data the schema accepts.
   *
   * If someone adds a field to the CompactApp interfaces, this test will fail
   * until the Zod schema is updated to match (and vice versa).
   */
  it('schema covers every field from the CompactApp interfaces (kitchen sink)', () => {
    // Typed as CompactApp so TypeScript enforces interface alignment
    const kitchenSink: CompactApp = {
      app_name: 'Kitchen Sink App',
      modules: [{
        name: 'All Features',
        case_type: 'patient',
        forms: [
          {
            // Registration form — exercises case_name_field, case_properties, child_cases
            name: 'Register',
            type: 'registration',
            case_name_field: 'patient_name',
            case_properties: { age: 'age', gender: 'gender' },
            child_cases: [{
              case_type: 'referral',
              case_name_field: 'referral_reason',
              case_properties: { priority: 'priority' },
              relationship: 'child',
              repeat_context: 'referrals'
            }],
            questions: [
              { id: 'patient_name', type: 'text', label: 'Patient Name', required: true, hint: 'Full legal name' },
              { id: 'age', type: 'int', label: 'Age', constraint: '. > 0 and . < 150', constraint_msg: 'Must be 1-149' },
              { id: 'gender', type: 'select1', label: 'Gender', options: [
                { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }
              ]},
              { id: 'bmi', type: 'hidden', label: 'BMI', calculate: '/data/weight div (/data/height * /data/height)' },
              { id: 'referrals', type: 'repeat', label: 'Referrals', children: [
                { id: 'referral_reason', type: 'text', label: 'Reason' },
                { id: 'priority', type: 'select1', label: 'Priority', options: [
                  { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }
                ]}
              ]}
            ]
          },
          {
            // Followup form — exercises case_preload, close_case (conditional), readonly
            name: 'Follow-up',
            type: 'followup',
            case_preload: { loaded_age: 'age' },
            case_properties: { last_visit: 'visit_date' },
            close_case: { question: 'outcome', answer: 'discharged' },
            questions: [
              { id: 'loaded_age', type: 'int', label: 'Age', readonly: true },
              { id: 'visit_date', type: 'date', label: 'Visit Date', required: true },
              { id: 'outcome', type: 'select1', label: 'Outcome', options: [
                { value: 'active', label: 'Active' }, { value: 'discharged', label: 'Discharged' }
              ]},
              { id: 'conditional_q', type: 'text', label: 'Discharge Notes', relevant: '/data/outcome = "discharged"' },
              { id: 'vitals_group', type: 'group', label: 'Vitals', children: [
                { id: 'bp', type: 'text', label: 'Blood Pressure' }
              ]}
            ]
          },
          {
            // Survey form — no case management
            name: 'Survey',
            type: 'survey',
            questions: [
              { id: 'feedback', type: 'text', label: 'Feedback' }
            ]
          }
        ],
        case_list_columns: [{ field: 'age', header: 'Age' }, { field: 'gender', header: 'Gender' }]
      }]
    }

    // Layer 2: Zod parse — check no fields were silently stripped.
    // Since z.object() drops unknown keys by default, toEqual will catch any
    // key present in the input but missing from the parsed output, producing
    // a clear diff showing exactly which field the schema forgot.
    const result = compactAppSchema.safeParse(kitchenSink)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data).toEqual(kitchenSink)

    // Layer 3: Pipeline agrees — validateCompact passes, expandToHqJson doesn't throw
    const errors = validateCompact(kitchenSink)
    expect(errors).toEqual([])

    const hqJson = expandToHqJson(kitchenSink)
    expect(hqJson.doc_type).toBe('Application')
    expect(hqJson.modules).toHaveLength(1)
  })
})

describe('getCompactAppJsonSchema', () => {
  it('returns a valid JSON Schema object', () => {
    const schema = getCompactAppJsonSchema()
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
    const props = schema.properties as Record<string, any>
    expect(props.app_name).toBeDefined()
    expect(props.modules).toBeDefined()
    expect(props.modules.type).toBe('array')
  })

  it('includes descriptions from .describe()', () => {
    const schema = getCompactAppJsonSchema()
    const props = schema.properties as Record<string, any>
    expect(props.app_name.description).toContain('Name')
  })

  it('handles recursive question schema with $defs/$ref', () => {
    const schema = getCompactAppJsonSchema()
    const json = JSON.stringify(schema)
    // Should have $defs for the recursive question type
    expect(json).toContain('$defs')
    expect(json).toContain('$ref')
  })

  it('includes all question type enum values', () => {
    const json = JSON.stringify(getCompactAppJsonSchema())
    for (const type of ['text', 'int', 'date', 'select1', 'select', 'geopoint', 'image', 'group', 'repeat', 'hidden', 'phone']) {
      expect(json).toContain(`"${type}"`)
    }
  })

  it('includes form type enum values', () => {
    const json = JSON.stringify(getCompactAppJsonSchema())
    expect(json).toContain('"registration"')
    expect(json).toContain('"followup"')
    expect(json).toContain('"survey"')
  })
})
