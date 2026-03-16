import { describe, it, expect } from 'vitest'
import { compactAppSchema } from '../../backend/src/schemas/compactApp'

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

  // --- Zod .refine() rule tests ---

  it('rejects registration form without case_name_field', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Register',
          type: 'registration',
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects close_case on non-followup form', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Survey',
          type: 'survey',
          close_case: true,
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects select1 with fewer than 2 options', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'q', type: 'select1', label: 'Q', options: [{ value: 'a', label: 'A' }] }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects select1 with no options', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'q', type: 'select1', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects hidden question without calculate', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'q', type: 'hidden', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('accepts hidden question with calculate', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'q', type: 'hidden', label: 'Q', calculate: "today()" }]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('rejects group with no children', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'g', type: 'group', label: 'G' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid case_type format', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'has spaces!',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty modules array', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: []
    })
    expect(result.success).toBe(false)
  })

  it('rejects form with empty questions array', () => {
    const result = compactAppSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: []
        }]
      }]
    })
    expect(result.success).toBe(false)
  })

})
