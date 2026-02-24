import { describe, it, expect } from 'vitest'
import { validateCompact, expandToHqJson } from '../backend/src/services/hqJsonExpander'
import type { CompactApp } from '../backend/src/services/hqJsonExpander'

function minimalApp(overrides?: Partial<CompactApp>): CompactApp {
  return {
    app_name: 'Test App',
    modules: [{
      name: 'Registration',
      case_type: 'patient',
      forms: [{
        name: 'Register Patient',
        type: 'registration',
        case_name_field: 'patient_name',
        questions: [
          { id: 'patient_name', type: 'text', label: 'Patient Name' },
          { id: 'age', type: 'int', label: 'Age' }
        ]
      }]
    }],
    ...overrides
  }
}

function surveyApp(): CompactApp {
  return {
    app_name: 'Survey App',
    modules: [{
      name: 'Surveys',
      forms: [{
        name: 'Basic Survey',
        type: 'survey',
        questions: [
          { id: 'feedback', type: 'text', label: 'Your feedback' }
        ]
      }]
    }]
  }
}

// --- validateCompact ---

describe('validateCompact', () => {
  it('returns no errors for a valid minimal app', () => {
    const errors = validateCompact(minimalApp())
    expect(errors).toEqual([])
  })

  it('returns no errors for a valid survey app without case_type', () => {
    const errors = validateCompact(surveyApp())
    expect(errors).toEqual([])
  })

  it('errors on missing app_name', () => {
    const errors = validateCompact(minimalApp({ app_name: '' }))
    expect(errors).toContainEqual(expect.stringContaining('app_name'))
  })

  it('errors on empty modules', () => {
    const errors = validateCompact(minimalApp({ modules: [] }))
    expect(errors).toContainEqual(expect.stringContaining('No modules'))
  })

  it('errors when case forms exist but no case_type', () => {
    const app = minimalApp()
    app.modules[0].case_type = undefined
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('case_type'))
  })

  it('errors on form with no questions', () => {
    const app = minimalApp()
    app.modules[0].forms[0].questions = []
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('no questions'))
  })

  it('errors on select question with no options', () => {
    const app = minimalApp()
    app.modules[0].forms[0].questions.push({
      id: 'choice', type: 'select1', label: 'Pick one', options: []
    })
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('no options'))
  })

  it('errors on registration form without case_name_field', () => {
    const app = minimalApp()
    app.modules[0].forms[0].case_name_field = undefined
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('case_name_field'))
  })

  it('errors on case_name_field that does not match any question', () => {
    const app = minimalApp()
    app.modules[0].forms[0].case_name_field = 'nonexistent'
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining("doesn't match"))
  })

  it('errors on reserved word in case_properties', () => {
    const app = minimalApp()
    app.modules[0].forms[0].case_properties = { date: 'age' }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('reserved'))
  })

  it('errors on case_properties mapping to nonexistent question', () => {
    const app = minimalApp()
    app.modules[0].forms[0].case_properties = { visit_age: 'nonexistent_q' }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining("doesn't exist"))
  })

  it('errors on reserved word in case_preload', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Followup',
          type: 'followup',
          case_preload: { age: 'date' },
          questions: [{ id: 'age', type: 'int', label: 'Age' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('reserved'))
  })

  it('errors on reserved word in case_list_columns', () => {
    const app = minimalApp()
    app.modules[0].case_list_columns = [{ field: 'status', header: 'Status' }]
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('reserved'))
  })

  it('errors on question with no id', () => {
    const app = minimalApp()
    app.modules[0].forms[0].questions.push({ id: '', type: 'text', label: 'No ID' })
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('no id'))
  })

  it('errors on question with no type', () => {
    const app = minimalApp()
    app.modules[0].forms[0].questions.push({ id: 'q', type: '' as any, label: 'No type' })
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('no type'))
  })
})

// --- expandToHqJson ---

describe('expandToHqJson', () => {
  it('produces correct top-level structure', () => {
    const hq = expandToHqJson(minimalApp())
    expect(hq.doc_type).toBe('Application')
    expect(hq.name).toBe('Test App')
    expect(hq.langs).toEqual(['en'])
    expect(hq.modules).toHaveLength(1)
    expect(hq._attachments).toBeDefined()
  })

  it('generates correct number of modules and forms', () => {
    const app: CompactApp = {
      app_name: 'Multi',
      modules: [
        { name: 'Mod A', case_type: 'a', forms: [
          { name: 'F1', type: 'registration', case_name_field: 'q1', questions: [{ id: 'q1', type: 'text', label: 'Q1' }] },
          { name: 'F2', type: 'followup', questions: [{ id: 'q2', type: 'text', label: 'Q2' }] }
        ]},
        { name: 'Mod B', forms: [
          { name: 'F3', type: 'survey', questions: [{ id: 'q3', type: 'text', label: 'Q3' }] }
        ]}
      ]
    }
    const hq = expandToHqJson(app)
    expect(hq.modules).toHaveLength(2)
    expect(hq.modules[0].forms).toHaveLength(2)
    expect(hq.modules[1].forms).toHaveLength(1)
  })

  it('generates XForm XML with correct xmlns and itext', () => {
    const hq = expandToHqJson(minimalApp())
    const form = hq.modules[0].forms[0]
    const xform = hq._attachments[`${form.unique_id}.xml`]
    expect(xform).toContain('xmlns=')
    expect(xform).toContain(form.xmlns)
    expect(xform).toContain('<itext>')
    expect(xform).toContain("jr:itext('patient_name-label')")
    expect(xform).toContain("jr:itext('age-label')")
  })

  it('maps question types to correct body elements', () => {
    const app: CompactApp = {
      app_name: 'Types',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [
            { id: 'text_q', type: 'text', label: 'Text' },
            { id: 'sel_q', type: 'select1', label: 'Select', options: [{ value: 'a', label: 'A' }] },
            { id: 'multi_q', type: 'select', label: 'Multi', options: [{ value: 'x', label: 'X' }] },
            { id: 'img_q', type: 'image', label: 'Photo' },
            { id: 'trig_q', type: 'trigger', label: 'Note' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain('<input ref="/data/text_q">')
    expect(xform).toContain('<select1 ref="/data/sel_q">')
    expect(xform).toContain('<select ref="/data/multi_q">')
    expect(xform).toContain('<upload ref="/data/img_q"')
    expect(xform).toContain('<trigger ref="/data/trig_q">')
  })

  it('sets correct form actions for registration forms', () => {
    const hq = expandToHqJson(minimalApp())
    const actions = hq.modules[0].forms[0].actions
    expect(actions.open_case.condition.type).toBe('always')
    expect(actions.open_case.name_update.question_path).toBe('/data/patient_name')
  })

  it('sets correct form actions for followup forms', () => {
    const app: CompactApp = {
      app_name: 'FU',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Followup',
          type: 'followup',
          case_properties: { visit_notes: 'notes' },
          questions: [{ id: 'notes', type: 'text', label: 'Notes' }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const actions = hq.modules[0].forms[0].actions
    expect(actions.update_case.condition.type).toBe('always')
    expect(actions.update_case.update.visit_notes.question_path).toBe('/data/notes')
    expect(hq.modules[0].forms[0].requires).toBe('case')
  })

  it('filters reserved words from case_properties', () => {
    const app = minimalApp()
    app.modules[0].forms[0].case_properties = { date: 'age', visit_age: 'age' }
    const hq = expandToHqJson(app)
    const update = hq.modules[0].forms[0].actions.update_case.update
    expect(update.date).toBeUndefined()
    expect(update.visit_age).toBeDefined()
  })

  it('always includes case_name as first column in case details', () => {
    const app = minimalApp()
    app.modules[0].case_list_columns = [{ field: 'visit_age', header: 'Age' }]
    const hq = expandToHqJson(app)
    const cols = hq.modules[0].case_details.short.columns
    expect(cols[0].field).toBe('case_name')
    expect(cols[0].header.en).toBe('Name')
    expect(cols[1].field).toBe('visit_age')
  })

  it('generates itext entries for hints', () => {
    const app: CompactApp = {
      app_name: 'Hints',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [
            { id: 'q1', type: 'text', label: 'Name', hint: 'Enter full name' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain("jr:itext('q1-hint')")
    expect(xform).toContain('Enter full name')
  })

  it('generates itext entries for select options', () => {
    const app: CompactApp = {
      app_name: 'Opts',
      modules: [{
        name: 'Mod',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{
            id: 'color', type: 'select1', label: 'Color',
            options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }]
          }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain("jr:itext('color-red-label')")
    expect(xform).toContain("jr:itext('color-blue-label')")
    expect(xform).toContain('>Red<')
    expect(xform).toContain('>Blue<')
  })

  it('generates phone input with numeric appearance', () => {
    const app: CompactApp = {
      app_name: 'Phone Test',
      modules: [{
        name: 'Contacts',
        forms: [{
          name: 'Add Contact',
          type: 'survey',
          questions: [
            { id: 'phone', type: 'phone', label: 'Phone Number' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain('appearance="numeric"')
    expect(xform).toContain('<input ref="/data/phone" appearance="numeric">')
    expect(xform).toContain('type="xsd:string"')
  })

  it('generates time and datetime with correct xsd types', () => {
    const app: CompactApp = {
      app_name: 'Time Test',
      modules: [{
        name: 'Scheduling',
        forms: [{
          name: 'Schedule',
          type: 'survey',
          questions: [
            { id: 'start_time', type: 'time', label: 'Start Time' },
            { id: 'appointment', type: 'datetime', label: 'Appointment' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain('nodeset="/data/start_time" type="xsd:time"')
    expect(xform).toContain('nodeset="/data/appointment" type="xsd:dateTime"')
  })

  it('generates audio/video upload elements with correct mediatypes', () => {
    const app: CompactApp = {
      app_name: 'Media Test',
      modules: [{
        name: 'Media',
        forms: [{
          name: 'Collect Media',
          type: 'survey',
          questions: [
            { id: 'recording', type: 'audio', label: 'Voice Note' },
            { id: 'clip', type: 'video', label: 'Video Clip' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain('mediatype="audio/*"')
    expect(xform).toContain('mediatype="video/*"')
  })

  it('generates signature upload with signature appearance', () => {
    const app: CompactApp = {
      app_name: 'Sig Test',
      modules: [{
        name: 'Consent',
        forms: [{
          name: 'Get Consent',
          type: 'survey',
          questions: [
            { id: 'sig', type: 'signature', label: 'Signature' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain('appearance="signature"')
    expect(xform).toContain('mediatype="image/*"')
  })

  it('generates hidden field with no body element and calculate attribute', () => {
    const app: CompactApp = {
      app_name: 'Calc Test',
      modules: [{
        name: 'BMI',
        forms: [{
          name: 'Calculate BMI',
          type: 'survey',
          questions: [
            { id: 'weight', type: 'decimal', label: 'Weight (kg)' },
            { id: 'height', type: 'decimal', label: 'Height (m)' },
            { id: 'bmi', type: 'hidden', label: 'BMI', calculate: '/data/weight div (/data/height * /data/height)' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    // Should have data element and bind
    expect(xform).toContain('<bmi/>')
    expect(xform).toContain('nodeset="/data/bmi"')
    expect(xform).toContain('calculate="/data/weight div (/data/height * /data/height)"')
    // Should NOT have a body element for hidden field
    expect(xform).not.toContain('ref="/data/bmi">')
  })

  it('generates secret input element for passwords/PINs', () => {
    const app: CompactApp = {
      app_name: 'Auth Test',
      modules: [{
        name: 'Auth',
        forms: [{
          name: 'Login',
          type: 'survey',
          questions: [
            { id: 'pin', type: 'secret', label: 'Enter PIN' }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    expect(xform).toContain('<secret ref="/data/pin">')
    expect(xform).toContain('type="xsd:string"')
  })

  it('generates group with nested children as field-list', () => {
    const app: CompactApp = {
      app_name: 'Group Test',
      modules: [{
        name: 'Intake',
        forms: [{
          name: 'Register',
          type: 'survey',
          questions: [
            {
              id: 'personal_info', type: 'group', label: 'Personal Information',
              children: [
                { id: 'first_name', type: 'text', label: 'First Name' },
                { id: 'last_name', type: 'text', label: 'Last Name' }
              ]
            }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    // Group body element must have ref pointing to data node
    expect(xform).toContain('<group ref="/data/personal_info" appearance="field-list">')
    expect(xform).toContain('<first_name/>')
    expect(xform).toContain('<last_name/>')
    expect(xform).toContain('ref="/data/personal_info/first_name"')
    expect(xform).toContain('ref="/data/personal_info/last_name"')
  })

  it('generates repeat with nested children', () => {
    const app: CompactApp = {
      app_name: 'Repeat Test',
      modules: [{
        name: 'Family',
        forms: [{
          name: 'Register Family',
          type: 'survey',
          questions: [
            {
              id: 'children', type: 'repeat', label: 'Children',
              children: [
                { id: 'child_name', type: 'text', label: 'Child Name' },
                { id: 'child_age', type: 'int', label: 'Age' }
              ]
            }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const xform = hq._attachments[`${hq.modules[0].forms[0].unique_id}.xml`]
    // Repeat outer group must have ref pointing to data node
    expect(xform).toContain('<group ref="/data/children">')
    expect(xform).toContain('<repeat nodeset="/data/children">')
    expect(xform).toContain('ref="/data/children/child_name"')
    expect(xform).toContain('ref="/data/children/child_age"')
    expect(xform).toContain('nodeset="/data/children/child_age" type="xsd:int"')
  })

  it('validates questions inside groups/repeats', () => {
    const app: CompactApp = {
      app_name: 'Nested Validation',
      modules: [{
        name: 'Mod',
        case_type: 'person',
        forms: [{
          name: 'Form',
          type: 'registration',
          case_name_field: 'child_name',
          case_properties: { 'child_age': 'child_age' },
          questions: [
            {
              id: 'group1', type: 'group', label: 'Group',
              children: [
                { id: 'child_name', type: 'text', label: 'Name' },
                { id: 'child_age', type: 'int', label: 'Age' }
              ]
            }
          ]
        }]
      }]
    }
    // Should validate without errors — child IDs inside groups should be found
    const errors = validateCompact(app)
    expect(errors).toHaveLength(0)
  })

  // --- close_case validation ---

  it('allows close_case: true on followup form', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Close',
          type: 'followup',
          close_case: true,
          questions: [{ id: 'reason', type: 'text', label: 'Reason' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toHaveLength(0)
  })

  it('errors on close_case on registration form', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Register',
          type: 'registration',
          case_name_field: 'name',
          close_case: true,
          questions: [{ id: 'name', type: 'text', label: 'Name' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('not a followup'))
  })

  it('errors on close_case on survey form', () => {
    const app: CompactApp = {
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
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('not a followup'))
  })

  it('validates conditional close_case with valid question', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Discharge',
          type: 'followup',
          close_case: { question: 'outcome', answer: 'discharged' },
          questions: [{
            id: 'outcome', type: 'select1', label: 'Outcome',
            options: [{ value: 'active', label: 'Active' }, { value: 'discharged', label: 'Discharged' }]
          }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toHaveLength(0)
  })

  it('errors on conditional close_case referencing nonexistent question', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Discharge',
          type: 'followup',
          close_case: { question: 'nonexistent', answer: 'yes' },
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining("doesn't exist"))
  })

  it('errors on conditional close_case missing answer', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Close',
          type: 'followup',
          close_case: { question: 'q', answer: '' },
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('missing "answer"'))
  })

  // --- child_cases validation ---

  it('validates child_cases with valid fields', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Referral',
          type: 'followup',
          child_cases: [{
            case_type: 'referral',
            case_name_field: 'reason',
            case_properties: { facility: 'facility' }
          }],
          questions: [
            { id: 'reason', type: 'text', label: 'Reason' },
            { id: 'facility', type: 'text', label: 'Facility' }
          ]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toHaveLength(0)
  })

  it('errors on child_cases missing case_type', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Form',
          type: 'followup',
          child_cases: [{ case_type: '', case_name_field: 'q' }],
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('missing case_type'))
  })

  it('errors on child_cases with nonexistent case_name_field', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Form',
          type: 'followup',
          child_cases: [{ case_type: 'ref', case_name_field: 'nonexistent' }],
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining("doesn't match"))
  })

  it('errors on child_cases with reserved property name', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Form',
          type: 'followup',
          child_cases: [{ case_type: 'ref', case_name_field: 'q', case_properties: { status: 'q' } }],
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('reserved'))
  })

  it('errors on child_cases repeat_context pointing to non-repeat question', () => {
    const app: CompactApp = {
      app_name: 'Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Form',
          type: 'followup',
          child_cases: [{ case_type: 'ref', case_name_field: 'q', repeat_context: 'q' }],
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const errors = validateCompact(app)
    expect(errors).toContainEqual(expect.stringContaining('not a repeat group'))
  })
})

// --- close_case expansion ---

describe('expandToHqJson — close_case', () => {
  it('close_case: true sets condition to always', () => {
    const app: CompactApp = {
      app_name: 'Close Test',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [{
          name: 'Close Case',
          type: 'followup',
          close_case: true,
          questions: [{ id: 'reason', type: 'text', label: 'Reason' }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const actions = hq.modules[0].forms[0].actions
    expect(actions.close_case.condition.type).toBe('always')
  })

  it('conditional close_case sets condition type to if', () => {
    const app: CompactApp = {
      app_name: 'Conditional Close',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [{
          name: 'Discharge',
          type: 'followup',
          close_case: { question: 'outcome', answer: 'discharged' },
          questions: [{
            id: 'outcome', type: 'select1', label: 'Outcome',
            options: [{ value: 'active', label: 'Active' }, { value: 'discharged', label: 'Discharged' }]
          }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const condition = hq.modules[0].forms[0].actions.close_case.condition
    expect(condition.type).toBe('if')
    expect(condition.question).toBe('/data/outcome')
    expect(condition.answer).toBe('discharged')
    expect(condition.operator).toBe('=')
  })

  it('omitted close_case keeps condition as never (backward compat)', () => {
    const app: CompactApp = {
      app_name: 'No Close',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Followup',
          type: 'followup',
          questions: [{ id: 'notes', type: 'text', label: 'Notes' }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    expect(hq.modules[0].forms[0].actions.close_case.condition.type).toBe('never')
  })
})

// --- child_cases expansion ---

describe('expandToHqJson — child_cases', () => {
  it('generates subcases array with OpenSubCaseAction structure', () => {
    const app: CompactApp = {
      app_name: 'Child Case Test',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [{
          name: 'Create Referral',
          type: 'followup',
          child_cases: [{
            case_type: 'referral',
            case_name_field: 'referral_reason',
            case_properties: { facility: 'facility', urgency: 'urgency' }
          }],
          questions: [
            { id: 'referral_reason', type: 'text', label: 'Reason' },
            { id: 'facility', type: 'text', label: 'Facility' },
            { id: 'urgency', type: 'select1', label: 'Urgency', options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] }
          ]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const subcases = hq.modules[0].forms[0].actions.subcases
    expect(subcases).toHaveLength(1)
    expect(subcases[0].doc_type).toBe('OpenSubCaseAction')
    expect(subcases[0].case_type).toBe('referral')
    expect(subcases[0].name_update.question_path).toBe('/data/referral_reason')
    expect(subcases[0].case_properties.facility.question_path).toBe('/data/facility')
    expect(subcases[0].case_properties.urgency.question_path).toBe('/data/urgency')
    expect(subcases[0].relationship).toBe('child')
    expect(subcases[0].condition.type).toBe('always')
  })

  it('filters reserved property names from child case properties', () => {
    const app: CompactApp = {
      app_name: 'Reserved Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Form',
          type: 'followup',
          child_cases: [{
            case_type: 'ref',
            case_name_field: 'q',
            case_properties: { status: 'q', ref_note: 'q' }
          }],
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const props = hq.modules[0].forms[0].actions.subcases[0].case_properties
    expect(props.status).toBeUndefined()
    expect(props.ref_note).toBeDefined()
  })

  it('child_cases with repeat_context prefixes paths correctly', () => {
    const app: CompactApp = {
      app_name: 'Repeat Child Test',
      modules: [{
        name: 'Households',
        case_type: 'household',
        forms: [{
          name: 'Register Members',
          type: 'followup',
          child_cases: [{
            case_type: 'member',
            case_name_field: 'member_name',
            case_properties: { member_age: 'member_age' },
            repeat_context: 'members'
          }],
          questions: [{
            id: 'members', type: 'repeat', label: 'Household Members',
            children: [
              { id: 'member_name', type: 'text', label: 'Name' },
              { id: 'member_age', type: 'int', label: 'Age' }
            ]
          }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    const subcase = hq.modules[0].forms[0].actions.subcases[0]
    expect(subcase.name_update.question_path).toBe('/data/members/member_name')
    expect(subcase.case_properties.member_age.question_path).toBe('/data/members/member_age')
    expect(subcase.repeat_context).toBe('/data/members')
  })

  it('child_cases with relationship: extension sets relationship field', () => {
    const app: CompactApp = {
      app_name: 'Extension Test',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Form',
          type: 'followup',
          child_cases: [{
            case_type: 'pregnancy',
            case_name_field: 'q',
            relationship: 'extension'
          }],
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    expect(hq.modules[0].forms[0].actions.subcases[0].relationship).toBe('extension')
  })

  it('no child_cases produces empty subcases (backward compat)', () => {
    const app: CompactApp = {
      app_name: 'No Children',
      modules: [{
        name: 'Mod',
        case_type: 'patient',
        forms: [{
          name: 'Followup',
          type: 'followup',
          questions: [{ id: 'q', type: 'text', label: 'Q' }]
        }]
      }]
    }
    const hq = expandToHqJson(app)
    expect(hq.modules[0].forms[0].actions.subcases).toEqual([])
  })
})
