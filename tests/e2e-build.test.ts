/**
 * End-to-end build tests exercising the full pipeline:
 * compact JSON → validate → expand → auto-fix → HQ validate → CCZ compile.
 *
 * These test realistic app structures including grouped questions,
 * child cases, preloads, and multi-module apps.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { handleBuild, handleValidate } from '../mcp-server/src/tools'
import { expandToHqJson } from '../backend/src/services/hqJsonExpander'
import { HqValidator } from '../backend/src/services/hqValidator'
import { existsSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { CompactApp } from '../backend/src/schemas/compactApp'

const testOutputDir = join(tmpdir(), `e2e-test-${randomUUID()}`)

afterAll(() => {
  if (existsSync(testOutputDir)) {
    rmSync(testOutputDir, { recursive: true })
  }
})

// --- Grouped questions with case properties ---

describe('e2e: grouped questions with case properties', () => {
  const app: CompactApp = {
    app_name: 'Water Point Survey',
    modules: [{
      name: 'Water Points',
      case_type: 'water_point',
      forms: [{
        name: 'Register Water Point',
        type: 'registration',
        case_name_field: 'wp_name',
        case_properties: {
          latitude: 'gps_lat',
          longitude: 'gps_lon',
          source_type: 'water_source',
          operator_name: 'op_name'
        },
        questions: [
          { id: 'wp_name', type: 'text', label: 'Water Point Name' },
          {
            id: 'location_section',
            type: 'group',
            label: 'Location Information',
            children: [
              { id: 'gps_lat', type: 'geopoint', label: 'GPS Latitude' },
              { id: 'gps_lon', type: 'geopoint', label: 'GPS Longitude' }
            ]
          },
          {
            id: 'details_section',
            type: 'group',
            label: 'Water Point Details',
            children: [
              { id: 'water_source', type: 'select1', label: 'Source Type', options: [
                { value: 'well', label: 'Well' },
                { value: 'borehole', label: 'Borehole' },
                { value: 'spring', label: 'Spring' }
              ]},
              { id: 'op_name', type: 'text', label: 'Operator Name' }
            ]
          }
        ]
      }]
    }]
  }

  it('validates without errors', async () => {
    const result = await handleValidate({ compact_json: app })
    expect(result.valid).toBe(true)
  })

  it('builds successfully with correct grouped paths', async () => {
    const dir = join(testOutputDir, 'water-point')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
    expect(existsSync(result.ccz_path!)).toBe(true)
    expect(existsSync(result.hq_json_path!)).toBe(true)
  })

  it('generates correct XForm paths for grouped questions', () => {
    const hq = expandToHqJson(app)
    const actions = hq.modules[0].forms[0].actions

    // case_name_field is at top level — should be /data/wp_name
    expect(actions.open_case.name_update.question_path).toBe('/data/wp_name')

    // Grouped questions should have full paths
    expect(actions.update_case.update.latitude.question_path).toBe('/data/location_section/gps_lat')
    expect(actions.update_case.update.longitude.question_path).toBe('/data/location_section/gps_lon')
    expect(actions.update_case.update.source_type.question_path).toBe('/data/details_section/water_source')
    expect(actions.update_case.update.operator_name.question_path).toBe('/data/details_section/op_name')
  })

  it('passes HQ validation on expanded files', () => {
    const hq = expandToHqJson(app)
    const validator = new HqValidator()
    const result = validator.validate(hq._attachments || {})
    expect(result.errors).toEqual([])
  })

  it('XForm XML contains correct bind paths for grouped questions', () => {
    const hq = expandToHqJson(app)
    const xformKey = Object.keys(hq._attachments || {}).find(k => k.endsWith('.xml') && k !== 'suite.xml' && !k.endsWith('.ccpr'))!
    const xform = (hq._attachments as Record<string, string>)[xformKey]

    // Grouped questions should have nested bind nodesets
    expect(xform).toContain('nodeset="/data/location_section/gps_lat"')
    expect(xform).toContain('nodeset="/data/location_section/gps_lon"')
    expect(xform).toContain('nodeset="/data/details_section/water_source"')
    expect(xform).toContain('nodeset="/data/details_section/op_name"')

    // Note: case management calculate binds are NOT in the XForm XML —
    // CommCare HQ injects them at build time from the actions metadata.
  })
})

// --- Child cases (parent-child relationship) ---

describe('e2e: child cases', () => {
  const app: CompactApp = {
    app_name: 'Patient Referral App',
    modules: [{
      name: 'Patients',
      case_type: 'patient',
      forms: [
        {
          name: 'Register Patient',
          type: 'registration',
          case_name_field: 'patient_name',
          case_properties: { age: 'patient_age', village: 'patient_village' },
          questions: [
            { id: 'patient_name', type: 'text', label: 'Patient Name' },
            { id: 'patient_age', type: 'int', label: 'Age' },
            { id: 'patient_village', type: 'text', label: 'Village' }
          ]
        },
        {
          name: 'Create Referral',
          type: 'followup',
          case_properties: { last_referral_date: 'referral_date' },
          child_cases: [{
            case_type: 'referral',
            case_name_field: 'referral_reason',
            relationship: 'child',
            case_properties: {
              facility: 'facility_name',
              urgency: 'urgency_level',
              referral_date: 'referral_date'
            }
          }],
          questions: [
            { id: 'referral_date', type: 'date', label: 'Referral Date' },
            { id: 'referral_reason', type: 'text', label: 'Reason for Referral' },
            { id: 'facility_name', type: 'text', label: 'Facility Name' },
            { id: 'urgency_level', type: 'select1', label: 'Urgency', options: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' }
            ]}
          ]
        }
      ]
    }]
  }

  it('validates without errors', async () => {
    const result = await handleValidate({ compact_json: app })
    expect(result.valid).toBe(true)
  })

  it('builds successfully', async () => {
    const dir = join(testOutputDir, 'referral')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
    expect(existsSync(result.ccz_path!)).toBe(true)
  })

  it('generates correct subcase structure', () => {
    const hq = expandToHqJson(app)
    const referralForm = hq.modules[0].forms[1]
    const subcases = referralForm.actions.subcases

    expect(subcases).toHaveLength(1)
    expect(subcases[0].doc_type).toBe('OpenSubCaseAction')
    expect(subcases[0].case_type).toBe('referral')
    expect(subcases[0].reference_id).toBe('parent')
    expect(subcases[0].relationship).toBe('child')
    expect(subcases[0].name_update.question_path).toBe('/data/referral_reason')
    expect(subcases[0].case_properties.facility.question_path).toBe('/data/facility_name')
    expect(subcases[0].case_properties.urgency.question_path).toBe('/data/urgency_level')
    expect(subcases[0].case_properties.referral_date.question_path).toBe('/data/referral_date')
    expect(subcases[0].condition.type).toBe('always')
  })

  it('passes HQ validation', () => {
    const hq = expandToHqJson(app)
    const validator = new HqValidator()
    const result = validator.validate(hq._attachments || {})
    expect(result.errors).toEqual([])
  })
})

// --- Child cases with repeat context ---

describe('e2e: child cases in repeat groups', () => {
  const app: CompactApp = {
    app_name: 'Household Survey',
    modules: [{
      name: 'Households',
      case_type: 'household',
      forms: [{
        name: 'Register Household Members',
        type: 'followup',
        child_cases: [{
          case_type: 'household_member',
          case_name_field: 'member_name',
          case_properties: { member_age: 'member_age', member_gender: 'member_gender' },
          repeat_context: 'members'
        }],
        questions: [{
          id: 'members',
          type: 'repeat',
          label: 'Household Members',
          children: [
            { id: 'member_name', type: 'text', label: 'Name' },
            { id: 'member_age', type: 'int', label: 'Age' },
            { id: 'member_gender', type: 'select1', label: 'Gender', options: [
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' }
            ]}
          ]
        }]
      }]
    }]
  }

  it('validates without errors', async () => {
    const result = await handleValidate({ compact_json: app })
    expect(result.valid).toBe(true)
  })

  it('builds successfully', async () => {
    const dir = join(testOutputDir, 'household')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
  })

  it('generates correct repeat context paths', () => {
    const hq = expandToHqJson(app)
    const subcase = hq.modules[0].forms[0].actions.subcases[0]

    expect(subcase.repeat_context).toBe('/data/members')
    expect(subcase.name_update.question_path).toBe('/data/members/member_name')
    expect(subcase.case_properties.member_age.question_path).toBe('/data/members/member_age')
    expect(subcase.case_properties.member_gender.question_path).toBe('/data/members/member_gender')
    expect(subcase.reference_id).toBe('parent')
  })
})

// --- Followup form with preloads and grouped questions ---

describe('e2e: followup with preloads in groups', () => {
  const app: CompactApp = {
    app_name: 'ANC Followup App',
    modules: [{
      name: 'Pregnancies',
      case_type: 'pregnancy',
      forms: [
        {
          name: 'Register Pregnancy',
          type: 'registration',
          case_name_field: 'mother_name',
          case_properties: { edd: 'expected_date', village: 'village_name' },
          questions: [
            { id: 'mother_name', type: 'text', label: 'Mother Name' },
            { id: 'expected_date', type: 'date', label: 'Expected Delivery Date' },
            { id: 'village_name', type: 'text', label: 'Village' }
          ]
        },
        {
          name: 'ANC Visit',
          type: 'followup',
          case_preload: {
            preload_mother_name: 'case_name',
            preload_edd: 'edd'
          },
          case_properties: {
            last_visit_date: 'visit_date',
            blood_pressure: 'bp_reading',
            weight: 'weight_kg'
          },
          questions: [
            {
              id: 'preload_group',
              type: 'group',
              label: 'Patient Info',
              children: [
                { id: 'preload_mother_name', type: 'text', label: 'Mother Name', readonly: true },
                { id: 'preload_edd', type: 'text', label: 'EDD', readonly: true }
              ]
            },
            {
              id: 'vitals_group',
              type: 'group',
              label: 'Vitals',
              children: [
                { id: 'visit_date', type: 'date', label: 'Visit Date' },
                { id: 'bp_reading', type: 'text', label: 'Blood Pressure' },
                { id: 'weight_kg', type: 'decimal', label: 'Weight (kg)' }
              ]
            }
          ]
        }
      ]
    }]
  }

  it('validates without errors', async () => {
    const result = await handleValidate({ compact_json: app })
    expect(result.valid).toBe(true)
  })

  it('builds successfully', async () => {
    const dir = join(testOutputDir, 'anc')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
    expect(existsSync(result.ccz_path!)).toBe(true)
  })

  it('generates correct preload paths for grouped questions', () => {
    const hq = expandToHqJson(app)
    const followupActions = hq.modules[0].forms[1].actions

    // Preloads should use full grouped paths
    expect(followupActions.case_preload.preload).toEqual({
      '/data/preload_group/preload_mother_name': 'name',
      '/data/preload_group/preload_edd': 'edd'
    })

    // Case properties should use full grouped paths
    expect(followupActions.update_case.update.last_visit_date.question_path).toBe('/data/vitals_group/visit_date')
    expect(followupActions.update_case.update.blood_pressure.question_path).toBe('/data/vitals_group/bp_reading')
    expect(followupActions.update_case.update.weight.question_path).toBe('/data/vitals_group/weight_kg')
  })

  it('passes HQ validation', () => {
    const hq = expandToHqJson(app)
    const validator = new HqValidator()
    const result = validator.validate(hq._attachments || {})
    expect(result.errors).toEqual([])
  })
})

// --- Multi-module app with close case ---

describe('e2e: multi-module with close case', () => {
  const app: CompactApp = {
    app_name: 'Disease Surveillance',
    modules: [
      {
        name: 'Cases',
        case_type: 'disease_case',
        forms: [
          {
            name: 'Register Case',
            type: 'registration',
            case_name_field: 'patient_id',
            case_properties: {
              disease_type: 'disease',
              onset_date: 'onset'
            },
            questions: [
              { id: 'patient_id', type: 'text', label: 'Patient ID' },
              { id: 'disease', type: 'select1', label: 'Disease', options: [
                { value: 'malaria', label: 'Malaria' },
                { value: 'cholera', label: 'Cholera' },
                { value: 'measles', label: 'Measles' }
              ]},
              { id: 'onset', type: 'date', label: 'Symptom Onset Date' }
            ]
          },
          {
            name: 'Close Case',
            type: 'followup',
            close_case: {
              question: 'outcome',
              answer: 'resolved'
            },
            case_properties: { outcome: 'outcome', close_date: 'close_date' },
            questions: [
              { id: 'outcome', type: 'select1', label: 'Outcome', options: [
                { value: 'resolved', label: 'Resolved' },
                { value: 'referred', label: 'Referred' },
                { value: 'deceased', label: 'Deceased' }
              ]},
              { id: 'close_date', type: 'date', label: 'Close Date' }
            ]
          }
        ]
      },
      {
        name: 'Surveys',
        forms: [{
          name: 'Community Survey',
          type: 'survey',
          questions: [
            { id: 'community_name', type: 'text', label: 'Community' },
            { id: 'num_households', type: 'int', label: 'Number of Households' }
          ]
        }]
      }
    ]
  }

  it('validates without errors', async () => {
    const result = await handleValidate({ compact_json: app })
    expect(result.valid).toBe(true)
  })

  it('builds successfully', async () => {
    const dir = join(testOutputDir, 'surveillance')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
    expect(existsSync(result.ccz_path!)).toBe(true)
  })

  it('generates close_case condition correctly', () => {
    const hq = expandToHqJson(app)
    const closeAction = hq.modules[0].forms[1].actions.close_case

    expect(closeAction.condition.type).toBe('if')
    expect(closeAction.condition.question).toBe('/data/outcome')
    expect(closeAction.condition.answer).toBe('resolved')
  })

  it('survey module has no case management', () => {
    const hq = expandToHqJson(app)
    const surveyForm = hq.modules[1].forms[0]
    expect(surveyForm.requires).toBe('none')
  })

  it('passes HQ validation', () => {
    const hq = expandToHqJson(app)
    const validator = new HqValidator()
    const result = validator.validate(hq._attachments || {})
    expect(result.errors).toEqual([])
  })
})

// --- Extension case relationship ---

describe('e2e: extension case relationship', () => {
  const app: CompactApp = {
    app_name: 'Pregnancy Tracker',
    modules: [{
      name: 'Mothers',
      case_type: 'mother',
      forms: [{
        name: 'Register Pregnancy',
        type: 'followup',
        child_cases: [{
          case_type: 'pregnancy',
          case_name_field: 'pregnancy_id',
          relationship: 'extension',
          case_properties: { edd: 'expected_delivery' }
        }],
        questions: [
          { id: 'pregnancy_id', type: 'text', label: 'Pregnancy ID' },
          { id: 'expected_delivery', type: 'date', label: 'Expected Delivery Date' }
        ]
      }]
    }]
  }

  it('builds successfully with extension relationship', async () => {
    const dir = join(testOutputDir, 'pregnancy')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
  })

  it('sets extension relationship on subcase', () => {
    const hq = expandToHqJson(app)
    const subcase = hq.modules[0].forms[0].actions.subcases[0]
    expect(subcase.relationship).toBe('extension')
    expect(subcase.reference_id).toBe('parent')
  })
})

// --- Deeply nested groups ---

describe('e2e: deeply nested groups', () => {
  const app: CompactApp = {
    app_name: 'Nested Groups App',
    modules: [{
      name: 'Registration',
      case_type: 'person',
      forms: [{
        name: 'Register',
        type: 'registration',
        case_name_field: 'full_name',
        case_properties: { city: 'city_name' },
        questions: [
          { id: 'full_name', type: 'text', label: 'Full Name' },
          {
            id: 'outer_group',
            type: 'group',
            label: 'Outer',
            children: [{
              id: 'inner_group',
              type: 'group',
              label: 'Inner',
              children: [
                { id: 'city_name', type: 'text', label: 'City' }
              ]
            }]
          }
        ]
      }]
    }]
  }

  it('validates and builds with deeply nested groups', async () => {
    const dir = join(testOutputDir, 'nested')
    const result = await handleBuild({ compact_json: app, output_dir: dir })
    expect(result.success).toBe(true)
  })

  it('resolves deeply nested question paths', () => {
    const hq = expandToHqJson(app)
    const update = hq.modules[0].forms[0].actions.update_case.update
    expect(update.city.question_path).toBe('/data/outer_group/inner_group/city_name')
  })

  it('XForm has correct nested bind', () => {
    const hq = expandToHqJson(app)
    const xformKey = Object.keys(hq._attachments || {}).find(k => k.endsWith('.xml') && k !== 'suite.xml' && !k.endsWith('.ccpr'))!
    const xform = (hq._attachments as Record<string, string>)[xformKey]
    expect(xform).toContain('nodeset="/data/outer_group/inner_group/city_name"')
    // Note: case management calculate binds are injected by HQ at build time
  })

  it('passes HQ validation', () => {
    const hq = expandToHqJson(app)
    const validator = new HqValidator()
    const result = validator.validate(hq._attachments || {})
    expect(result.errors).toEqual([])
  })
})
