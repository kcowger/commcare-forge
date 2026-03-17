import { randomBytes } from 'crypto'
import type { CompactApp, CompactForm, CompactQuestion, CompactLookupTable } from '../schemas/compactApp'
import { RESERVED_CASE_PROPERTIES, RESERVED_RENAME_MAP, MEDIA_QUESTION_TYPES } from '../constants/reservedCaseProperties'
import { validateXPath } from '../utils/xpathValidator'
import {
  DOC_TYPES, BUILD_SPEC_VERSION, APPLICATION_VERSION, XFORM_NAMESPACES, XMLNS_PREFIX,
  XSD_TYPE_MAP, APPEARANCE_MAP, MEDIA_TYPE_MAP, SIGNATURE_APPEARANCE,
  DEFAULT_APP_FLAGS, DEFAULT_MODULE_TYPE, DETAIL_DEFAULTS,
  makeCondition,
} from '../constants/commcareConfig'

/**
 * Expands a compact app definition into the full HQ import JSON.
 * All boilerplate, doc_types, unique_ids, xmlns, and XForm XML are generated here.
 */
export function expandToHqJson(compact: CompactApp): Record<string, any> {
  const attachments: Record<string, string> = {}
  const modules: any[] = []

  // Derive language codes from compact.languages or default to ['en']
  const langs: string[] = compact.languages?.length
    ? compact.languages.map(l => l.code)
    : ['en']
  const defaultLang = compact.languages?.find(l => l.default)?.code || langs[0] || 'en'

  // Helper: build a multi-lang name object from a string (uses default lang)
  function makeMultiLangName(name: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const lang of langs) result[lang] = name
    return result
  }

  const compactModules = compact.modules || []
  for (let mIdx = 0; mIdx < compactModules.length; mIdx++) {
    const cm = compactModules[mIdx]
    const moduleUniqueId = genHexId()
    const hasCases = cm.case_type && (cm.forms || []).some(f => f.type !== 'survey')
    const caseType = hasCases ? cm.case_type! : ''

    const forms: any[] = []

    const cmForms = cm.forms || []
    for (let fIdx = 0; fIdx < cmForms.length; fIdx++) {
      const cf = cmForms[fIdx]
      const formUniqueId = genHexId()
      const xmlns = `${XMLNS_PREFIX}${genShortId()}`

      // Generate XForm XML
      const xform = buildXForm(cf, xmlns, langs, defaultLang, compact.lookup_tables)
      attachments[`${formUniqueId}.xml`] = xform

      // Build form actions (with reserved word filtering)
      const actions = buildFormActions(cf, caseType)

      forms.push({
        doc_type: DOC_TYPES.Form,
        form_type: 'module_form',
        unique_id: formUniqueId,
        name: makeMultiLangName(cf.name),
        xmlns,
        requires: cf.type === 'followup' ? 'case' : 'none',
        version: null,
        actions,
        case_references_data: { load: {}, save: {}, doc_type: DOC_TYPES.CaseReferences },
        form_filter: null,
        post_form_workflow: cf.post_form_workflow || (cf.form_links?.length ? 'form' : 'default'),
        no_vellum: false,
        media_image: {}, media_audio: {}, custom_icons: [],
        custom_assertions: [], custom_instances: [], form_links: [],
        comment: ''
      })
    }

    // Build case details
    const caseDetails = hasCases ? buildCaseDetails(cm.case_list_columns || [], langs) : buildEmptyCaseDetails()

    modules.push({
      doc_type: DOC_TYPES.Module,
      module_type: DEFAULT_MODULE_TYPE,
      unique_id: moduleUniqueId,
      name: makeMultiLangName(cm.name),
      case_type: caseType,
      put_in_root: false,
      root_module_id: null,
      forms,
      case_details: caseDetails,
      case_list: { doc_type: DOC_TYPES.CaseList, show: false, label: {}, media_image: {}, media_audio: {}, custom_icons: [] },
      case_list_form: { doc_type: DOC_TYPES.CaseListForm, form_id: null, label: {} },
      search_config: { doc_type: DOC_TYPES.CaseSearch, properties: [], default_properties: [], include_closed: false },
      display_style: 'list',
      media_image: {}, media_audio: {}, custom_icons: [],
      is_training_module: false, module_filter: null, auto_select_case: false,
      parent_select: { active: false, module_id: null },
      comment: ''
    })
  }

  // Generate fixture XML for lookup tables
  if (compact.lookup_tables?.length) {
    for (const table of compact.lookup_tables) {
      attachments[`fixture:${table.tag}`] = buildFixtureXml(table)
    }
  }

  // Resolve form_links: map form names → unique_ids across all modules
  const formNameToId = new Map<string, string>()
  for (let mIdx = 0; mIdx < compactModules.length; mIdx++) {
    const mForms = compactModules[mIdx].forms || []
    for (let fIdx = 0; fIdx < mForms.length; fIdx++) {
      formNameToId.set(mForms[fIdx].name, modules[mIdx].forms[fIdx].unique_id)
    }
  }
  for (let mIdx = 0; mIdx < compactModules.length; mIdx++) {
    const mForms = compactModules[mIdx].forms || []
    for (let fIdx = 0; fIdx < mForms.length; fIdx++) {
      const cf = mForms[fIdx]
      if (cf.form_links?.length) {
        modules[mIdx].forms[fIdx].form_links = cf.form_links.map(link => {
          const targetId = formNameToId.get(link.form_name)
          return {
            xpath: 'true()',
            form_id: targetId || link.form_name,
            doc_type: 'FormLink',
          }
        })
      }
    }
  }

  return {
    doc_type: DOC_TYPES.Application,
    application_version: APPLICATION_VERSION,
    name: compact.app_name,
    langs,
    build_spec: { doc_type: DOC_TYPES.BuildSpec, version: BUILD_SPEC_VERSION, build_number: null },
    profile: { doc_type: DOC_TYPES.Profile, features: {}, properties: {} },
    ...DEFAULT_APP_FLAGS,
    multimedia_map: {},
    translations: {},
    modules,
    _attachments: attachments
  }
}

/** Build fixture XML for a lookup table. */
function buildFixtureXml(table: CompactLookupTable): string {
  const rows = table.data.map(row => {
    const fields = table.fields.map(f => {
      const value = row[f.field_name] || ''
      return `      <${f.field_name}>${escapeXml(value)}</${f.field_name}>`
    }).join('\n')
    return `    <item>\n${fields}\n    </item>`
  }).join('\n')

  return `<?xml version="1.0"?>
<fixture id="item-list:${escapeXml(table.tag)}" user_id="">
  <${escapeXml(table.tag)}_list>
${rows}
  </${escapeXml(table.tag)}_list>
</fixture>`
}

function genHexId(): string {
  return randomBytes(20).toString('hex')
}

function genShortId(): string {
  return randomBytes(8).toString('hex')
}

/** Sanitize a string for use as part of an XML attribute ID (e.g. itext id).
 *  Strips characters that are invalid in XML attributes: < > & " ' */
function sanitizeForId(s: string): string {
  return s.replace(/[<>&"']/g, '_')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Build complete XForm XML from question definitions. */
function buildXForm(form: CompactForm, xmlns: string, langs: string[] = ['en'], defaultLang: string = 'en', lookupTables?: CompactLookupTable[]): string {
  const questions = form.questions || []
  const dataElements: string[] = []
  const binds: string[] = []
  // itextEntries is now per-language: Map<langCode, string[]>
  const itextByLang = new Map<string, string[]>()
  for (const lang of langs) itextByLang.set(lang, [])
  const bodyElements: string[] = []

  // Collect lookup table tags referenced by questions in this form
  const usedLookupTags = new Set<string>()
  collectLookupTags(questions, usedLookupTags)

  for (const q of questions) {
    buildQuestionParts(q, '/data', dataElements, binds, itextByLang, bodyElements, langs, defaultLang)
  }

  const dataContent = dataElements.length > 0
    ? '\n' + dataElements.map(e => `          ${e}`).join('\n') + '\n        '
    : ''

  const bindContent = binds.length > 0
    ? '\n' + binds.map(b => `      ${b}`).join('\n')
    : ''

  // Build fixture instance declarations for used lookup tables
  const fixtureInstances = Array.from(usedLookupTags).map(tag =>
    `      <instance id="${tag}" src="jr://fixture/item-list:${tag}"/>`
  ).join('\n')
  const instanceContent = fixtureInstances ? '\n' + fixtureInstances : ''

  // Build translation blocks for each language
  const translationBlocks = langs.map(lang => {
    const entries = itextByLang.get(lang) || []
    const itextContent = entries.map(e => `          ${e}`).join('\n')
    const defaultAttr = lang === defaultLang ? ' default=""' : ''
    return `        <translation lang="${lang}"${defaultAttr}>\n${itextContent}\n        </translation>`
  }).join('\n')

  const bodyContent = bodyElements.map(e => `    ${e}`).join('\n')

  return `<?xml version="1.0"?>
<h:html xmlns:h="${XFORM_NAMESPACES.h}" xmlns="${XFORM_NAMESPACES.xforms}" xmlns:xsd="${XFORM_NAMESPACES.xsd}" xmlns:jr="${XFORM_NAMESPACES.jr}">
  <h:head>
    <h:title>${escapeXml(form.name)}</h:title>
    <model>
      <instance>
        <data xmlns="${xmlns}" xmlns:jrm="${XFORM_NAMESPACES.jrm}" uiVersion="1" version="1" name="${escapeXml(form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'))}">${dataContent}</data>
      </instance>${instanceContent}${bindContent}
      <itext>
${translationBlocks}
      </itext>
    </model>
  </h:head>
  <h:body>
${bodyContent}
  </h:body>
</h:html>`
}

/** Recursively collect lookup table tags used by questions. */
function collectLookupTags(questions: CompactQuestion[], tags: Set<string>): void {
  for (const q of questions) {
    if (q.lookup_table?.tag) tags.add(q.lookup_table.tag)
    if (q.children) collectLookupTags(q.children, tags)
  }
}

function buildQuestionParts(
  q: CompactQuestion,
  parentPath: string,
  dataElements: string[],
  binds: string[],
  itextByLang: Map<string, string[]>,
  bodyElements: string[],
  langs: string[] = ['en'],
  defaultLang: string = 'en'
): void {
  const nodePath = `${parentPath}/${q.id}`

  // Data element
  dataElements.push(`<${q.id}/>`)

  // Bind
  const bindParts = [`nodeset="${nodePath}"`]
  const xsdType = getXsdType(q.type)
  if (xsdType) bindParts.push(`type="${xsdType}"`)
  if (q.required) bindParts.push(`required="true()"`)
  if (q.readonly) bindParts.push(`readonly="true()"`)
  if (q.constraint) bindParts.push(`constraint="${escapeXml(q.constraint)}"`)
  if (q.constraint_msg) bindParts.push(`jr:constraintMsg="${escapeXml(q.constraint_msg)}"`)
  if (q.relevant) bindParts.push(`relevant="${escapeXml(q.relevant)}"`)
  if (q.calculate) bindParts.push(`calculate="${escapeXml(q.calculate)}"`)
  binds.push(`<bind ${bindParts.join(' ')}/>`)

  // itext (hidden questions have no body element, so no label to reference)
  if (q.type !== 'hidden') {
    for (const lang of langs) {
      const entries = itextByLang.get(lang)!
      const labelText = q.labels_by_language?.[lang] || q.label
      entries.push(`<text id="${q.id}-label"><value>${escapeXml(labelText)}</value></text>`)
      if (q.hint || q.hints_by_language?.[lang]) {
        const hintText = q.hints_by_language?.[lang] || q.hint || ''
        entries.push(`<text id="${q.id}-hint"><value>${escapeXml(hintText)}</value></text>`)
      }
    }
  }

  // itext for select options (skip when using lookup table — options come from fixture)
  if (q.options && !q.lookup_table) {
    for (const opt of q.options) {
      for (const lang of langs) {
        const entries = itextByLang.get(lang)!
        const optLabel = opt.labels_by_language?.[lang] || opt.label
        entries.push(`<text id="${q.id}-${sanitizeForId(opt.value)}-label"><value>${escapeXml(optLabel)}</value></text>`)
      }
    }
  }

  // Body element
  if (q.type === 'hidden') {
    // Hidden values have no body element — data + bind only
    return
  } else if (q.type === 'group' || q.type === 'repeat') {
    // Group/repeat: contains nested child questions
    const childData: string[] = []
    const childBinds: string[] = []
    const childBody: string[] = []
    for (const child of (q.children || [])) {
      buildQuestionParts(child, nodePath, childData, childBinds, itextByLang, childBody, langs, defaultLang)
    }
    // Replace the self-closing data element with a proper parent element wrapping children
    dataElements.pop()
    dataElements.push(`<${q.id}>${childData.join('')}</${q.id}>`)
    // Replace the group bind with just a relevant bind if needed
    binds.pop()
    if (q.relevant) {
      binds.push(`<bind nodeset="${nodePath}" relevant="${escapeXml(q.relevant)}"/>`)
    }
    binds.push(...childBinds)
    // Re-indent ALL lines of child body elements for proper nesting.
    // Child elements have: line 0 at 0 indent (relative), subsequent lines with absolute indent.
    // For group: line 0 needs +6 (4 base + 2 nesting), subsequent lines need +2.
    // For repeat: line 0 needs +8 (4 base + 2 group + 2 repeat), subsequent lines need +4.
    if (q.type === 'repeat') {
      const indentedChildren = childBody.map(el => {
        const lines = el.split('\n')
        lines[0] = `        ${lines[0]}`
        for (let i = 1; i < lines.length; i++) lines[i] = `    ${lines[i]}`
        return lines.join('\n')
      })
      const innerLines = indentedChildren.join('\n')
      bodyElements.push(`<group ref="${nodePath}">\n      <label ref="jr:itext('${q.id}-label')"/>\n      <repeat nodeset="${nodePath}">\n${innerLines}\n      </repeat>\n    </group>`)
    } else {
      const indentedChildren = childBody.map(el => {
        const lines = el.split('\n')
        lines[0] = `      ${lines[0]}`
        for (let i = 1; i < lines.length; i++) lines[i] = `  ${lines[i]}`
        return lines.join('\n')
      })
      const innerLines = indentedChildren.join('\n')
      bodyElements.push(`<group ref="${nodePath}" appearance="field-list">\n      <label ref="jr:itext('${q.id}-label')"/>\n${innerLines}\n    </group>`)
    }
    return
  } else if (q.type === 'select1' || q.type === 'select') {
    const tag = q.type === 'select1' ? 'select1' : 'select'
    let el = `<${tag} ref="${nodePath}">\n      <label ref="jr:itext('${q.id}-label')"/>`
    if (q.hint) el += `\n      <hint ref="jr:itext('${q.id}-hint')"/>`
    if (q.lookup_table) {
      // Dynamic options from a lookup table (fixture)
      const lt = q.lookup_table
      el += `\n      <itemset nodeset="instance('${lt.tag}')//${lt.tag}_list/item">`
      el += `\n        <value ref="${lt.value_field}"/>`
      el += `\n        <label ref="${lt.label_field}"/>`
      el += `\n      </itemset>`
    } else {
      const items = (q.options || []).map(opt =>
        `  <item><label ref="jr:itext('${q.id}-${sanitizeForId(opt.value)}-label')"/><value>${escapeXml(opt.value)}</value></item>`
      ).join('\n    ')
      el += `\n    ${items}`
    }
    el += `\n    </${tag}>`
    bodyElements.push(el)
  } else if (q.type === 'trigger') {
    let el = `<trigger ref="${nodePath}">\n      <label ref="jr:itext('${q.id}-label')"/>`
    if (q.hint) el += `\n      <hint ref="jr:itext('${q.id}-hint')"/>`
    el += `\n    </trigger>`
    bodyElements.push(el)
  } else if (q.type === 'secret') {
    let el = `<secret ref="${nodePath}">\n      <label ref="jr:itext('${q.id}-label')"/>`
    if (q.hint) el += `\n      <hint ref="jr:itext('${q.id}-hint')"/>`
    el += `\n    </secret>`
    bodyElements.push(el)
  } else if (q.type in MEDIA_TYPE_MAP) {
    const mediatype = MEDIA_TYPE_MAP[q.type]
    const appearance = q.type === 'signature' ? ` appearance="${SIGNATURE_APPEARANCE}"` : ''
    let el = `<upload ref="${nodePath}" mediatype="${mediatype}"${appearance}>\n      <label ref="jr:itext('${q.id}-label')"/>`
    if (q.hint) el += `\n      <hint ref="jr:itext('${q.id}-hint')"/>`
    el += `\n    </upload>`
    bodyElements.push(el)
  } else {
    // Input types: text, int, decimal, long, date, time, datetime, geopoint, barcode, phone
    const appearance = getAppearance(q.type)
    const appearanceAttr = appearance ? ` appearance="${appearance}"` : ''
    let el = `<input ref="${nodePath}"${appearanceAttr}>\n      <label ref="jr:itext('${q.id}-label')"/>`
    if (q.hint) el += `\n      <hint ref="jr:itext('${q.id}-hint')"/>`
    el += `\n    </input>`
    bodyElements.push(el)
  }
}

function getAppearance(type: string): string | null {
  return APPEARANCE_MAP[type] ?? null
}

function getXsdType(type: string): string | null {
  if (type in XSD_TYPE_MAP) return XSD_TYPE_MAP[type]
  return 'xsd:string' // default for unknown types
}

/** Build form actions based on form type and case config. Filters reserved words. */
function buildFormActions(form: CompactForm, caseType: string): any {
  const base = {
    doc_type: DOC_TYPES.FormActions,
    open_case: {
      doc_type: DOC_TYPES.OpenCaseAction,
      name_update: { question_path: '' },
      external_id: null,
      condition: makeCondition('never')
    },
    update_case: {
      doc_type: DOC_TYPES.UpdateCaseAction,
      update: {},
      condition: makeCondition('never')
    },
    close_case: { doc_type: DOC_TYPES.FormAction, condition: makeCondition('never') },
    case_preload: { doc_type: DOC_TYPES.PreloadAction, preload: {}, condition: makeCondition('never') },
    subcases: [] as any[],
    usercase_preload: { doc_type: DOC_TYPES.PreloadAction, preload: {}, condition: makeCondition('never') },
    usercase_update: { doc_type: DOC_TYPES.UpdateCaseAction, update: {}, condition: makeCondition('never') },
    load_from_form: { doc_type: DOC_TYPES.PreloadAction, preload: {}, condition: makeCondition('never') }
  }

  if (form.type === 'survey' || !caseType) {
    return base
  }

  // Build a map of question id → full XForm path (accounting for group/repeat nesting)
  function buildQuestionPathMap(questions: CompactQuestion[], parentPath: string = '/data'): Map<string, { path: string; type: string }> {
    const pathMap = new Map<string, { path: string; type: string }>()
    for (const q of questions) {
      const fullPath = `${parentPath}/${q.id}`
      pathMap.set(q.id, { path: fullPath, type: q.type })
      if ((q.type === 'group' || q.type === 'repeat') && q.children) {
        const childPaths = buildQuestionPathMap(q.children, fullPath)
        childPaths.forEach((val, id) => pathMap.set(id, val))
      }
    }
    return pathMap
  }

  const questionPathMap = buildQuestionPathMap(form.questions || [])

  // Resolve a question ID to its full XForm path
  function resolveQuestionPath(questionId: string): string {
    const entry = questionPathMap.get(questionId)
    return entry ? entry.path : `/data/${questionId}`
  }

  // Build a safe update map, auto-renaming reserved property names and skipping media questions
  function buildSafeUpdateMap(caseProperties: Record<string, string> | undefined): Record<string, any> {
    const updateMap: Record<string, any> = {}
    if (!caseProperties) return updateMap
    for (const [caseProp, questionId] of Object.entries(caseProperties)) {
      const entry = questionPathMap.get(questionId)
      if (entry && MEDIA_QUESTION_TYPES.has(entry.type)) continue // skip media/binary questions
      // Auto-rename reserved words instead of dropping them
      const safeProp = RESERVED_CASE_PROPERTIES.has(caseProp)
        ? (RESERVED_RENAME_MAP[caseProp] || `${caseProp}_value`)
        : caseProp
      updateMap[safeProp] = { question_path: resolveQuestionPath(questionId), update_mode: 'always' }
    }
    return updateMap
  }

  if (form.type === 'registration') {
    // Open case
    base.open_case.condition = makeCondition('always')
    base.open_case.name_update.question_path = resolveQuestionPath(form.case_name_field || form.questions?.[0]?.id || 'name')

    // Update case properties (filtered)
    const updateMap = buildSafeUpdateMap(form.case_properties)
    if (Object.keys(updateMap).length > 0) {
      base.update_case.condition = makeCondition('always')
      base.update_case.update = updateMap
    }
  }

  if (form.type === 'followup') {
    // Update case (filtered)
    const updateMap = buildSafeUpdateMap(form.case_properties)
    if (Object.keys(updateMap).length > 0) {
      base.update_case.condition = makeCondition('always')
      base.update_case.update = updateMap
    }

    // Preload case data into form questions
    // Note: preload values are case properties being READ FROM, not saved TO.
    // HQ rejects "case_name" even in preload — the correct preload source for
    // reading the case name is "name" (not "case_name").
    if (form.case_preload && Object.keys(form.case_preload).length > 0) {
      const PRELOAD_RENAME: Record<string, string> = {
        case_name: 'name',
        case_type: 'case_type',  // this one is actually valid in preload
        case_id: '@case_id',
      }
      const preloadMap: Record<string, string> = {}
      for (const [questionId, caseProp] of Object.entries(form.case_preload)) {
        preloadMap[resolveQuestionPath(questionId)] = PRELOAD_RENAME[caseProp] || caseProp
      }
      if (Object.keys(preloadMap).length > 0) {
        base.case_preload.condition = makeCondition('always')
        base.case_preload.preload = preloadMap
      }
    }
  }

  // Close case (followup forms only)
  if (form.type === 'followup' && form.close_case) {
    if (form.close_case === true) {
      base.close_case = { doc_type: DOC_TYPES.FormAction, condition: makeCondition('always') }
    } else if (typeof form.close_case === 'object' && form.close_case.question && form.close_case.answer) {
      base.close_case = {
        doc_type: DOC_TYPES.FormAction,
        condition: makeCondition('if', {
          question: resolveQuestionPath(form.close_case.question),
          answer: form.close_case.answer,
          operator: '=',
        })
      }
    }
  }

  // Child cases / subcases
  if (form.child_cases && form.child_cases.length > 0) {
    base.subcases = form.child_cases.map((child) => {
      const childProps: Record<string, any> = {}
      if (child.case_properties) {
        for (const [caseProp, questionId] of Object.entries(child.case_properties)) {
          const safeProp = RESERVED_CASE_PROPERTIES.has(caseProp)
            ? (RESERVED_RENAME_MAP[caseProp] || `${caseProp}_value`)
            : caseProp
          childProps[safeProp] = { question_path: resolveQuestionPath(questionId), update_mode: 'always' }
        }
      }

      const nameFieldPath = resolveQuestionPath(child.case_name_field)

      return {
        doc_type: DOC_TYPES.OpenSubCaseAction,
        case_type: child.case_type,
        name_update: { question_path: nameFieldPath, update_mode: 'always' },
        reference_id: 'parent',
        case_properties: childProps,
        repeat_context: child.repeat_context ? resolveQuestionPath(child.repeat_context) : '',
        relationship: child.relationship || 'child',
        close_condition: makeCondition('never'),
        condition: makeCondition('always')
      }
    })
  }

  return base
}

function makeDetailColumn(field: string, header: string, langs: string[] = ['en']): any {
  const headerObj: Record<string, string> = {}
  for (const lang of langs) headerObj[lang] = header
  return {
    doc_type: DOC_TYPES.DetailColumn,
    header: headerObj,
    field,
    model: DETAIL_DEFAULTS.model,
    format: DETAIL_DEFAULTS.format,
    calc_xpath: DETAIL_DEFAULTS.calc_xpath,
    filter_xpath: DETAIL_DEFAULTS.filter_xpath,
    advanced: DETAIL_DEFAULTS.advanced,
    late_flag: DETAIL_DEFAULTS.late_flag,
    time_ago_interval: DETAIL_DEFAULTS.time_ago_interval,
    useXpathExpression: false, hasNodeset: false, hasAutocomplete: false,
    isTab: false, enum: [], graph_configuration: null,
    relevant: '', case_tile_field: null, nodeset: ''
  }
}

function makeDetailBase(): any {
  return {
    sort_elements: [], tabs: [], filter: null,
    lookup_enabled: false, lookup_autolaunch: false, lookup_display_results: false,
    lookup_name: null, lookup_image: null, lookup_action: null,
    lookup_field_template: null, lookup_field_header: {},
    lookup_extras: [], lookup_responses: [],
    persist_case_context: null, persistent_case_context_xml: DETAIL_DEFAULTS.persistent_case_context_xml,
    persist_tile_on_forms: null, persistent_case_tile_from_module: null,
    pull_down_tile: null, case_tile_template: null,
    custom_xml: null, custom_variables: null
  }
}

function buildCaseDetails(columns: { field: string; header: string }[], langs: string[] = ['en']): any {
  // Detail columns READ case data — reserved words like case_name are valid column fields
  const shortColumns = columns.map(col => makeDetailColumn(col.field, col.header, langs))

  // Always ensure case_name is the first column in the case list
  if (!shortColumns.some(col => col.field === 'case_name' || col.field === 'name')) {
    shortColumns.unshift(makeDetailColumn('case_name', 'Name', langs))
  }

  const detailBase = makeDetailBase()

  return {
    doc_type: DOC_TYPES.DetailPair,
    short: { doc_type: DOC_TYPES.Detail, display: 'short', columns: shortColumns, ...detailBase },
    long: { doc_type: DOC_TYPES.Detail, display: 'long', columns: [], ...detailBase }
  }
}

function buildEmptyCaseDetails(): any {
  const detailBase = makeDetailBase()
  return {
    doc_type: DOC_TYPES.DetailPair,
    short: { doc_type: DOC_TYPES.Detail, display: 'short', columns: [], ...detailBase },
    long: { doc_type: DOC_TYPES.Detail, display: 'long', columns: [], ...detailBase }
  }
}

/**
 * Validate the compact format before expanding.
 * Returns a list of errors (empty = valid).
 */
export function validateCompact(compact: CompactApp): string[] {
  const errors: string[] = []

  // Structural checks (app_name, module/form/question names, types) are handled
  // by the Zod schema — only cross-field semantic validations remain here.

  const validateModules = compact.modules || []
  for (let mIdx = 0; mIdx < validateModules.length; mIdx++) {
    const mod = validateModules[mIdx]

    const hasCaseForms = (mod.forms || []).some(f => f.type !== 'survey')
    if (hasCaseForms && !mod.case_type) {
      errors.push(`"${mod.name}" has case forms but no case_type`)
    }

    const validateForms = mod.forms || []
    for (let fIdx = 0; fIdx < validateForms.length; fIdx++) {
      const form = validateForms[fIdx]
      if (!form.questions || form.questions.length === 0) {
        errors.push(`"${form.name}" in "${mod.name}" has no questions`)
      }
      if (form.type === 'registration' && !form.case_name_field) {
        errors.push(`"${form.name}" is a registration form but has no case_name_field`)
      }

      // Validate select questions have options and XPath expressions (recursively for group/repeat children)
      function validateQuestions(questions: CompactQuestion[], formName: string) {
        for (const q of questions) {
          if ((q.type === 'select1' || q.type === 'select') && (!q.options || q.options.length === 0)) {
            errors.push(`Question "${q.id}" in "${formName}" is a select but has no options`)
          }
          // Validate XPath expressions
          for (const field of ['constraint', 'relevant', 'calculate'] as const) {
            const expr = q[field]
            if (expr) {
              const warnings = validateXPath(expr)
              for (const w of warnings) {
                errors.push(`Question "${q.id}" in "${formName}" ${field}: ${w.message}`)
              }
            }
          }
          if ((q.type === 'group' || q.type === 'repeat') && q.children) {
            validateQuestions(q.children, formName)
          }
        }
      }
      validateQuestions(form.questions || [], form.name)

      // Collect all question IDs including those inside groups/repeats
      function collectQuestionIds(questions: CompactQuestion[]): string[] {
        const ids: string[] = []
        for (const q of questions) {
          ids.push(q.id)
          if ((q.type === 'group' || q.type === 'repeat') && q.children) {
            ids.push(...collectQuestionIds(q.children))
          }
        }
        return ids
      }

      // Find a question by id (recursively searching groups/repeats)
      function findQuestionById(questions: CompactQuestion[], id: string): CompactQuestion | undefined {
        for (const q of questions) {
          if (q.id === id) return q
          if ((q.type === 'group' || q.type === 'repeat') && q.children) {
            const found = findQuestionById(q.children, id)
            if (found) return found
          }
        }
        return undefined
      }

      // Check case_name_field refers to a valid question
      if (form.type === 'registration' && form.case_name_field) {
        const questionIds = collectQuestionIds(form.questions || [])
        if (!questionIds.includes(form.case_name_field)) {
          errors.push(`"${form.name}" case_name_field "${form.case_name_field}" doesn't match any question id`)
        }
      }

      // Reserved case property names are auto-renamed during expansion — no error needed

      // Check case_properties values refer to valid question ids and are not media types
      if (form.case_properties) {
        const questionIds = collectQuestionIds(form.questions || [])
        for (const [prop, qId] of Object.entries(form.case_properties)) {
          if (!questionIds.includes(qId)) {
            errors.push(`"${form.name}" case property "${prop}" maps to question "${qId}" which doesn't exist`)
          } else {
            const q = findQuestionById(form.questions || [], qId)
            if (q && MEDIA_QUESTION_TYPES.has(q.type)) {
              errors.push(`"${form.name}" case property "${prop}" maps to a ${q.type} question — media/binary questions cannot be saved as case properties`)
            }
          }
        }
      }

      // Check for conflicting case properties (multiple properties from same question)
      if (form.case_properties) {
        const seen = new Map<string, string>() // questionId -> first property name
        for (const [prop, qId] of Object.entries(form.case_properties)) {
          if (seen.has(qId)) {
            errors.push(`"${form.name}" maps question "${qId}" to multiple case properties: "${seen.get(qId)}" and "${prop}"`)
          } else {
            seen.set(qId, prop)
          }
        }
      }

      // Check case_preload keys refer to valid question ids
      // Note: preload values are case properties being READ FROM — reserved words
      // like case_name are valid preload sources (e.g. displaying the case name).
      if (form.case_preload) {
        const questionIds = collectQuestionIds(form.questions || [])
        for (const [qId] of Object.entries(form.case_preload)) {
          if (!questionIds.includes(qId)) {
            errors.push(`"${form.name}" case_preload references question "${qId}" which doesn't exist`)
          }
        }
      }

      // Validate close_case
      if (form.close_case) {
        if (form.type !== 'followup') {
          errors.push(`"${form.name}" has close_case but is not a followup form — only followup forms can close cases`)
        }
        if (typeof form.close_case === 'object') {
          const cc = form.close_case as { question: string; answer: string }
          if (!cc.question) {
            errors.push(`"${form.name}" close_case condition is missing "question"`)
          } else {
            const questionIds = collectQuestionIds(form.questions || [])
            if (!questionIds.includes(cc.question)) {
              errors.push(`"${form.name}" close_case references question "${cc.question}" which doesn't exist`)
            }
          }
          if (!cc.answer) {
            errors.push(`"${form.name}" close_case condition is missing "answer"`)
          }
        }
      }

      // Validate child_cases
      if (form.child_cases) {
        const questionIds = collectQuestionIds(form.questions || [])
        for (let cIdx = 0; cIdx < form.child_cases.length; cIdx++) {
          const child = form.child_cases[cIdx]
          const prefix = `"${form.name}" child_cases[${cIdx}]`

          if (!child.case_type) {
            errors.push(`${prefix} is missing case_type`)
          }
          if (!child.case_name_field) {
            errors.push(`${prefix} is missing case_name_field`)
          } else if (!questionIds.includes(child.case_name_field)) {
            errors.push(`${prefix} case_name_field "${child.case_name_field}" doesn't match any question id`)
          }
          // Reserved case property names are auto-renamed during expansion
          if (child.case_properties) {
            for (const [prop, qId] of Object.entries(child.case_properties)) {
              if (!questionIds.includes(qId)) {
                errors.push(`${prefix} case property "${prop}" maps to question "${qId}" which doesn't exist`)
              }
            }
          }
          if (child.repeat_context) {
            const repeatQ = findQuestionById(form.questions || [], child.repeat_context)
            if (!repeatQ) {
              errors.push(`${prefix} repeat_context "${child.repeat_context}" doesn't match any question id`)
            } else if (repeatQ.type !== 'repeat') {
              errors.push(`${prefix} repeat_context "${child.repeat_context}" is not a repeat group`)
            }
          }
        }
      }

      // Detail columns READ case data — reserved words like case_name are valid column fields

      // Validate form_links
      if (form.form_links) {
        const allFormNames = (compact.modules || []).flatMap(m => (m.forms || []).map(f => f.name))
        for (const link of form.form_links) {
          if (!allFormNames.includes(link.form_name)) {
            errors.push(`"${form.name}" form_links references "${link.form_name}" which doesn't match any form name in the app`)
          }
        }
      }
    }
  }

  // Validate lookup tables
  if (compact.lookup_tables?.length) {
    const tags = new Set<string>()
    for (const table of compact.lookup_tables) {
      if (tags.has(table.tag)) {
        errors.push(`Duplicate lookup table tag "${table.tag}"`)
      }
      tags.add(table.tag)

      const fieldNames = new Set(table.fields.map(f => f.field_name))
      for (const row of table.data) {
        for (const key of Object.keys(row)) {
          if (!fieldNames.has(key)) {
            errors.push(`Lookup table "${table.tag}" data row has key "${key}" that doesn't match any field`)
          }
        }
      }
    }

    // Validate question lookup_table references
    function validateLookupRefs(questions: CompactQuestion[], formName: string) {
      for (const q of questions) {
        if (q.lookup_table) {
          if (!tags.has(q.lookup_table.tag)) {
            errors.push(`Question "${q.id}" in "${formName}" references lookup table "${q.lookup_table.tag}" which doesn't exist`)
          } else {
            const table = compact.lookup_tables!.find(t => t.tag === q.lookup_table!.tag)!
            const fieldNames = new Set(table.fields.map(f => f.field_name))
            if (!fieldNames.has(q.lookup_table.value_field)) {
              errors.push(`Question "${q.id}" in "${formName}" lookup_table value_field "${q.lookup_table.value_field}" doesn't match any field in "${q.lookup_table.tag}"`)
            }
            if (!fieldNames.has(q.lookup_table.label_field)) {
              errors.push(`Question "${q.id}" in "${formName}" lookup_table label_field "${q.lookup_table.label_field}" doesn't match any field in "${q.lookup_table.tag}"`)
            }
          }
        }
        if (q.children) validateLookupRefs(q.children, formName)
      }
    }
    for (const mod of compact.modules) {
      for (const form of mod.forms) {
        validateLookupRefs(form.questions || [], form.name)
      }
    }
  }

  return errors
}
