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
})
