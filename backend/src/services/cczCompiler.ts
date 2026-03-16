import AdmZip from 'adm-zip'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { PROFILE, SUITE, VALIDATION_PATTERNS } from '../constants/commcareConfig'
import { parseXml, serialize, el } from '../utils/xmlBuilder'

/**
 * Compiles HQ import JSON into a .ccz archive for mobile deployment.
 * Generates suite.xml, profile.ccpr, app_strings.txt, and adds case blocks to XForms.
 */
export class CczCompiler {

  async compile(hqJson: Record<string, any>, appName: string): Promise<{ cczPath: string; files: Record<string, string> }> {
    const modules: any[] = hqJson.modules || []
    const attachments: Record<string, string> = hqJson._attachments || {}
    const langs: string[] = hqJson.langs || ['en']
    const defaultLang = langs[0]

    // Generate all CCZ files
    const files: Record<string, string> = {}

    files['profile.ccpr'] = this.generateProfile(appName)
    files['media_suite.xml'] = `<?xml version="1.0"?>\n<suite version="${SUITE.VERSION}"/>`

    // Per-language app_strings maps
    const appStringsByLang = new Map<string, Record<string, string>>()
    for (const lang of langs) appStringsByLang.set(lang, { 'app.name': appName })

    const suiteEntries: string[] = []
    const suiteMenus: string[] = []
    const suiteDetails: string[] = []
    const suiteResources: string[] = []
    const suiteFixtures: string[] = []

    // Include fixture files (lookup tables) from _attachments
    for (const [key, content] of Object.entries(attachments)) {
      if (key.startsWith('fixture:')) {
        const tag = key.slice('fixture:'.length)
        const fixturePath = `fixtures/${tag}.xml`
        files[fixturePath] = content
        suiteFixtures.push(
          `  <fixture id="item-list:${tag}" user_id="">\n    <resource id="fixture-${tag}" version="${SUITE.VERSION}">\n      <location authority="local">./${fixturePath}</location>\n    </resource>\n  </fixture>`
        )
      }
    }

    for (let mIdx = 0; mIdx < modules.length; mIdx++) {
      const mod = modules[mIdx]
      const caseType = mod.case_type || ''
      const forms: any[] = mod.forms || []

      // Set module name for each language
      for (const lang of langs) {
        const strings = appStringsByLang.get(lang)!
        strings[`modules.m${mIdx}`] = this.getLangName(mod.name, lang, defaultLang) || `Module ${mIdx}`
      }

      // Case detail definitions (if module uses cases)
      if (caseType) {
        for (const lang of langs) {
          const strings = appStringsByLang.get(lang)!
          const modName = this.getLangName(mod.name, lang, defaultLang) || `Module ${mIdx}`
          strings['case_list_title'] = strings['case_list_title'] || modName
          strings['case_name_header'] = strings['case_name_header'] || 'Name'
        }

        suiteDetails.push(this.generateDetail(`m${mIdx}_case_short`, 'short', mod.case_details?.short?.columns || []))
        suiteDetails.push(this.generateDetail(`m${mIdx}_case_long`, 'long', mod.case_details?.long?.columns || []))

        // Add column headers to app_strings for each language
        const columns = mod.case_details?.short?.columns || []
        for (const col of columns) {
          const headerKey = `m${mIdx}_${col.field}_header`
          for (const lang of langs) {
            const strings = appStringsByLang.get(lang)!
            strings[headerKey] = this.getLangName(col.header, lang, defaultLang) || col.field
          }
        }
      }

      const menuCommands: string[] = []

      for (let fIdx = 0; fIdx < forms.length; fIdx++) {
        const form = forms[fIdx]
        const xmlns = form.xmlns || ''
        const uniqueId = form.unique_id || ''
        const requires = form.requires || 'none'
        const cmdId = `m${mIdx}-f${fIdx}`
        const filePath = `modules-${mIdx}/forms-${fIdx}.xml`

        // Set form name for each language
        for (const lang of langs) {
          const strings = appStringsByLang.get(lang)!
          strings[`forms.m${mIdx}f${fIdx}`] = this.getLangName(form.name, lang, defaultLang) || `Form ${fIdx}`
        }

        // Get the clean XForm from _attachments and add case blocks
        let xform = attachments[`${uniqueId}.xml`] || ''
        if (xform && caseType) {
          xform = this.addCaseBlocks(xform, form.actions, caseType)
        }
        files[filePath] = xform

        // Resource declaration
        suiteResources.push(
          `  <xform>\n    <resource id="${filePath}" version="${SUITE.VERSION}">\n      <location authority="local">./${filePath}</location>\n    </resource>\n  </xform>`
        )

        // Entry
        let entry = `  <entry>\n    <form>${xmlns}</form>\n    <command id="${cmdId}">\n      <text><locale id="forms.m${mIdx}f${fIdx}"/></text>\n    </command>`

        if (requires === 'case' && caseType) {
          entry += `\n    <instance id="${SUITE.CASEDB_INSTANCE_ID}" src="${SUITE.CASEDB_INSTANCE_SRC}"/>`
          entry += `\n    <session>\n      <datum id="case_id" nodeset="instance('${SUITE.CASEDB_INSTANCE_ID}')/casedb/case[@case_type='${this.validateCaseType(caseType)}'][@status='open']" value="./@case_id" detail-select="m${mIdx}_case_short"/>\n    </session>`
        }

        entry += `\n  </entry>`
        suiteEntries.push(entry)
        menuCommands.push(`    <command id="${cmdId}"/>`)
      }

      suiteMenus.push(
        `  <menu id="m${mIdx}">\n    <text><locale id="modules.m${mIdx}"/></text>\n${menuCommands.join('\n')}\n  </menu>`
      )
    }

    // Build suite.xml with locale resources for each language
    const localeResources = langs.map(lang => {
      const dir = lang === defaultLang ? 'default' : lang
      return `  <locale language="${lang === defaultLang ? 'default' : lang}">\n    <resource id="${dir}_app_strings" version="${SUITE.VERSION}">\n      <location authority="local">./${dir}/app_strings.txt</location>\n    </resource>\n  </locale>`
    }).join('\n')

    const fixtureSection = suiteFixtures.length > 0 ? '\n' + suiteFixtures.join('\n') : ''
    files['suite.xml'] = `<?xml version="1.0"?>\n<suite version="${SUITE.VERSION}">\n${suiteResources.join('\n')}\n${localeResources}\n${suiteDetails.join('\n')}\n${suiteEntries.join('\n')}\n${suiteMenus.join('\n')}${fixtureSection}\n</suite>`

    // Build per-language app_strings.txt files
    for (const lang of langs) {
      const dir = lang === defaultLang ? 'default' : lang
      const strings = appStringsByLang.get(lang)!
      files[`${dir}/app_strings.txt`] = Object.entries(strings)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    }

    // Package into CCZ
    const cczPath = await this.packageCcz(files, appName)
    return { cczPath, files }
  }

  private generateProfile(appName: string): string {
    return `<?xml version="1.0"?>
<profile xmlns="${PROFILE.XMLNS}"
         version="${PROFILE.VERSION}"
         uniqueid="${randomUUID()}"
         name="${this.escapeXml(appName)}"
         update="${PROFILE.UPDATE_URL}">
  <property key="${PROFILE.PROPERTIES.APP_NAME}" value="${this.escapeXml(appName)}"/>
  <property key="${PROFILE.PROPERTIES.CONTENT_VERSION}" value="${PROFILE.VERSION}"/>
  <property key="${PROFILE.PROPERTIES.APP_VERSION}" value="${PROFILE.VERSION}"/>
  <features>
    <users active="true"/>
  </features>
  <suite>
    <resource id="suite" version="${SUITE.VERSION}" descriptor="Suite Definition">
      <location authority="local">./suite.xml</location>
    </resource>
  </suite>
  <suite>
    <resource id="media-suite" version="${SUITE.VERSION}" descriptor="Media Suite Definition">
      <location authority="local">./media_suite.xml</location>
    </resource>
  </suite>
</profile>`
  }

  private generateDetail(id: string, display: string, columns: any[]): string {
    if (columns.length === 0 && display === 'long') {
      return `  <detail id="${id}">\n    <title><text><locale id="case_list_title"/></text></title>\n  </detail>`
    }

    const fields = columns.map((col: any) => {
      const field = col.field || 'name'
      const header = col.header?.en || field
      return `    <field>\n      <header><text><locale id="${id}_${field}_header"/></text></header>\n      <template><text><xpath function="${field}"/></text></template>\n    </field>`
    })

    // Always include case_name as first field if not already present
    if (!columns.some((c: any) => c.field === 'name' || c.field === 'case_name')) {
      fields.unshift(
        `    <field>\n      <header><text><locale id="case_name_header"/></text></header>\n      <template><text><xpath function="case_name"/></text></template>\n    </field>`
      )
    }

    return `  <detail id="${id}">\n    <title><text><locale id="case_list_title"/></text></title>\n${fields.join('\n')}\n  </detail>`
  }

  /**
   * Add case blocks into an XForm based on form actions (for mobile runtime).
   * Uses DOM parsing instead of regex to safely inject case XML elements.
   */
  private addCaseBlocks(xform: string, actions: any, caseType: string): string {
    if (!actions) return xform

    const openCase = actions.open_case
    const updateCase = actions.update_case
    const closeCase = actions.close_case
    const subcases: any[] = actions.subcases || []
    const isCreate = openCase?.condition?.type === 'always'
    const isUpdate = updateCase?.condition?.type === 'always'
    const isClose = closeCase?.condition?.type === 'always' || closeCase?.condition?.type === 'if'
    const hasSubcases = subcases.length > 0

    if (!isCreate && !isUpdate && !isClose && !hasSubcases) return xform

    const doc = parseXml(xform)
    const dataEl = doc.getElementsByTagName('data')[0]
    const modelEl = doc.getElementsByTagName('model')[0]
    if (!dataEl || !modelEl) return xform

    // Helper: find the itext element or model end to insert binds before
    const itextEl = doc.getElementsByTagName('itext')[0]

    // Helper: create and append a bind element
    const addBind = (attrs: Record<string, string>) => {
      const bind = el(doc, 'bind', attrs)
      if (itextEl) {
        modelEl.insertBefore(bind, itextEl)
        modelEl.insertBefore(doc.createTextNode('\n      '), itextEl)
      } else {
        modelEl.appendChild(doc.createTextNode('      '))
        modelEl.appendChild(bind)
        modelEl.appendChild(doc.createTextNode('\n    '))
      }
    }

    // Build main case element
    if (isCreate || isUpdate || isClose) {
      const caseEl = el(doc, 'case')

      if (isCreate) {
        const createEl = el(doc, 'create')
        createEl.appendChild(el(doc, 'case_type'))
        createEl.appendChild(el(doc, 'case_name'))
        createEl.appendChild(el(doc, 'owner_id'))
        caseEl.appendChild(createEl)

        addBind({ nodeset: '/data/case/create/case_type', calculate: `'${this.validateCaseType(caseType)}'` })
        const namePath = openCase.name_update?.question_path || '/data/name'
        addBind({ nodeset: '/data/case/create/case_name', calculate: this.validateXFormPath(namePath) })
        addBind({ nodeset: '/data/case/create/owner_id', calculate: `instance('${SUITE.SESSION_INSTANCE_ID}')/session/context/userid` })
      }

      if (isUpdate && updateCase.update) {
        const props = Object.keys(updateCase.update)
        if (props.length > 0) {
          const updateEl = el(doc, 'update')
          for (const p of props) {
            updateEl.appendChild(el(doc, this.validatePropertyName(p)))
          }
          caseEl.appendChild(updateEl)

          for (const [prop, mapping] of Object.entries(updateCase.update)) {
            const validProp = this.validatePropertyName(prop)
            const qPath = (mapping as any).question_path || `/data/${prop}`
            addBind({ nodeset: `/data/case/update/${validProp}`, calculate: this.validateXFormPath(qPath) })
          }
        }
      }

      if (isClose) {
        caseEl.appendChild(el(doc, 'close'))
        if (closeCase.condition.type === 'if' && closeCase.condition.question) {
          const qPath = this.validateXFormPath(closeCase.condition.question)
          const answer = closeCase.condition.answer || ''
          addBind({ nodeset: '/data/case/close', relevant: `${qPath} = '${answer}'` })
        }
      }

      dataEl.appendChild(caseEl)
    }

    // Subcases — each gets its own element
    for (let sIdx = 0; sIdx < subcases.length; sIdx++) {
      const sc = subcases[sIdx]
      if (sc.condition?.type !== 'always') continue

      const elName = `subcase_${sIdx}`
      const repeatCtx = sc.repeat_context || ''
      const basePath = repeatCtx ? `${repeatCtx}/${elName}` : `/data/${elName}`

      const scEl = el(doc, elName)

      // Create block
      const createEl = el(doc, 'create')
      createEl.appendChild(el(doc, 'case_type'))
      createEl.appendChild(el(doc, 'case_name'))
      createEl.appendChild(el(doc, 'owner_id'))
      scEl.appendChild(createEl)

      addBind({ nodeset: `${basePath}/create/case_type`, calculate: `'${this.validateCaseType(sc.case_type)}'` })
      const namePath = sc.name_update?.question_path || `${basePath}/name`
      addBind({ nodeset: `${basePath}/create/case_name`, calculate: this.validateXFormPath(namePath) })
      addBind({ nodeset: `${basePath}/create/owner_id`, calculate: `instance('${SUITE.SESSION_INSTANCE_ID}')/session/context/userid` })

      // Parent index
      const indexEl = el(doc, 'index')
      const parentEl = el(doc, 'parent')
      parentEl.setAttribute('case_type', this.validateCaseType(caseType))
      parentEl.setAttribute('relationship', sc.relationship || 'child')
      indexEl.appendChild(parentEl)
      scEl.appendChild(indexEl)

      // Child case properties
      if (sc.case_properties && Object.keys(sc.case_properties).length > 0) {
        const updateEl = el(doc, 'update')
        for (const [p] of Object.entries(sc.case_properties)) {
          updateEl.appendChild(el(doc, this.validatePropertyName(p)))
        }
        scEl.appendChild(updateEl)

        for (const [prop, mapping] of Object.entries(sc.case_properties)) {
          const validProp = this.validatePropertyName(prop)
          const qPath = (mapping as any).question_path || `/data/${prop}`
          addBind({ nodeset: `${basePath}/update/${validProp}`, calculate: this.validateXFormPath(qPath) })
        }
      }

      dataEl.appendChild(scEl)
    }

    // Add commcaresession instance if not present
    const instances = doc.getElementsByTagName('instance')
    let hasSession = false
    for (let i = 0; i < instances.length; i++) {
      if (instances[i].getAttribute('id') === SUITE.SESSION_INSTANCE_ID) {
        hasSession = true
        break
      }
    }
    if (!hasSession) {
      const mainInstance = instances[0]
      if (mainInstance && mainInstance.parentNode) {
        const sessionInstance = el(doc, 'instance', { id: SUITE.SESSION_INSTANCE_ID, src: SUITE.SESSION_INSTANCE_SRC })
        mainInstance.parentNode.insertBefore(doc.createTextNode('\n      '), mainInstance.nextSibling)
        mainInstance.parentNode.insertBefore(sessionInstance, mainInstance.nextSibling?.nextSibling || null)
      }
    }

    return serialize(doc)
  }

  private async packageCcz(files: Record<string, string>, appName: string): Promise<string> {
    const outputDir = join(tmpdir(), 'commcare-forge', randomUUID())
    mkdirSync(outputDir, { recursive: true })

    const cczFileName = `${(appName || 'app').replace(/[^a-zA-Z0-9-_]/g, '_')}.ccz`
    const cczPath = join(outputDir, cczFileName)

    const zip = new AdmZip()
    for (const [filePath, content] of Object.entries(files)) {
      zip.addFile(filePath, Buffer.from(content, 'utf-8'))
    }
    zip.writeZip(cczPath)

    return cczPath
  }

  /** Extract a localized name string from a multi-lang name object like {en: "Name", fr: "Nom"} */
  private getLangName(nameObj: any, lang: string, defaultLang: string): string {
    if (!nameObj) return ''
    if (typeof nameObj === 'string') return nameObj
    return nameObj[lang] || nameObj[defaultLang] || nameObj.en || Object.values(nameObj)[0] as string || ''
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  /** Validate a CommCare case type identifier */
  private validateCaseType(ct: string): string {
    if (!VALIDATION_PATTERNS.CASE_TYPE_STRICT.test(ct)) {
      throw new Error(`Invalid case type: "${ct}"`)
    }
    return ct
  }

  /** Validate an XForm data path (e.g. /data/name) */
  private validateXFormPath(p: string): string {
    if (!VALIDATION_PATTERNS.XFORM_PATH.test(p)) {
      throw new Error(`Invalid XForm path: "${p}"`)
    }
    return p
  }

  /** Validate an XML element / case property name */
  private validatePropertyName(name: string): string {
    if (!VALIDATION_PATTERNS.XML_ELEMENT_NAME.test(name)) {
      throw new Error(`Invalid property name: "${name}"`)
    }
    return name
  }
}
