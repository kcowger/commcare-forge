/**
 * Golden file regression test for HQ JSON structure.
 * Uses Vitest snapshot testing to catch structural regressions
 * in doc_types, field names, action structures, and column counts.
 */
import { describe, it, expect } from 'vitest'
import { expandToHqJson } from '../backend/src/services/hqJsonExpander'
import { HqValidator } from '../backend/src/services/hqValidator'
import type { CompactApp } from '../backend/src/schemas/compactApp'

const goldenApp: CompactApp = {
  app_name: 'Golden Test App',
  modules: [
    {
      name: 'Patients',
      case_type: 'patient',
      case_list_columns: [{ field: 'age', header: 'Age' }],
      forms: [
        {
          name: 'Register Patient',
          type: 'registration',
          case_name_field: 'patient_name',
          case_properties: { patient_age: 'age_years' },
          questions: [
            { id: 'patient_name', type: 'text', label: 'Patient Name' },
            { id: 'age_years', type: 'int', label: 'Age' }
          ]
        },
        {
          name: 'Follow-up Visit',
          type: 'followup',
          case_preload: { preloaded_name: 'case_name' },
          case_properties: { last_visit: 'visit_date' },
          close_case: { question: 'close_yn', answer: 'yes' },
          questions: [
            { id: 'preloaded_name', type: 'text', label: 'Patient Name', readonly: true },
            { id: 'visit_date', type: 'date', label: 'Visit Date' },
            { id: 'close_yn', type: 'select1', label: 'Close case?', options: [
              { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
            ]}
          ]
        }
      ]
    },
    {
      name: 'Surveys',
      forms: [{
        name: 'Feedback Survey',
        type: 'survey',
        questions: [{ id: 'feedback', type: 'text', label: 'Your feedback' }]
      }]
    }
  ]
}

function extractStructure(hqJson: Record<string, any>): Record<string, any> {
  return {
    doc_type: hqJson.doc_type,
    application_version: hqJson.application_version,
    langs: hqJson.langs,
    vellum_case_management: hqJson.vellum_case_management,
    modules: hqJson.modules.map((m: any) => ({
      doc_type: m.doc_type,
      module_type: m.module_type,
      case_type: m.case_type,
      case_details_doc_type: m.case_details?.doc_type,
      case_details_short_doc_type: m.case_details?.short?.doc_type,
      case_details_short_col_count: m.case_details?.short?.columns?.length,
      case_details_short_fields: m.case_details?.short?.columns?.map((c: any) => c.field),
      forms: m.forms.map((f: any) => ({
        doc_type: f.doc_type,
        form_type: f.form_type,
        requires: f.requires,
        actions_doc_type: f.actions?.doc_type,
        open_case_doc_type: f.actions?.open_case?.doc_type,
        open_case_condition_type: f.actions?.open_case?.condition?.type,
        open_case_condition_doc_type: f.actions?.open_case?.condition?.doc_type,
        update_case_doc_type: f.actions?.update_case?.doc_type,
        update_case_condition_type: f.actions?.update_case?.condition?.type,
        update_case_keys: Object.keys(f.actions?.update_case?.update || {}),
        close_case_condition_type: f.actions?.close_case?.condition?.type,
        preload_condition_type: f.actions?.case_preload?.condition?.type,
        preload_keys: Object.keys(f.actions?.case_preload?.preload || {}),
        subcases_count: f.actions?.subcases?.length,
        has_unique_id: !!f.unique_id,
        has_xmlns: !!f.xmlns,
      }))
    }))
  }
}

describe('HQ JSON golden file regression', () => {
  it('matches structural snapshot', () => {
    const hqJson = expandToHqJson(goldenApp)
    const structure = extractStructure(hqJson)
    expect(structure).toMatchSnapshot()
  })

  it('has correct doc_types at every level', () => {
    const hqJson = expandToHqJson(goldenApp)
    expect(hqJson.doc_type).toBe('Application')
    for (const mod of hqJson.modules) {
      expect(mod.doc_type).toBe('Module')
      expect(mod.case_details.doc_type).toBe('DetailPair')
      expect(mod.case_details.short.doc_type).toBe('Detail')
      expect(mod.case_details.long.doc_type).toBe('Detail')
      for (const form of mod.forms) {
        expect(form.doc_type).toBe('Form')
        expect(form.actions.doc_type).toBe('FormActions')
        expect(form.actions.open_case.doc_type).toBe('OpenCaseAction')
        expect(form.actions.update_case.doc_type).toBe('UpdateCaseAction')
        expect(form.actions.close_case.doc_type).toBe('FormAction')
        expect(form.actions.case_preload.doc_type).toBe('PreloadAction')
        expect(form.actions.open_case.condition.doc_type).toBe('FormActionCondition')
        expect(form.actions.update_case.condition.doc_type).toBe('FormActionCondition')
        expect(form.actions.close_case.condition.doc_type).toBe('FormActionCondition')
        expect(form.actions.case_preload.condition.doc_type).toBe('FormActionCondition')
      }
    }
  })

  it('has attachments for every form', () => {
    const hqJson = expandToHqJson(goldenApp)
    for (const mod of hqJson.modules) {
      for (const form of mod.forms) {
        const key = `${form.unique_id}.xml`
        expect(hqJson._attachments[key]).toBeDefined()
        expect(hqJson._attachments[key]).toContain('<h:html')
        expect(hqJson._attachments[key]).toContain('<itext>')
      }
    }
  })

  it('passes full HQ JSON structure validation', () => {
    const hqJson = expandToHqJson(goldenApp)
    const validator = new HqValidator()
    const result = validator.validateHqJsonStructure(hqJson)
    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('registration form opens and updates case', () => {
    const hqJson = expandToHqJson(goldenApp)
    const regForm = hqJson.modules[0].forms[0]
    expect(regForm.requires).toBe('none')
    expect(regForm.actions.open_case.condition.type).toBe('always')
    expect(regForm.actions.update_case.condition.type).toBe('always')
    expect(regForm.actions.update_case.update).toHaveProperty('patient_age')
  })

  it('followup form requires case and has preload + close', () => {
    const hqJson = expandToHqJson(goldenApp)
    const fuForm = hqJson.modules[0].forms[1]
    expect(fuForm.requires).toBe('case')
    expect(fuForm.actions.case_preload.condition.type).toBe('always')
    expect(fuForm.actions.close_case.condition.type).toBe('if')
    expect(fuForm.actions.close_case.condition.question).toContain('close_yn')
  })

  it('survey form has no case actions', () => {
    const hqJson = expandToHqJson(goldenApp)
    const surveyForm = hqJson.modules[1].forms[0]
    expect(surveyForm.requires).toBe('none')
    expect(surveyForm.actions.open_case.condition.type).toBe('never')
    expect(surveyForm.actions.update_case.condition.type).toBe('never')
  })
})
