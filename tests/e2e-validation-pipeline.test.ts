/**
 * End-to-end validation pipeline tests.
 * Tests every issue that has caused HQ import failures:
 * - Unescaped < > in option values
 * - Reserved words in case update/preload
 * - Missing labels on questions
 * - Missing calculate on hidden questions
 * - Malformed XML output
 */
import { describe, it, expect } from 'vitest'
import { expandToHqJson, validateCompact } from '../backend/src/services/hqJsonExpander'
import { parseXml } from '../backend/src/utils/xmlBuilder'
import { RESERVED_CASE_PROPERTIES } from '../backend/src/constants/reservedCaseProperties'
import type { CompactApp } from '../backend/src/schemas/compactApp'

/** Validate the full pipeline: compact → expand → HQ JSON → XML parsing */
function validateFullPipeline(compact: CompactApp): { errors: string[] } {
  const errors: string[] = []

  // Phase 1: Compact validation
  errors.push(...validateCompact(compact))
  if (errors.length > 0) return { errors }

  // Phase 2: Expansion
  let hqJson: Record<string, any>
  try {
    hqJson = expandToHqJson(compact)
  } catch (e: any) {
    errors.push(`Expansion crash: ${e.message}`)
    return { errors }
  }

  // Phase 3: HQ JSON validation
  const attachments = hqJson._attachments || {}

  // Parse all XForms
  for (const [key, xml] of Object.entries(attachments)) {
    if (!key.endsWith('.xml')) continue
    try {
      parseXml(xml as string)
    } catch (e: any) {
      errors.push(`${key}: Invalid XML — ${e.message}`)
    }
  }

  // Check reserved words in form actions
  for (const mod of hqJson.modules || []) {
    for (const form of mod.forms || []) {
      const fname = form.name?.en || 'Unknown'
      const actions = form.actions || {}

      if (actions.update_case?.condition?.type === 'always') {
        for (const prop of Object.keys(actions.update_case.update || {})) {
          if (RESERVED_CASE_PROPERTIES.has(prop)) {
            errors.push(`"${fname}" update uses reserved word "${prop}"`)
          }
        }
      }

      if (actions.case_preload?.condition?.type === 'always') {
        for (const val of Object.values(actions.case_preload.preload || {}) as string[]) {
          if (val === 'case_name' || val === 'case_type' || val === 'case_id') {
            errors.push(`"${fname}" preload uses "${val}" — must be remapped`)
          }
        }
      }

      for (const sc of actions.subcases || []) {
        if (sc.case_properties) {
          for (const prop of Object.keys(sc.case_properties)) {
            if (RESERVED_CASE_PROPERTIES.has(prop)) {
              errors.push(`"${fname}" subcase uses reserved word "${prop}"`)
            }
          }
        }
      }
    }
  }

  return { errors }
}

describe('Full validation pipeline', () => {

  it('passes a simple valid survey', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Test Survey',
      modules: [{
        name: 'Survey Module',
        forms: [{
          name: 'Basic Survey',
          type: 'survey',
          questions: [
            { id: 'name', type: 'text', label: 'What is your name?' },
            { id: 'age', type: 'int', label: 'How old are you?', constraint: '. > 0 and . < 150' },
            { id: 'gender', type: 'select1', label: 'Gender', options: [
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'other', label: 'Other' }
            ]}
          ]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('passes a registration + followup app with case management', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Patient Tracker',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [
          {
            name: 'Register Patient',
            type: 'registration',
            case_name_field: 'patient_name',
            case_properties: { age: 'patient_age', village: 'village' },
            questions: [
              { id: 'patient_name', type: 'text', label: 'Patient Name', required: true },
              { id: 'patient_age', type: 'int', label: 'Age' },
              { id: 'village', type: 'text', label: 'Village' }
            ]
          },
          {
            name: 'Follow-up Visit',
            type: 'followup',
            case_preload: { display_name: 'name', display_age: 'age' },
            case_properties: { last_visit: 'visit_date' },
            questions: [
              { id: 'display_name', type: 'text', label: 'Patient Name', readonly: true },
              { id: 'display_age', type: 'int', label: 'Age', readonly: true },
              { id: 'visit_date', type: 'date', label: 'Visit Date', required: true }
            ]
          }
        ]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles option values with < > characters without breaking XML', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Duration Survey',
      modules: [{
        name: 'Activity',
        forms: [{
          name: 'Duration Form',
          type: 'survey',
          questions: [{
            id: 'duration',
            type: 'select1',
            label: 'How long?',
            options: [
              { value: '<20', label: 'Less than 20 minutes' },
              { value: '20-30', label: '20-30 minutes' },
              { value: '31-60', label: '31-60 minutes' },
              { value: '>60', label: 'More than 60 minutes' }
            ]
          }]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('remaps case_name in preload to name', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Preload Test',
      modules: [{
        name: 'Cases',
        case_type: 'patient',
        forms: [
          {
            name: 'Register',
            type: 'registration',
            case_name_field: 'pname',
            questions: [{ id: 'pname', type: 'text', label: 'Name' }]
          },
          {
            name: 'Followup',
            type: 'followup',
            case_preload: { show_name: 'case_name' },
            questions: [
              { id: 'show_name', type: 'text', label: 'Name', readonly: true },
              { id: 'notes', type: 'text', label: 'Notes' }
            ]
          }
        ]
      }]
    })
    // Should pass because the expander remaps case_name → name
    expect(errors).toEqual([])
  })

  it('auto-renames reserved words in case properties', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Reserved Words Test',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [{
          name: 'Register',
          type: 'registration',
          case_name_field: 'pname',
          case_properties: { status: 'patient_status', date: 'visit_date' },
          questions: [
            { id: 'pname', type: 'text', label: 'Name' },
            { id: 'patient_status', type: 'select1', label: 'Status', options: [
              { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }
            ]},
            { id: 'visit_date', type: 'date', label: 'Date' }
          ]
        }]
      }]
    })
    // Should pass because buildSafeUpdateMap renames status → case_status, date → visit_date
    expect(errors).toEqual([])
  })

  it('handles child cases (subcases)', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Mother-Child',
      modules: [{
        name: 'Mothers',
        case_type: 'mother',
        forms: [{
          name: 'Register Mother',
          type: 'registration',
          case_name_field: 'mother_name',
          child_cases: [{
            case_type: 'pregnancy',
            case_name_field: 'pregnancy_label',
            case_properties: { edd: 'edd' },
            relationship: 'extension'
          }],
          questions: [
            { id: 'mother_name', type: 'text', label: 'Mother Name' },
            { id: 'pregnancy_label', type: 'text', label: 'Pregnancy Label' },
            { id: 'edd', type: 'date', label: 'Expected Delivery Date' }
          ]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles multi-language apps', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Multilang',
      languages: [
        { code: 'en', label: 'English', default: true },
        { code: 'tr', label: 'Turkish' }
      ],
      modules: [{
        name: 'Survey',
        forms: [{
          name: 'Questions',
          type: 'survey',
          questions: [{
            id: 'q1',
            type: 'text',
            label: 'What is your name?',
            labels_by_language: { en: 'What is your name?', tr: 'Adınız nedir?' }
          }]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles groups and repeat groups', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Grouped',
      modules: [{
        name: 'Survey',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [{
            id: 'demographics',
            type: 'group',
            label: 'Demographics',
            children: [
              { id: 'name', type: 'text', label: 'Name' },
              { id: 'age', type: 'int', label: 'Age' }
            ]
          }, {
            id: 'children',
            type: 'repeat',
            label: 'Children',
            children: [
              { id: 'child_name', type: 'text', label: 'Child Name' },
              { id: 'child_age', type: 'int', label: 'Child Age' }
            ]
          }]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles hidden/calculated fields', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Calculated',
      modules: [{
        name: 'Survey',
        forms: [{
          name: 'Form',
          type: 'survey',
          questions: [
            { id: 'weight', type: 'decimal', label: 'Weight (kg)' },
            { id: 'height', type: 'decimal', label: 'Height (m)' },
            { id: 'bmi', type: 'hidden', label: 'BMI', calculate: '/data/weight div (/data/height * /data/height)' }
          ]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles close_case with condition', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Close Test',
      modules: [{
        name: 'Patients',
        case_type: 'patient',
        forms: [
          {
            name: 'Register',
            type: 'registration',
            case_name_field: 'pname',
            questions: [{ id: 'pname', type: 'text', label: 'Name' }]
          },
          {
            name: 'Discharge',
            type: 'followup',
            close_case: { question: 'confirm_close', answer: 'yes' },
            questions: [
              { id: 'confirm_close', type: 'select1', label: 'Close case?', options: [
                { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
              ]},
              { id: 'notes', type: 'text', label: 'Notes' }
            ]
          }
        ]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles lookup tables', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Lookup Test',
      lookup_tables: [{
        tag: 'facilities',
        fields: [
          { field_name: 'id', label: 'ID' },
          { field_name: 'name', label: 'Name' }
        ],
        data: [
          { id: '1', name: 'Hospital A' },
          { id: '2', name: 'Clinic B' }
        ]
      }],
      modules: [{
        name: 'Referrals',
        forms: [{
          name: 'Referral',
          type: 'survey',
          questions: [{
            id: 'facility',
            type: 'select1',
            label: 'Select Facility',
            lookup_table: { tag: 'facilities', value_field: 'id', label_field: 'name' }
          }]
        }]
      }]
    })
    expect(errors).toEqual([])
  })

  it('handles complex multi-module app like Turkish pregnancy survey', () => {
    const { errors } = validateFullPipeline({
      app_name: 'Turkish Pregnancy Activity Survey',
      languages: [
        { code: 'en', label: 'English', default: true },
        { code: 'tr', label: 'Turkish' }
      ],
      modules: [
        {
          name: 'Patient Registration',
          case_type: 'patient',
          forms: [{
            name: 'Register Patient',
            type: 'registration',
            case_name_field: 'patient_name',
            case_properties: { age: 'age', gestational_weeks: 'gestational_weeks', phone: 'phone' },
            questions: [
              { id: 'patient_name', type: 'text', label: 'Patient Name' },
              { id: 'age', type: 'int', label: 'Age' },
              { id: 'gestational_weeks', type: 'int', label: 'Gestational Weeks' },
              { id: 'phone', type: 'phone', label: 'Phone Number' }
            ]
          }]
        },
        {
          name: 'Physical Activity Screening',
          case_type: 'patient',
          forms: [
            {
              name: 'Initial Screening',
              type: 'followup',
              case_preload: { patient_name_display: 'name' },
              case_properties: {
                screening_date: 'screening_date',
                clearance_status: 'clearance_result',
                risk_score: 'total_score'
              },
              questions: [
                { id: 'patient_name_display', type: 'text', label: 'Patient Name', readonly: true },
                { id: 'screening_date', type: 'date', label: 'Screening Date', required: true },
                {
                  id: 'medical_history',
                  type: 'group',
                  label: 'Medical History',
                  children: [
                    { id: 'has_heart_disease', type: 'select1', label: 'Heart disease?', options: [
                      { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
                    ]},
                    { id: 'has_diabetes', type: 'select1', label: 'Diabetes?', options: [
                      { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
                    ]},
                    { id: 'has_hypertension', type: 'select1', label: 'Hypertension?', options: [
                      { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
                    ]}
                  ]
                },
                {
                  id: 'activity_assessment',
                  type: 'group',
                  label: 'Current Activity Level',
                  children: [
                    { id: 'exercise_frequency', type: 'select1', label: 'Exercise frequency', options: [
                      { value: 'none', label: 'None' },
                      { value: '1-2', label: '1-2 times/week' },
                      { value: '3-4', label: '3-4 times/week' },
                      { value: '5+', label: '5 or more times/week' }
                    ]},
                    { id: 'exercise_duration', type: 'select1', label: 'Session duration', options: [
                      { value: '<20', label: 'Less than 20 min' },
                      { value: '20-30', label: '20-30 min' },
                      { value: '31-60', label: '31-60 min' },
                      { value: '>60', label: 'More than 60 min' }
                    ]},
                    { id: 'exercise_intensity', type: 'select1', label: 'Intensity', options: [
                      { value: 'light', label: 'Light' },
                      { value: 'moderate', label: 'Moderate' },
                      { value: 'vigorous', label: 'Vigorous' }
                    ]}
                  ]
                },
                { id: 'total_score', type: 'hidden', label: 'Risk Score', calculate: "if(/data/medical_history/has_heart_disease = 'yes', 30, 0) + if(/data/medical_history/has_diabetes = 'yes', 20, 0) + if(/data/medical_history/has_hypertension = 'yes', 15, 0)" },
                { id: 'clearance_result', type: 'hidden', label: 'Clearance', calculate: "if(/data/total_score > 60, 'high', if(/data/total_score > 30, 'medium', 'low'))" }
              ]
            }
          ]
        }
      ]
    })
    expect(errors).toEqual([])
  })
})
