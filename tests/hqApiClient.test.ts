import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HqApiClient, HqJsonSummarizer } from '../backend/src/services/hqApiClient'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(data: any, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-length', '1000']]),
    json: () => Promise.resolve(data)
  })
}

describe('HqApiClient', () => {
  const client = new HqApiClient('www.commcarehq.org', 'test-domain', 'user@example.com', 'abc123')

  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('listApps', () => {
    it('should parse HQ API v0.5 response format (no doc_type field)', async () => {
      // This is the ACTUAL format returned by HQ API v0.5 ApplicationResource
      // Fields: id (from _id), name, version, is_released, built_on, build_comment,
      //         built_from_app_id, modules, versions
      // NOTE: doc_type is NOT included in the response
      mockFetch.mockReturnValueOnce(jsonResponse({
        meta: { limit: 20, next: null, offset: 0, previous: null, total_count: 2 },
        objects: [
          {
            id: 'abc123def456',
            name: 'ANC Registration',
            version: 5,
            is_released: true,
            built_on: '2026-01-15T10:00:00Z',
            build_comment: null,
            built_from_app_id: null,
            modules: [{ case_type: 'pregnancy' }],
            versions: []
          },
          {
            id: 'xyz789ghi012',
            name: 'CHW Supervision',
            version: 3,
            is_released: false,
            built_on: '2026-02-01T08:00:00Z',
            build_comment: 'v3 update',
            built_from_app_id: null,
            modules: [],
            versions: []
          }
        ]
      }))

      const result = await client.listApps()

      expect(result.apps).toHaveLength(2)
      expect(result.apps[0].app_id).toBe('abc123def456')
      expect(result.apps[0].name).toBe('ANC Registration')
      expect(result.apps[1].app_id).toBe('xyz789ghi012')
      expect(result.apps[1].name).toBe('CHW Supervision')
      expect(result.totalCount).toBe(2)
    })

    it('should sort apps alphabetically by name', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        meta: { total_count: 3 },
        objects: [
          { id: '3', name: 'Zebra App', version: 1, modules: [] },
          { id: '1', name: 'Alpha App', version: 1, modules: [] },
          { id: '2', name: 'Middle App', version: 1, modules: [] }
        ]
      }))

      const result = await client.listApps()

      expect(result.apps.map(a => a.name)).toEqual(['Alpha App', 'Middle App', 'Zebra App'])
    })

    it('should skip objects without id or name', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        meta: { total_count: 3 },
        objects: [
          { id: '1', name: 'Good App', version: 1 },
          { id: null, name: 'No ID App', version: 1 },
          { id: '3', name: '', version: 1 }
        ]
      }))

      const result = await client.listApps()

      expect(result.apps).toHaveLength(1)
      expect(result.apps[0].name).toBe('Good App')
    })

    it('should handle empty objects array', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        meta: { total_count: 0 },
        objects: []
      }))

      const result = await client.listApps()

      expect(result.apps).toHaveLength(0)
      expect(result.totalCount).toBe(0)
    })

    it('should send correct auth header and URL', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ meta: {}, objects: [] }))

      await client.listApps()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.commcarehq.org/a/test-domain/api/v0.5/application/?format=json',
        expect.objectContaining({
          headers: {
            'Authorization': 'ApiKey user@example.com:abc123',
            'Accept': 'application/json'
          }
        })
      )
    })

    it('should throw on 401 with credential error message', async () => {
      mockFetch.mockReturnValueOnce(Promise.resolve({
        ok: false,
        status: 401,
        headers: new Map()
      }))

      await expect(client.listApps()).rejects.toThrow('Invalid CommCare HQ credentials')
    })

    it('should throw on 404 with domain error message', async () => {
      mockFetch.mockReturnValueOnce(Promise.resolve({
        ok: false,
        status: 404,
        headers: new Map()
      }))

      await expect(client.listApps()).rejects.toThrow('Not found')
    })
  })

  describe('getApp', () => {
    it('should request with extras=true for full document', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        name: 'Test App',
        modules: [],
        _attachments: {}
      }))

      await client.getApp('abc123')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.commcarehq.org/a/test-domain/api/v0.5/application/abc123/?format=json&extras=true',
        expect.any(Object)
      )
    })

    it('should return app name and summary', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        name: 'ANC Registration',
        modules: [{
          name: { en: 'Registration' },
          case_type: 'pregnancy',
          forms: [{ name: { en: 'Register' }, unique_id: 'form1' }],
          case_details: { short: { columns: [] } }
        }],
        langs: ['en'],
        _attachments: {}
      }))

      const result = await client.getApp('abc123')

      expect(result.appName).toBe('ANC Registration')
      expect(result.appId).toBe('abc123')
      expect(result.markdownSummary).toContain('ANC Registration')
      expect(result.markdownSummary).toContain('Registration')
      expect(result.markdownSummary).toContain('pregnancy')
      expect(result.hqJson).toBeDefined()
    })
  })
})

describe('HqJsonSummarizer', () => {
  const summarizer = new HqJsonSummarizer()

  it('should summarize app with modules and forms', () => {
    const hqJson = {
      name: 'Health App',
      modules: [{
        name: { en: 'Patient Module' },
        case_type: 'patient',
        forms: [
          { name: { en: 'Register Patient' }, unique_id: 'reg', actions: { open_case: { condition: { type: 'always' } } } },
          { name: { en: 'Follow-up' }, unique_id: 'followup', requires: 'case' }
        ],
        case_details: {
          short: {
            columns: [
              { header: { en: 'Name' }, field: 'name' },
              { header: { en: 'Age' }, field: 'age' }
            ]
          }
        }
      }],
      langs: ['en', 'fr'],
      _attachments: {}
    }

    const md = summarizer.summarize(hqJson)

    expect(md).toContain('## Health App')
    expect(md).toContain('Patient Module')
    expect(md).toContain('`patient`')
    expect(md).toContain('Register Patient')
    expect(md).toContain('(registration)')
    expect(md).toContain('Follow-up')
    expect(md).toContain('(follow-up)')
    expect(md).toContain('Name')
    expect(md).toContain('Age')
    expect(md).toContain('Languages: en, fr')
    expect(md).toContain('1 module(s), 2 form(s)')
  })

  it('should handle app with no modules', () => {
    const md = summarizer.summarize({ name: 'Empty App', modules: [] })
    expect(md).toContain('## Empty App')
    expect(md).toContain('0 module(s), 0 form(s)')
  })

  it('should resolve string names directly', () => {
    const md = summarizer.summarize({
      name: 'App',
      modules: [{
        name: 'Simple Module',
        forms: [{ name: 'Simple Form' }],
        case_details: {}
      }]
    })
    expect(md).toContain('Simple Module')
    expect(md).toContain('Simple Form')
  })

  it('should extract questions from HQ API questions array', () => {
    const hqJson = {
      name: 'Survey App',
      modules: [{
        name: { en: 'Intake' },
        case_type: 'patient',
        forms: [{
          name: { en: 'Registration Form' },
          unique_id: 'form1',
          actions: { open_case: { condition: { type: 'always' } } },
          questions: [
            { label: 'Patient Name', type: 'Text', value: '/data/name', tag: 'input' },
            { label: 'Age', type: 'Int', value: '/data/age', tag: 'input' },
            { label: 'Gender', type: 'Select', value: '/data/gender', tag: 'select1' },
            { label: 'Date of Visit', type: 'Date', value: '/data/visit_date', tag: 'input' },
            { label: '', type: 'DataBindOnly', value: '/data/meta/instanceID', tag: 'hidden' }
          ]
        }],
        case_details: { short: { columns: [] } }
      }],
      _attachments: { 'form1.xml': { stub: true, length: 5000, content_type: 'text/xml' } }
    }

    const md = summarizer.summarize(hqJson)

    expect(md).toContain('Patient Name *(Text)*')
    expect(md).toContain('Age *(Int)*')
    expect(md).toContain('Gender *(Select)*')
    expect(md).toContain('Date of Visit *(Date)*')
    // Hidden fields should be excluded
    expect(md).not.toContain('DataBindOnly')
    expect(md).not.toContain('instanceID')
  })

  it('should skip Group and Repeat type questions', () => {
    const hqJson = {
      name: 'App',
      modules: [{
        name: { en: 'Module' },
        forms: [{
          name: { en: 'Form' },
          questions: [
            { label: 'Personal Info', type: 'Group', value: '/data/personal', tag: 'group' },
            { label: 'Name', type: 'Text', value: '/data/personal/name', tag: 'input' },
            { label: 'Visits', type: 'Repeat', value: '/data/visits', tag: 'repeat' },
            { label: 'Visit Date', type: 'Date', value: '/data/visits/date', tag: 'input' }
          ]
        }],
        case_details: {}
      }]
    }

    const md = summarizer.summarize(hqJson)

    expect(md).toContain('Name *(Text)*')
    expect(md).toContain('Visit Date *(Date)*')
    expect(md).not.toContain('Personal Info')
    expect(md).not.toContain('Visits *(Repeat)*')
  })

  it('should fall back to value path when label is missing', () => {
    const hqJson = {
      name: 'App',
      modules: [{
        name: { en: 'Module' },
        forms: [{
          name: { en: 'Form' },
          questions: [
            { label: '', type: 'Text', value: '/data/patient_name', tag: 'input' },
            { label: 'Age', type: 'Int', value: '/data/age', tag: 'input' }
          ]
        }],
        case_details: {}
      }]
    }

    const md = summarizer.summarize(hqJson)

    expect(md).toContain('patient_name *(Text)*')
    expect(md).toContain('Age *(Int)*')
  })

  it('should prefer questions array over _attachments stubs', () => {
    const hqJson = {
      name: 'App',
      modules: [{
        name: { en: 'Module' },
        forms: [{
          name: { en: 'Form' },
          unique_id: 'form1',
          questions: [
            { label: 'Question from API', type: 'Text', value: '/data/q1', tag: 'input' }
          ]
        }],
        case_details: {}
      }],
      _attachments: {
        'form1.xml': { stub: true, length: 5000, content_type: 'text/xml' }
      }
    }

    const md = summarizer.summarize(hqJson)

    // Should show question from API, not try to parse the stub
    expect(md).toContain('Question from API *(Text)*')
  })

  it('should truncate at 15 questions and show remaining count', () => {
    const questions = Array.from({ length: 20 }, (_, i) => ({
      label: `Question ${i + 1}`,
      type: 'Text',
      value: `/data/q${i + 1}`,
      tag: 'input'
    }))

    const hqJson = {
      name: 'App',
      modules: [{
        name: { en: 'Module' },
        forms: [{
          name: { en: 'Form' },
          questions
        }],
        case_details: {}
      }]
    }

    const md = summarizer.summarize(hqJson)

    expect(md).toContain('Question 1 *(Text)*')
    expect(md).toContain('Question 15 *(Text)*')
    expect(md).not.toContain('Question 16 *(Text)*')
    expect(md).toContain('... and 5 more fields')
  })

  it('should not show questions when questions array is empty', () => {
    const hqJson = {
      name: 'App',
      modules: [{
        name: { en: 'Module' },
        forms: [{
          name: { en: 'Form' },
          unique_id: 'form1',
          questions: []
        }],
        case_details: {}
      }],
      _attachments: {}
    }

    const md = summarizer.summarize(hqJson)

    // Should just have the form name, no sub-bullets
    const lines = md.split('\n')
    const formLine = lines.findIndex(l => l.includes('- Form'))
    expect(formLine).toBeGreaterThan(-1)
    // Next non-empty line should not be an indented field
    const nextNonEmpty = lines.slice(formLine + 1).find(l => l.trim())
    expect(nextNonEmpty).toBeDefined()
    expect(nextNonEmpty!.startsWith('  -')).toBe(false)
  })

  it('should fall back to XForm XML when no questions array and attachment is a string', () => {
    const xformXml = `<?xml version="1.0"?>
<h:html xmlns:h="http://www.w3.org/1999/xhtml">
<h:head>
  <model>
    <itext>
      <translation lang="en" default="">
        <text id="name-label"><value>Patient Name</value></text>
        <text id="age-label"><value>Patient Age</value></text>
      </translation>
    </itext>
  </model>
</h:head>
<h:body>
  <input ref="/data/name"><label ref="jr:itext('name-label')"/></input>
  <input ref="/data/age"><label ref="jr:itext('age-label')"/></input>
</h:body>
</h:html>`

    const hqJson = {
      name: 'App',
      modules: [{
        name: { en: 'Module' },
        forms: [{
          name: { en: 'Form' },
          unique_id: 'form1'
          // No questions array
        }],
        case_details: {}
      }],
      _attachments: {
        'form1.xml': xformXml
      }
    }

    const md = summarizer.summarize(hqJson)

    expect(md).toContain('Patient Name')
    expect(md).toContain('Patient Age')
  })
})
