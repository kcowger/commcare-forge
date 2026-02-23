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
})
