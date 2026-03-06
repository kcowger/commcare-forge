import { describe, it, expect } from 'vitest'
import {
  appBlueprintSchema, scaffoldSchema, moduleContentSchema, formContentSchema,
  unflattenQuestions, flattenQuestions, assembleBlueprint, closeCaseToFlat,
  type FlatQuestion, type Scaffold, type ModuleContent, type FormContent,
} from '../../backend/src/schemas/blueprint'

// ── appBlueprintSchema (assembled format, same as old compactAppSchema) ──

describe('appBlueprintSchema', () => {
  it('parses a valid minimal app', () => {
    const result = appBlueprintSchema.safeParse({
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
    const result = appBlueprintSchema.safeParse({
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
    const result = appBlueprintSchema.safeParse({
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

  it('parses close_case unconditional', () => {
    const result = appBlueprintSchema.safeParse({
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Discharge',
          type: 'followup',
          close_case: {},
          questions: [{ id: 'reason', type: 'text', label: 'Reason' }]
        }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses close_case conditional', () => {
    const result = appBlueprintSchema.safeParse({
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
    const result = appBlueprintSchema.safeParse({
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
    const result = appBlueprintSchema.safeParse({
      modules: [{ name: 'Mod', forms: [{ name: 'F', type: 'survey', questions: [{ id: 'q', type: 'text', label: 'Q' }] }] }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing modules', () => {
    const result = appBlueprintSchema.safeParse({ app_name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid question type', () => {
    const result = appBlueprintSchema.safeParse({
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
    const result = appBlueprintSchema.safeParse({
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
})

// ── Tier-specific schemas ──────────────────────────────────────────────

describe('scaffoldSchema', () => {
  it('parses a valid scaffold', () => {
    const result = scaffoldSchema.safeParse({
      app_name: 'Test',
      description: 'A test app',
      case_types: [
        { name: 'patient', properties: [{ name: 'age', label: 'Age' }] }
      ],
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        purpose: 'Manage patients',
        forms: [{ name: 'Register', type: 'registration', purpose: 'Register a patient' }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('parses survey-only scaffold with null case_types', () => {
    const result = scaffoldSchema.safeParse({
      app_name: 'Survey',
      description: 'A survey app',
      case_types: null,
      modules: [{
        name: 'Surveys',
        case_type: null,
        purpose: 'Collect feedback',
        forms: [{ name: 'Feedback', type: 'survey', purpose: 'Gather feedback' }]
      }]
    })
    expect(result.success).toBe(true)
  })
})

describe('moduleContentSchema', () => {
  it('parses module with case list columns', () => {
    const result = moduleContentSchema.safeParse({
      case_list_columns: [
        { field: 'age', header: 'Age' },
        { field: 'gender', header: 'Gender' }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('parses survey-only module with null columns', () => {
    const result = moduleContentSchema.safeParse({
      case_list_columns: null
    })
    expect(result.success).toBe(true)
  })
})

describe('formContentSchema', () => {
  it('parses a registration form', () => {
    const result = formContentSchema.safeParse({
      case_name_field: 'patient_name',
      case_properties: { age: 'age' },
      case_preload: null,
      close_case: null,
      child_cases: null,
      questions: [
        { id: 'patient_name', type: 'text', label: 'Patient Name', parent_id: null, hint: null, required: true, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
        { id: 'age', type: 'int', label: 'Age', parent_id: null, hint: null, required: null, readonly: null, constraint: '. > 0', constraint_msg: 'Must be positive', relevant: null, calculate: null, options: null }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('parses a followup form with unconditional close_case', () => {
    const result = formContentSchema.safeParse({
      case_name_field: null,
      case_properties: null,
      case_preload: { current_age: 'age' },
      close_case: { question: null, answer: null },
      child_cases: null,
      questions: [
        { id: 'current_age', type: 'int', label: 'Age', parent_id: null, hint: null, required: null, readonly: true, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('parses conditional close_case', () => {
    const result = formContentSchema.safeParse({
      case_name_field: null,
      case_properties: null,
      case_preload: null,
      close_case: { question: 'outcome', answer: 'discharged' },
      child_cases: null,
      questions: [
        { id: 'outcome', type: 'select1', label: 'Outcome', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: [{ value: 'active', label: 'Active' }, { value: 'discharged', label: 'Discharged' }] }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('parses flat questions with parent_id', () => {
    const result = formContentSchema.safeParse({
      case_name_field: null,
      case_properties: null,
      case_preload: null,
      close_case: null,
      child_cases: null,
      questions: [
        { id: 'group1', type: 'group', label: 'Info', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
        { id: 'name', type: 'text', label: 'Name', parent_id: 'group1', hint: null, required: true, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null }
      ]
    })
    expect(result.success).toBe(true)
  })
})

// ── Assembly utilities ─────────────────────────────────────────────────

describe('unflattenQuestions', () => {
  it('keeps top-level questions at top level', () => {
    const flat: FlatQuestion[] = [
      { id: 'q1', type: 'text', label: 'Q1', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'q2', type: 'int', label: 'Q2', parent_id: null, hint: null, required: true, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
    ]
    const nested = unflattenQuestions(flat)
    expect(nested).toHaveLength(2)
    expect(nested[0].id).toBe('q1')
    expect(nested[1].id).toBe('q2')
    expect(nested[1].required).toBe(true)
  })

  it('nests children under their parent group', () => {
    const flat: FlatQuestion[] = [
      { id: 'grp', type: 'group', label: 'Group', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'child1', type: 'text', label: 'Child 1', parent_id: 'grp', hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'child2', type: 'int', label: 'Child 2', parent_id: 'grp', hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
    ]
    const nested = unflattenQuestions(flat)
    expect(nested).toHaveLength(1)
    expect(nested[0].id).toBe('grp')
    expect(nested[0].children).toHaveLength(2)
    expect(nested[0].children![0].id).toBe('child1')
    expect(nested[0].children![1].id).toBe('child2')
  })

  it('handles nested groups (group inside group)', () => {
    const flat: FlatQuestion[] = [
      { id: 'outer', type: 'group', label: 'Outer', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'inner', type: 'repeat', label: 'Inner', parent_id: 'outer', hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'deep', type: 'text', label: 'Deep', parent_id: 'inner', hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
    ]
    const nested = unflattenQuestions(flat)
    expect(nested).toHaveLength(1)
    expect(nested[0].children).toHaveLength(1)
    expect(nested[0].children![0].children).toHaveLength(1)
    expect(nested[0].children![0].children![0].id).toBe('deep')
  })

  it('strips null values (converts to undefined/omit)', () => {
    const flat: FlatQuestion[] = [
      { id: 'q', type: 'text', label: 'Q', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
    ]
    const nested = unflattenQuestions(flat)
    expect(nested[0].hint).toBeUndefined()
    expect(nested[0].required).toBeUndefined()
    expect(nested[0].options).toBeUndefined()
  })

  it('preserves non-null values', () => {
    const flat: FlatQuestion[] = [
      { id: 'q', type: 'text', label: 'Q', parent_id: null, hint: 'Help', required: true, readonly: false, constraint: '. > 0', constraint_msg: 'Nope', relevant: '/data/x = 1', calculate: null, options: null },
    ]
    const nested = unflattenQuestions(flat)
    expect(nested[0].hint).toBe('Help')
    expect(nested[0].required).toBe(true)
    expect(nested[0].readonly).toBe(false)
    expect(nested[0].constraint).toBe('. > 0')
  })
})

describe('flattenQuestions', () => {
  it('roundtrips through unflatten → flatten', () => {
    const flat: FlatQuestion[] = [
      { id: 'grp', type: 'group', label: 'G', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'c1', type: 'text', label: 'C1', parent_id: 'grp', hint: 'Help', required: true, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      { id: 'top', type: 'int', label: 'Top', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
    ]
    const nested = unflattenQuestions(flat)
    const backToFlat = flattenQuestions(nested)
    expect(backToFlat).toHaveLength(3)
    expect(backToFlat[0].id).toBe('grp')
    expect(backToFlat[0].parent_id).toBeNull()
    expect(backToFlat[1].id).toBe('c1')
    expect(backToFlat[1].parent_id).toBe('grp')
    expect(backToFlat[1].hint).toBe('Help')
    expect(backToFlat[1].required).toBe(true)
    expect(backToFlat[2].id).toBe('top')
    expect(backToFlat[2].parent_id).toBeNull()
  })
})

describe('closeCaseToFlat', () => {
  it('converts unconditional to null question/answer', () => {
    expect(closeCaseToFlat({})).toEqual({ question: null, answer: null })
  })

  it('converts conditional to flat', () => {
    expect(closeCaseToFlat({ question: 'q', answer: 'yes' })).toEqual({ question: 'q', answer: 'yes' })
  })

  it('converts undefined to null', () => {
    expect(closeCaseToFlat(undefined)).toBeNull()
  })
})

describe('assembleBlueprint', () => {
  it('assembles a full blueprint from scaffold + modules + forms', () => {
    const scaffold: Scaffold = {
      app_name: 'Test App',
      description: 'A test',
      case_types: [{ name: 'patient', properties: [{ name: 'age', label: 'Age' }] }],
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        purpose: 'Manage patients',
        forms: [
          { name: 'Register', type: 'registration', purpose: 'Register a patient' },
          { name: 'Followup', type: 'followup', purpose: 'Follow up' },
        ]
      }]
    }

    const moduleContents: ModuleContent[] = [
      { case_list_columns: [{ field: 'age', header: 'Age' }] }
    ]

    const formContents: FormContent[][] = [[
      {
        case_name_field: 'patient_name',
        case_properties: { age: 'age' },
        case_preload: null,
        close_case: null,
        child_cases: null,
        questions: [
          { id: 'patient_name', type: 'text', label: 'Patient Name', parent_id: null, hint: null, required: true, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
          { id: 'age', type: 'int', label: 'Age', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
        ]
      },
      {
        case_name_field: null,
        case_properties: null,
        case_preload: { current_age: 'age' },
        close_case: { question: null, answer: null },
        child_cases: null,
        questions: [
          { id: 'current_age', type: 'int', label: 'Age', parent_id: null, hint: null, required: null, readonly: true, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
        ]
      }
    ]]

    const blueprint = assembleBlueprint(scaffold, moduleContents, formContents)

    expect(blueprint.app_name).toBe('Test App')
    expect(blueprint.modules).toHaveLength(1)
    expect(blueprint.modules[0].name).toBe('Patients')
    expect(blueprint.modules[0].case_type).toBe('patient')
    expect(blueprint.modules[0].case_list_columns).toEqual([{ field: 'age', header: 'Age' }])

    // Registration form
    const reg = blueprint.modules[0].forms[0]
    expect(reg.name).toBe('Register')
    expect(reg.type).toBe('registration')
    expect(reg.case_name_field).toBe('patient_name')
    expect(reg.case_properties).toEqual({ age: 'age' })
    expect(reg.case_preload).toBeUndefined()
    expect(reg.close_case).toBeUndefined()
    expect(reg.questions).toHaveLength(2)
    expect(reg.questions[0].required).toBe(true)

    // Followup form
    const fu = blueprint.modules[0].forms[1]
    expect(fu.name).toBe('Followup')
    expect(fu.type).toBe('followup')
    expect(fu.case_name_field).toBeUndefined()
    expect(fu.case_preload).toEqual({ current_age: 'age' })
    expect(fu.close_case).toEqual({}) // flat {question: null, answer: null} → {}
    expect(fu.questions[0].readonly).toBe(true)
  })

  it('assembles conditional close_case correctly', () => {
    const scaffold: Scaffold = {
      app_name: 'Test',
      description: 'Test',
      case_types: null,
      modules: [{
        name: 'Mod',
        case_type: null,
        purpose: 'Test',
        forms: [{ name: 'F', type: 'followup', purpose: 'Close' }]
      }]
    }
    const moduleContents: ModuleContent[] = [{ case_list_columns: null }]
    const formContents: FormContent[][] = [[{
      case_name_field: null,
      case_properties: null,
      case_preload: null,
      close_case: { question: 'outcome', answer: 'done' },
      child_cases: null,
      questions: [
        { id: 'outcome', type: 'select1', label: 'Outcome', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: [{ value: 'active', label: 'Active' }, { value: 'done', label: 'Done' }] }
      ]
    }]]

    const blueprint = assembleBlueprint(scaffold, moduleContents, formContents)
    expect(blueprint.modules[0].forms[0].close_case).toEqual({ question: 'outcome', answer: 'done' })
  })

  it('assembles child_cases with nullable-to-optional conversion', () => {
    const scaffold: Scaffold = {
      app_name: 'Test',
      description: 'Test',
      case_types: null,
      modules: [{
        name: 'Mod',
        case_type: null,
        purpose: 'Test',
        forms: [{ name: 'F', type: 'registration', purpose: 'Register' }]
      }]
    }
    const moduleContents: ModuleContent[] = [{ case_list_columns: null }]
    const formContents: FormContent[][] = [[{
      case_name_field: 'name',
      case_properties: null,
      case_preload: null,
      close_case: null,
      child_cases: [{
        case_type: 'referral',
        case_name_field: 'ref_name',
        case_properties: { reason: 'reason' },
        relationship: 'extension',
        repeat_context: null
      }],
      questions: [
        { id: 'name', type: 'text', label: 'Name', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
        { id: 'ref_name', type: 'text', label: 'Referral', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
        { id: 'reason', type: 'text', label: 'Reason', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null },
      ]
    }]]

    const blueprint = assembleBlueprint(scaffold, moduleContents, formContents)
    const form = blueprint.modules[0].forms[0]
    expect(form.child_cases).toHaveLength(1)
    expect(form.child_cases![0].case_type).toBe('referral')
    expect(form.child_cases![0].relationship).toBe('extension')
    expect(form.child_cases![0].repeat_context).toBeUndefined() // null → omitted
  })

  it('omits null fields from assembled blueprint', () => {
    const scaffold: Scaffold = {
      app_name: 'Survey',
      description: 'A survey',
      case_types: null,
      modules: [{
        name: 'Surveys',
        case_type: null,
        purpose: 'Surveys',
        forms: [{ name: 'Survey', type: 'survey', purpose: 'Survey' }]
      }]
    }
    const moduleContents: ModuleContent[] = [{ case_list_columns: null }]
    const formContents: FormContent[][] = [[{
      case_name_field: null,
      case_properties: null,
      case_preload: null,
      close_case: null,
      child_cases: null,
      questions: [
        { id: 'q', type: 'text', label: 'Q', parent_id: null, hint: null, required: null, readonly: null, constraint: null, constraint_msg: null, relevant: null, calculate: null, options: null }
      ]
    }]]

    const blueprint = assembleBlueprint(scaffold, moduleContents, formContents)
    const mod = blueprint.modules[0]
    const form = mod.forms[0]

    // Module-level nulls omitted
    expect(mod.case_type).toBeUndefined()
    expect(mod.case_list_columns).toBeUndefined()

    // Form-level nulls omitted
    expect(form.case_name_field).toBeUndefined()
    expect(form.case_properties).toBeUndefined()
    expect(form.case_preload).toBeUndefined()
    expect(form.close_case).toBeUndefined()
    expect(form.child_cases).toBeUndefined()

    // Question-level nulls omitted
    expect(form.questions[0].hint).toBeUndefined()
    expect(form.questions[0].required).toBeUndefined()
  })
})
