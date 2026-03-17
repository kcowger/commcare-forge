/**
 * Tests that generate apps, compile CCZs, and run the CommCare CLI validator.
 * This is the ultimate test — if the CLI passes, HQ will accept the import.
 */
import { describe, it, expect } from 'vitest'
import { expandToHqJson } from '../backend/src/services/hqJsonExpander'
import { CczCompiler } from '../backend/src/services/cczCompiler'
import { CliValidator, checkJavaAvailable } from '../backend/src/services/cliValidator'
import type { CompactApp } from '../backend/src/schemas/compactApp'

async function buildAndValidate(compact: CompactApp): Promise<{ success: boolean; errors: string[]; stdout: string }> {
  const hqJson = expandToHqJson(compact)
  const compiler = new CczCompiler()
  const { cczPath } = await compiler.compile(hqJson, compact.app_name)
  const validator = new CliValidator('/Users/kaicowger/Library/Application Support/commcare-forge')
  return await validator.validate(cczPath)
}

describe('CLI validation of generated apps', async () => {
  const java = await checkJavaAvailable()
  const hasJava = java.available

  it.skipIf(!hasJava)('simple survey', async () => {
    const result = await buildAndValidate({
      app_name: 'Simple Survey',
      modules: [{ name: 'Survey', forms: [{ name: 'Basic Form', type: 'survey', questions: [
        { id: 'name', type: 'text', label: 'Name' },
        { id: 'age', type: 'int', label: 'Age' },
        { id: 'gender', type: 'select1', label: 'Gender', options: [
          { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }
        ]}
      ]}]}]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('registration + followup with case management', async () => {
    const result = await buildAndValidate({
      app_name: 'Patient Tracker',
      modules: [{ name: 'Patients', case_type: 'patient', forms: [
        { name: 'Register', type: 'registration', case_name_field: 'pname',
          case_properties: { age: 'page' },
          questions: [
            { id: 'pname', type: 'text', label: 'Patient Name' },
            { id: 'page', type: 'int', label: 'Age' }
          ]
        },
        { name: 'Visit', type: 'followup',
          case_preload: { show_name: 'name' },
          case_properties: { last_visit: 'vdate' },
          questions: [
            { id: 'show_name', type: 'text', label: 'Name', readonly: true },
            { id: 'vdate', type: 'date', label: 'Visit Date' }
          ]
        }
      ]}]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('select options with < > characters', async () => {
    const result = await buildAndValidate({
      app_name: 'Duration Survey',
      modules: [{ name: 'Activity', forms: [{ name: 'Duration Form', type: 'survey', questions: [{
        id: 'dur', type: 'select1', label: 'Duration', options: [
          { value: '<20', label: 'Under 20 min' },
          { value: '20-40', label: '20-40 min' },
          { value: '>40', label: 'Over 40 min' }
        ]
      }]}]}]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('multi-module with child cases', async () => {
    const result = await buildAndValidate({
      app_name: 'Mother Child',
      modules: [{ name: 'Mothers', case_type: 'mother', forms: [{
        name: 'Register Mother', type: 'registration', case_name_field: 'mname',
        child_cases: [{ case_type: 'child', case_name_field: 'cname', relationship: 'child' }],
        questions: [
          { id: 'mname', type: 'text', label: 'Mother Name' },
          { id: 'cname', type: 'text', label: 'Child Name' }
        ]
      }]}]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('groups + hidden calculations', async () => {
    const result = await buildAndValidate({
      app_name: 'BMI App',
      modules: [{ name: 'Screening', forms: [{ name: 'BMI Calculator', type: 'survey', questions: [
        { id: 'measures', type: 'group', label: 'Measurements', children: [
          { id: 'weight', type: 'decimal', label: 'Weight (kg)' },
          { id: 'height', type: 'decimal', label: 'Height (m)' }
        ]},
        { id: 'bmi', type: 'hidden', label: 'BMI', calculate: '/data/measures/weight div (/data/measures/height * /data/measures/height)' }
      ]}]}]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('multi-language Turkish-style pregnancy survey', async () => {
    const result = await buildAndValidate({
      app_name: 'Turkish Survey',
      languages: [{ code: 'en', label: 'English', default: true }, { code: 'tr', label: 'Turkish' }],
      modules: [
        { name: 'Registration', case_type: 'patient', forms: [{
          name: 'Register Patient', type: 'registration', case_name_field: 'pname',
          case_properties: { age: 'page', phone: 'phone' },
          questions: [
            { id: 'pname', type: 'text', label: 'Name', labels_by_language: { en: 'Name', tr: 'Isim' } },
            { id: 'page', type: 'int', label: 'Age', labels_by_language: { en: 'Age', tr: 'Yas' } },
            { id: 'phone', type: 'phone', label: 'Phone' }
          ]
        }]},
        { name: 'Screening', case_type: 'patient', forms: [{
          name: 'Activity Screen', type: 'followup',
          case_preload: { show_name: 'name' },
          case_properties: { screen_date: 'sdate', risk: 'risk_level' },
          questions: [
            { id: 'show_name', type: 'text', label: 'Patient', readonly: true },
            { id: 'sdate', type: 'date', label: 'Date' },
            { id: 'activity', type: 'select1', label: 'Activity Level', options: [
              { value: 'none', label: 'None' }, { value: 'light', label: 'Light' }, { value: 'moderate', label: 'Moderate' }
            ]},
            { id: 'duration', type: 'select1', label: 'Duration', options: [
              { value: '<20', label: 'Under 20 min' }, { value: '20-40', label: '20-40 min' }, { value: '>40', label: 'Over 40 min' }
            ]},
            { id: 'risk_level', type: 'hidden', label: 'Risk', calculate: "if(/data/activity = 'none', 'high', 'low')" }
          ]
        }]}
      ]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('close_case with conditional', async () => {
    const result = await buildAndValidate({
      app_name: 'Discharge App',
      modules: [{ name: 'Patients', case_type: 'patient', forms: [
        { name: 'Register', type: 'registration', case_name_field: 'pname',
          questions: [{ id: 'pname', type: 'text', label: 'Name' }] },
        { name: 'Discharge', type: 'followup',
          close_case: { question: 'confirm', answer: 'yes' },
          questions: [
            { id: 'confirm', type: 'select1', label: 'Confirm discharge?', options: [
              { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
            ]},
            { id: 'notes', type: 'text', label: 'Notes' }
          ]
        }
      ]}]
    })
    expect(result.success).toBe(true)
  })

  it.skipIf(!hasJava)('lookup tables', async () => {
    const result = await buildAndValidate({
      app_name: 'Lookup App',
      lookup_tables: [{
        tag: 'facilities',
        fields: [{ field_name: 'id', label: 'ID' }, { field_name: 'name', label: 'Name' }],
        data: [{ id: '1', name: 'Hospital A' }, { id: '2', name: 'Clinic B' }]
      }],
      modules: [{ name: 'Referrals', forms: [{ name: 'Refer', type: 'survey', questions: [{
        id: 'facility', type: 'select1', label: 'Facility',
        lookup_table: { tag: 'facilities', value_field: 'id', label_field: 'name' }
      }]}]}]
    })
    if (!result.success) console.log('LOOKUP ERRORS:', result.errors, 'STDOUT:', result.stdout, 'STDERR:', (result as any).stderr)
    expect(result.success).toBe(true)
  })
})
