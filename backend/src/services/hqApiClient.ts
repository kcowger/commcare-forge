export interface HqAppSummary {
  app_id: string
  name: string
}

export interface HqAppListResult {
  apps: HqAppSummary[]
  totalCount: number
}

export interface HqFetchResult {
  appName: string
  appId: string
  markdownSummary: string
  hqJson: Record<string, any>
}

export interface HqImportAppResult {
  success: boolean
  appId: string
  appUrl: string
  appName: string
  warnings?: string[]
}

export class HqApiClient {
  private baseUrl: string
  private authHeader: string

  constructor(
    private server: string,
    private domain: string,
    username: string,
    apiKey: string
  ) {
    this.baseUrl = `https://${server}/a/${domain}`
    this.authHeader = `ApiKey ${username}:${apiKey}`
  }

  async listApps(): Promise<HqAppListResult> {
    const url = `${this.baseUrl}/api/v0.5/application/?format=json`
    const resp = await this.fetchWithTimeout(url)
    const data = await resp.json()

    const objects: any[] = data.objects || []
    const apps: HqAppSummary[] = objects
      .filter((obj: any) => obj.id && obj.name)
      .map((obj: any) => ({
        app_id: obj.id,
        name: obj.name
      }))
      .sort((a: HqAppSummary, b: HqAppSummary) => a.name.localeCompare(b.name))

    return { apps, totalCount: data.meta?.total_count || apps.length }
  }

  async getApp(appId: string): Promise<HqFetchResult> {
    const url = `${this.baseUrl}/api/v0.5/application/${appId}/?format=json&extras=true`
    const resp = await this.fetchWithTimeout(url)
    const hqJson = await resp.json()

    const appName = hqJson.name || 'Imported App'
    const summarizer = new HqJsonSummarizer()
    const markdownSummary = summarizer.summarize(hqJson)

    return { appName, appId, markdownSummary, hqJson }
  }

  async importApp(appName: string, hqJsonContent: Buffer | string): Promise<HqImportAppResult> {
    const url = `${this.baseUrl}/apps/api/import_app/`

    // Step 1: GET login page to obtain a CSRF cookie
    const csrfToken = await this.fetchCsrfToken(url)
    if (!csrfToken) {
      throw new Error('Could not obtain CSRF token from CommCare HQ. The server may be unreachable.')
    }

    const fileBuffer = Buffer.isBuffer(hqJsonContent) ? hqJsonContent : Buffer.from(hqJsonContent, 'utf-8')
    // Sanitize filename to prevent path traversal or injection in multipart metadata
    const safeFileName = appName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().substring(0, 100) || 'app'
    const formData = new FormData()
    formData.append('app_name', appName)
    formData.append('app_file', new Blob([fileBuffer], { type: 'application/json' }), `${safeFileName}.json`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000) // 60s for uploads

    try {
      const headers: Record<string, string> = {
        'Authorization': this.authHeader,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': url
      }
      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken
        headers['Cookie'] = `csrftoken=${csrfToken}`
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
        redirect: 'follow' // Allow redirects — proxy may require it
      })

      // Treat redirects as an error — auth'd POSTs should never redirect
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location') || 'unknown'
        throw new Error(`Server redirected to ${location.substring(0, 100)}. Check your CommCare HQ server URL in Settings.`)
      }
      if (resp.status === 401) {
        throw new Error('Authentication failed (401). Check your HQ username and API key in Settings.')
      }
      if (resp.status === 403) {
        throw new Error('Permission denied (403). Your HQ account may not have "Edit Apps" permission for this project space.')
      }
      if (resp.status === 404) {
        throw new Error('App import API not found (404). This feature may not be deployed to your CommCare HQ server yet.')
      }

      // Try to parse JSON response for non-OK statuses
      let data: any
      try {
        data = await resp.json()
      } catch {
        if (!resp.ok) {
          throw new Error(`CommCare HQ returned status ${resp.status}. The server may be having issues.`)
        }
        throw new Error('Invalid response from CommCare HQ.')
      }

      if (!resp.ok) {
        // Sanitize server-controlled error messages before displaying to user
        const serverMsg = typeof data.error === 'string'
          ? data.error.replace(/[\x00-\x1f]/g, '').substring(0, 300)
          : ''
        throw new Error(serverMsg || `Upload failed (status ${resp.status}).`)
      }

      // Validate app_id is a safe hex string before constructing URL
      const appId = data.app_id
      if (typeof appId !== 'string' || !/^[a-f0-9]+$/i.test(appId)) {
        throw new Error('Invalid app ID returned from server.')
      }
      const appUrl = `https://${this.server}/a/${this.domain}/apps/view/${appId}/`

      return {
        success: true,
        appId,
        appUrl,
        appName,
        warnings: Array.isArray(data.warnings)
          ? data.warnings.filter((w: unknown) => typeof w === 'string').map((w: string) => w.substring(0, 500))
          : undefined
      }
    } catch (err: any) {
      this.handleFetchError(err)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchCsrfToken(_url: string): Promise<string | null> {
    try {
      // Hit the login page to get a CSRF cookie — the import endpoint itself is POST-only
      const resp = await fetch(`https://${this.server}/accounts/login/`, {
        method: 'GET',
        redirect: 'follow'
      })
      // Extract csrftoken from Set-Cookie header
      const cookies = resp.headers.getSetCookie?.() || []
      for (const cookie of cookies) {
        const match = cookie.match(/csrftoken=([^;]+)/)
        if (match) return match[1]
      }
      // Fallback: try raw set-cookie header
      const rawCookie = resp.headers.get('set-cookie') || ''
      const match = rawCookie.match(/csrftoken=([^;]+)/)
      if (match) return match[1]
      return null
    } catch {
      return null
    }
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const resp = await fetch(url, {
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json'
        },
        signal: controller.signal,
        redirect: 'manual' // Don't follow redirects — prevents leaking auth header
      })

      if (resp.status >= 300 && resp.status < 400) {
        throw new Error('Server redirected unexpectedly. Check your CommCare HQ server URL in Settings.')
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Invalid CommCare HQ credentials. Check your username and API key in Settings.')
      }
      if (resp.status === 404) {
        throw new Error('Not found. Check your project space domain and try again.')
      }
      if (!resp.ok) {
        throw new Error('CommCare HQ request failed. Please try again.')
      }

      // Guard against oversized responses before parsing
      const contentLength = resp.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
        throw new Error('Response too large from CommCare HQ.')
      }

      return resp
    } catch (err: any) {
      this.handleFetchError(err)
    } finally {
      clearTimeout(timeout)
    }
  }

  private handleFetchError(err: any): never {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. CommCare HQ may be slow or unreachable.')
    }
    if (err.message?.includes('fetch failed') || err.code === 'ENOTFOUND') {
      throw new Error('Could not connect to CommCare HQ. Check your internet connection and server URL.')
    }
    throw err
  }
}

export class HqJsonSummarizer {
  summarize(hqJson: Record<string, any>): string {
    const lines: string[] = []
    const appName = hqJson.name || 'Imported App'
    const modules: any[] = hqJson.modules || []

    lines.push(`## ${appName}`)
    lines.push('')

    if (modules.length > 0) {
      for (const mod of modules) {
        const modName = this.resolveName(mod.name) || 'Unnamed Module'
        lines.push(`### ${modName}`)

        if (mod.case_type) {
          lines.push(`Case type: \`${mod.case_type}\``)
        }

        const forms: any[] = mod.forms || []
        for (const form of forms) {
          const formName = this.resolveName(form.name) || 'Unnamed Form'
          const typeHint = this.getFormTypeHint(form)
          lines.push(`#### ${formName}${typeHint ? ` ${typeHint}` : ''}`)

          // Extract question labels — prefer HQ API questions array, fall back to XForm XML
          const questions: any[] = form.questions || []
          if (questions.length > 0) {
            const fields = this.extractFromQuestions(questions)
            for (const field of fields.slice(0, 15)) {
              lines.push(`- ${field}`)
            }
            if (fields.length > 15) {
              lines.push(`- ... and ${fields.length - 15} more fields`)
            }
          } else {
            // Fallback: try XForm XML from _attachments (locally-generated apps)
            const xformKey = form.unique_id ? `${form.unique_id}.xml` : null
            if (xformKey && hqJson._attachments?.[xformKey] && typeof hqJson._attachments[xformKey] === 'string') {
              const fields = this.extractFormFields(hqJson._attachments[xformKey])
              for (const field of fields.slice(0, 15)) {
                lines.push(`- ${field}`)
              }
              if (fields.length > 15) {
                lines.push(`- ... and ${fields.length - 15} more fields`)
              }
            }
          }
        }

        // Case list columns
        const shortColumns: any[] = mod.case_details?.short?.columns || []
        if (shortColumns.length > 0) {
          lines.push('**Case List Columns:**')
          for (const col of shortColumns) {
            const header = this.resolveName(col.header) || col.field || 'unnamed'
            lines.push(`- ${header}`)
          }
        }

        lines.push('')
      }
    }

    // Case types
    const caseTypes = [...new Set(modules.map((m: any) => m.case_type).filter(Boolean))]
    if (caseTypes.length > 0) {
      lines.push('## Case Types')
      for (const ct of caseTypes) {
        lines.push(`- \`${ct}\``)
      }
      lines.push('')
    }

    // Summary stats
    const totalForms = modules.reduce((sum: number, m: any) => sum + (m.forms?.length || 0), 0)
    lines.push('## Summary')
    lines.push(`- ${modules.length} module(s), ${totalForms} form(s)`)
    if (hqJson.langs?.length > 1) {
      lines.push(`- Languages: ${hqJson.langs.join(', ')}`)
    }

    return lines.join('\n')
  }

  private resolveName(name: any): string | null {
    if (!name) return null
    if (typeof name === 'string') return name
    // HQ format: { en: "English name", ... }
    return name.en || name[Object.keys(name)[0]] || null
  }

  private getFormTypeHint(form: any): string {
    if (form.actions?.open_case?.condition?.type === 'always') return '(registration)'
    if (form.requires === 'case') return '(follow-up)'
    return ''
  }

  private extractFromQuestions(questions: any[]): string[] {
    const fields: string[] = []
    for (const q of questions) {
      // Skip hidden values, groups, and repeat headers — only show actual questions
      if (q.tag === 'hidden' || q.type === 'Group' || q.type === 'Repeat') continue
      const label = q.label || q.value?.split('/').pop() || ''
      if (!label) continue
      const typeStr = q.type ? ` *(${q.type})*` : ''
      fields.push(`${label}${typeStr}`)
    }
    return fields
  }

  private extractFormFields(xformXml: string): string[] {
    const labels: string[] = []

    // Try itext-based labels
    const itextDefs = new Map<string, string>()
    const textRegex = /<text\s+id="([^"]+)">\s*<value>([^<]*)<\/value>/g
    let m: RegExpExecArray | null
    while ((m = textRegex.exec(xformXml)) !== null) {
      // Only get label entries, skip hint/etc
      if (m[1].endsWith('-label') || !m[1].includes('-')) {
        itextDefs.set(m[1], m[2])
      }
    }

    // Get labels from body input/select elements
    const bodyMatch = xformXml.match(/<h:body>([\s\S]*)<\/h:body>/)
    if (bodyMatch) {
      const refRegex = /<label\s+ref="jr:itext\('([^']+)'\)"\s*\/>/g
      while ((m = refRegex.exec(bodyMatch[1])) !== null) {
        const label = itextDefs.get(m[1])
        if (label && label.trim()) labels.push(label.trim())
      }
    }

    // Fallback: inline labels
    if (labels.length === 0) {
      const inlineRegex = /<(?:input|select1?)\s[^>]*>[\s\S]*?<label>([^<]+)<\/label>/g
      while ((m = inlineRegex.exec(xformXml)) !== null) {
        const text = m[1].trim()
        if (text && text.length < 200) labels.push(text)
      }
    }

    return labels
  }
}
