import { randomBytes } from 'crypto'

/** Reserved case property names — HQ rejects these in update_case */
const RESERVED_CASE_PROPERTIES = new Set([
  'case_id', 'case_name', 'case_type', 'closed', 'closed_by', 'closed_on',
  'date', 'date_modified', 'date_opened', 'doc_type', 'domain',
  'external_id', 'index', 'indices', 'modified_on', 'opened_by',
  'opened_on', 'owner_id', 'server_modified_on', 'status', 'type',
  'user_id', 'xform_id', 'name'
])

/**
 * Compact format that Claude outputs — contains only the variable parts.
 * The expander converts this into the full HQ import JSON with all boilerplate.
 */
export interface CompactApp {
  app_name: string
  modules: CompactModule[]
}

export interface CompactModule {
  name: string
  case_type?: string
  forms: CompactForm[]
  case_list_columns?: { field: string; header: string }[]
}

export interface CompactForm {
  name: string
  /** "registration" = creates a new case, "followup" = updates existing case, "survey" = no case management */
  type: 'registration' | 'followup' | 'survey'
  /** Which question's value becomes the case name (registration forms only) */
  case_name_field?: string
  /** Map of case property → question id for saving to case */
  case_properties?: Record<string, string>
  /** Map of question id → case property for loading from case (followup forms only) */
  case_preload?: Record<string, string>
  questions: CompactQuestion[]
}

export interface CompactQuestion {
  id: string
  type: 'text' | 'int' | 'date' | 'select1' | 'select' | 'geopoint' | 'image' | 'barcode' | 'decimal' | 'long' | 'trigger' | 'phone' | 'time' | 'datetime' | 'audio' | 'video' | 'signature' | 'hidden' | 'secret' | 'group' | 'repeat'
  label: string
  hint?: string
  required?: boolean
  readonly?: boolean
  constraint?: string
  constraint_msg?: string
  relevant?: string
  calculate?: string
  /** For select1/select questions */
  options?: { value: string; label: string }[]
  /** For group/repeat questions — nested child questions */
  children?: CompactQuestion[]
}

/**
 * Expands a compact app definition into the full HQ import JSON.
 * All boilerplate, doc_types, unique_ids, xmlns, and XForm XML are generated here.
 */
export function expandToHqJson(compact: CompactApp): Record<string, any> {
  const attachments: Record<string, string> = {}
  const modules: any[] = []

  for (let mIdx = 0; mIdx < compact.modules.length; mIdx++) {
    const cm = compact.modules[mIdx]
    const moduleUniqueId = genHexId()
    const hasCases = cm.case_type && cm.forms.some(f => f.type !== 'survey')
    const caseType = hasCases ? cm.case_type! : ''

    const forms: any[] = []

    for (let fIdx = 0; fIdx < cm.forms.length; fIdx++) {
      const cf = cm.forms[fIdx]
      const formUniqueId = genHexId()
      const xmlns = `http://openrosa.org/formdesigner/${genShortId()}`

      // Generate XForm XML
      const xform = buildXForm(cf, xmlns)
      attachments[`${formUniqueId}.xml`] = xform

      // Build form actions (with reserved word filtering)
      const actions = buildFormActions(cf, caseType)

      forms.push({
        doc_type: 'Form',
        form_type: 'module_form',
        unique_id: formUniqueId,
        name: { en: cf.name },
        xmlns,
        requires: cf.type === 'followup' ? 'case' : 'none',
        version: null,
        actions,
        case_references_data: { load: {}, save: {}, doc_type: 'CaseReferences' },
        form_filter: null,
        post_form_workflow: 'default',
        no_vellum: false,
        media_image: {}, media_audio: {}, custom_icons: [],
        custom_assertions: [], custom_instances: [], form_links: [],
        comment: ''
      })
    }

    // Build case details
    const caseDetails = hasCases ? buildCaseDetails(cm.case_list_columns || []) : buildEmptyCaseDetails()

    modules.push({
      doc_type: 'Module',
      module_type: 'basic',
      unique_id: moduleUniqueId,
      name: { en: cm.name },
      case_type: caseType,
      put_in_root: false,
      root_module_id: null,
      forms,
      case_details: caseDetails,
      case_list: { doc_type: 'CaseList', show: false, label: {}, media_image: {}, media_audio: {}, custom_icons: [] },
      case_list_form: { doc_type: 'CaseListForm', form_id: null, label: {} },
      search_config: { doc_type: 'CaseSearch', properties: [], default_properties: [], include_closed: false },
      display_style: 'list',
      media_image: {}, media_audio: {}, custom_icons: [],
      is_training_module: false, module_filter: null, auto_select_case: false,
      parent_select: { active: false, module_id: null },
      comment: ''
    })
  }

  return {
    doc_type: 'Application',
    application_version: '2.0',
    name: compact.app_name,
    langs: ['en'],
    build_spec: { doc_type: 'BuildSpec', version: '2.53.0', build_number: null },
    profile: { doc_type: 'Profile', features: {}, properties: {} },
    vellum_case_management: true,
    cloudcare_enabled: false,
    case_sharing: false,
    secure_submissions: false,
    multimedia_map: {},
    translations: {},
    modules,
    _attachments: attachments
  }
}

function genHexId(): string {
  return randomBytes(20).toString('hex')
}

function genShortId(): string {
  return randomBytes(8).toString('hex')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Build complete XForm XML from question definitions. */
function buildXForm(form: CompactForm, xmlns: string): string {
  const questions = form.questions || []
  const dataElements: string[] = []
  const binds: string[] = []
  const itextEntries: string[] = []
  const bodyElements: string[] = []

  for (const q of questions) {
    buildQuestionParts(q, '/data', dataElements, binds, itextEntries, bodyElements)
  }

  const dataContent = dataElements.length > 0
    ? '\n' + dataElements.map(e => `          ${e}`).join('\n') + '\n        '
    : ''

  const bindContent = binds.length > 0
    ? '\n' + binds.map(b => `      ${b}`).join('\n')
    : ''

  const itextContent = itextEntries.map(e => `          ${e}`).join('\n')

  const bodyContent = bodyElements.map(e => `    ${e}`).join('\n')

  return `<?xml version="1.0"?>
<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>${escapeXml(form.name)}</h:title>
    <model>
      <instance>
        <data xmlns="${xmlns}" xmlns:jrm="http://dev.commcarehq.org/jr/xforms" uiVersion="1" version="1" name="${escapeXml(form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'))}">${dataContent}</data>
      </instance>${bindContent}
      <itext>
        <translation lang="en" default="">
${itextContent}
        </translation>
      </itext>
    </model>
  </h:head>
  <h:body>
${bodyContent}
  </h:body>
</h:html>`
}

function buildQuestionParts(
  q: CompactQuestion,
  parentPath: string,
  dataElements: string[],
  binds: string[],
  itextEntries: string[],
  bodyElements: string[]
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
    itextEntries.push(`<text id="${q.id}-label"><value>${escapeXml(q.label)}</value></text>`)
    if (q.hint) {
      itextEntries.push(`<text id="${q.id}-hint"><value>${escapeXml(q.hint)}</value></text>`)
    }
  }

  // itext for select options
  if (q.options) {
    for (const opt of q.options) {
      itextEntries.push(`<text id="${q.id}-${opt.value}-label"><value>${escapeXml(opt.label)}</value></text>`)
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
    const childItext: string[] = []
    const childBody: string[] = []
    for (const child of (q.children || [])) {
      buildQuestionParts(child, nodePath, childData, childBinds, childItext, childBody)
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
    itextEntries.push(...childItext)
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
    const items = (q.options || []).map(opt =>
      `  <item><label ref="jr:itext('${q.id}-${opt.value}-label')"/><value>${escapeXml(opt.value)}</value></item>`
    ).join('\n    ')
    let el = `<${tag} ref="${nodePath}">\n      <label ref="jr:itext('${q.id}-label')"/>`
    if (q.hint) el += `\n      <hint ref="jr:itext('${q.id}-hint')"/>`
    el += `\n    ${items}\n    </${tag}>`
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
  } else if (q.type === 'image' || q.type === 'audio' || q.type === 'video' || q.type === 'signature') {
    const mediatype = q.type === 'audio' ? 'audio/*' : q.type === 'video' ? 'video/*' : 'image/*'
    const appearance = q.type === 'signature' ? ' appearance="signature"' : ''
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
  switch (type) {
    case 'phone': return 'numeric'
    default: return null
  }
}

function getXsdType(type: string): string | null {
  switch (type) {
    case 'text': return 'xsd:string'
    case 'phone': return 'xsd:string'
    case 'int': return 'xsd:int'
    case 'long': return 'xsd:long'
    case 'decimal': return 'xsd:decimal'
    case 'date': return 'xsd:date'
    case 'time': return 'xsd:time'
    case 'datetime': return 'xsd:dateTime'
    case 'geopoint': return 'xsd:string'
    case 'barcode': return 'xsd:string'
    case 'image': return 'xsd:string'
    case 'audio': return 'xsd:string'
    case 'video': return 'xsd:string'
    case 'signature': return 'xsd:string'
    case 'hidden': return 'xsd:string'
    case 'secret': return 'xsd:string'
    case 'trigger': return null
    case 'group': return null
    case 'repeat': return null
    case 'select1': return 'xsd:string'
    case 'select': return 'xsd:string'
    default: return 'xsd:string'
  }
}

/** Build form actions based on form type and case config. Filters reserved words. */
function buildFormActions(form: CompactForm, caseType: string): any {
  const neverCondition = { type: 'never', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' }
  const alwaysCondition = { type: 'always', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' }

  const base = {
    doc_type: 'FormActions',
    open_case: {
      doc_type: 'OpenCaseAction',
      name_update: { question_path: '' },
      external_id: null,
      condition: { ...neverCondition }
    },
    update_case: {
      doc_type: 'UpdateCaseAction',
      update: {},
      condition: { ...neverCondition }
    },
    close_case: { doc_type: 'FormAction', condition: { ...neverCondition } },
    case_preload: { doc_type: 'PreloadAction', preload: {}, condition: { ...neverCondition } },
    subcases: [],
    usercase_preload: { doc_type: 'PreloadAction', preload: {}, condition: { ...neverCondition } },
    usercase_update: { doc_type: 'UpdateCaseAction', update: {}, condition: { ...neverCondition } },
    load_from_form: { doc_type: 'PreloadAction', preload: {}, condition: { ...neverCondition } }
  }

  if (form.type === 'survey' || !caseType) {
    return base
  }

  // Build a safe update map, filtering out reserved property names
  function buildSafeUpdateMap(caseProperties: Record<string, string> | undefined): Record<string, any> {
    const updateMap: Record<string, any> = {}
    if (!caseProperties) return updateMap
    for (const [caseProp, questionId] of Object.entries(caseProperties)) {
      if (RESERVED_CASE_PROPERTIES.has(caseProp)) continue // skip reserved words
      updateMap[caseProp] = { question_path: `/data/${questionId}`, update_mode: 'always' }
    }
    return updateMap
  }

  if (form.type === 'registration') {
    // Open case
    base.open_case.condition = { ...alwaysCondition }
    base.open_case.name_update.question_path = `/data/${form.case_name_field || form.questions[0]?.id || 'name'}`

    // Update case properties (filtered)
    const updateMap = buildSafeUpdateMap(form.case_properties)
    if (Object.keys(updateMap).length > 0) {
      base.update_case.condition = { ...alwaysCondition }
      base.update_case.update = updateMap
    }
  }

  if (form.type === 'followup') {
    // Update case (filtered)
    const updateMap = buildSafeUpdateMap(form.case_properties)
    if (Object.keys(updateMap).length > 0) {
      base.update_case.condition = { ...alwaysCondition }
      base.update_case.update = updateMap
    }

    // Preload case data — filter reserved words (HQ rejects them in preloads too)
    if (form.case_preload && Object.keys(form.case_preload).length > 0) {
      const preloadMap: Record<string, string> = {}
      for (const [questionId, caseProp] of Object.entries(form.case_preload)) {
        if (RESERVED_CASE_PROPERTIES.has(caseProp)) continue // HQ rejects reserved words in preloads
        preloadMap[`/data/${questionId}`] = caseProp
      }
      if (Object.keys(preloadMap).length > 0) {
        base.case_preload.condition = { ...alwaysCondition }
        base.case_preload.preload = preloadMap
      }
    }
  }

  return base
}

function buildCaseDetails(columns: { field: string; header: string }[]): any {
  // Filter out reserved words from case list columns too
  const safeColumns = columns.filter(col => !RESERVED_CASE_PROPERTIES.has(col.field))

  const shortColumns = safeColumns.map(col => ({
    doc_type: 'DetailColumn',
    header: { en: col.header },
    field: col.field,
    model: 'case',
    format: 'plain',
    calc_xpath: '.', filter_xpath: '', advanced: '',
    late_flag: 30, time_ago_interval: 365.25,
    useXpathExpression: false, hasNodeset: false, hasAutocomplete: false,
    isTab: false, enum: [], graph_configuration: null,
    relevant: '', case_tile_field: null, nodeset: ''
  }))

  // Always ensure case_name is the first column in the case list
  if (!shortColumns.some(col => col.field === 'case_name' || col.field === 'name')) {
    shortColumns.unshift({
      doc_type: 'DetailColumn',
      header: { en: 'Name' },
      field: 'case_name',
      model: 'case',
      format: 'plain',
      calc_xpath: '.', filter_xpath: '', advanced: '',
      late_flag: 30, time_ago_interval: 365.25,
      useXpathExpression: false, hasNodeset: false, hasAutocomplete: false,
      isTab: false, enum: [], graph_configuration: null,
      relevant: '', case_tile_field: null, nodeset: ''
    })
  }

  const detailBase = {
    sort_elements: [], tabs: [], filter: null,
    lookup_enabled: false, lookup_autolaunch: false, lookup_display_results: false,
    lookup_name: null, lookup_image: null, lookup_action: null,
    lookup_field_template: null, lookup_field_header: {},
    lookup_extras: [], lookup_responses: [],
    persist_case_context: null, persistent_case_context_xml: 'case_name',
    persist_tile_on_forms: null, persistent_case_tile_from_module: null,
    pull_down_tile: null, case_tile_template: null,
    custom_xml: null, custom_variables: null
  }

  return {
    doc_type: 'DetailPair',
    short: {
      doc_type: 'Detail', display: 'short',
      columns: shortColumns,
      ...detailBase
    },
    long: {
      doc_type: 'Detail', display: 'long',
      columns: [],
      ...detailBase
    }
  }
}

function buildEmptyCaseDetails(): any {
  const detailBase = {
    sort_elements: [], tabs: [], filter: null,
    lookup_enabled: false, lookup_autolaunch: false, lookup_display_results: false,
    lookup_name: null, lookup_image: null, lookup_action: null,
    lookup_field_template: null, lookup_field_header: {},
    lookup_extras: [], lookup_responses: [],
    persist_case_context: null, persistent_case_context_xml: 'case_name',
    persist_tile_on_forms: null, persistent_case_tile_from_module: null,
    pull_down_tile: null, case_tile_template: null,
    custom_xml: null, custom_variables: null
  }

  return {
    doc_type: 'DetailPair',
    short: { doc_type: 'Detail', display: 'short', columns: [], ...detailBase },
    long: { doc_type: 'Detail', display: 'long', columns: [], ...detailBase }
  }
}

/**
 * Validate the compact format before expanding.
 * Returns a list of errors (empty = valid).
 */
export function validateCompact(compact: CompactApp): string[] {
  const errors: string[] = []

  if (!compact.app_name) {
    errors.push('Missing app_name')
  }

  if (!compact.modules || compact.modules.length === 0) {
    errors.push('No modules defined')
  }

  for (let mIdx = 0; mIdx < (compact.modules || []).length; mIdx++) {
    const mod = compact.modules[mIdx]
    if (!mod.name) errors.push(`Module ${mIdx} has no name`)

    const hasCaseForms = mod.forms?.some(f => f.type !== 'survey')
    if (hasCaseForms && !mod.case_type) {
      errors.push(`"${mod.name}" has case forms but no case_type`)
    }

    for (let fIdx = 0; fIdx < (mod.forms || []).length; fIdx++) {
      const form = mod.forms[fIdx]
      if (!form.name) errors.push(`Module "${mod.name}" form ${fIdx} has no name`)
      if (!form.type) errors.push(`"${form.name}" has no type (must be registration, followup, or survey)`)
      if (!form.questions || form.questions.length === 0) {
        errors.push(`"${form.name}" in "${mod.name}" has no questions`)
      }
      if (form.type === 'registration' && !form.case_name_field) {
        errors.push(`"${form.name}" is a registration form but has no case_name_field`)
      }

      // Validate question ids (recursively for group/repeat children)
      function validateQuestions(questions: CompactQuestion[], formName: string) {
        for (const q of questions) {
          if (!q.id) errors.push(`Question in "${formName}" has no id`)
          if (!q.type) errors.push(`Question "${q.id}" in "${formName}" has no type`)
          if (!q.label && q.type !== 'hidden') errors.push(`Question "${q.id}" in "${formName}" has no label`)
          if ((q.type === 'select1' || q.type === 'select') && (!q.options || q.options.length === 0)) {
            errors.push(`Question "${q.id}" in "${formName}" is a select but has no options`)
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

      // Check case_name_field refers to a valid question
      if (form.type === 'registration' && form.case_name_field) {
        const questionIds = collectQuestionIds(form.questions || [])
        if (!questionIds.includes(form.case_name_field)) {
          errors.push(`"${form.name}" case_name_field "${form.case_name_field}" doesn't match any question id`)
        }
      }

      // Check case_properties keys are not reserved words
      if (form.case_properties) {
        for (const prop of Object.keys(form.case_properties)) {
          if (RESERVED_CASE_PROPERTIES.has(prop)) {
            errors.push(`"${form.name}" uses reserved case property name "${prop}" — use a different name`)
          }
        }
      }

      // Check case_properties values refer to valid question ids
      if (form.case_properties) {
        const questionIds = collectQuestionIds(form.questions || [])
        for (const [prop, qId] of Object.entries(form.case_properties)) {
          if (!questionIds.includes(qId)) {
            errors.push(`"${form.name}" case property "${prop}" maps to question "${qId}" which doesn't exist`)
          }
        }
      }

      // Check case_preload keys refer to valid question ids and values aren't reserved
      if (form.case_preload) {
        const questionIds = collectQuestionIds(form.questions || [])
        for (const [qId, caseProp] of Object.entries(form.case_preload)) {
          if (!questionIds.includes(qId)) {
            errors.push(`"${form.name}" case_preload references question "${qId}" which doesn't exist`)
          }
          if (RESERVED_CASE_PROPERTIES.has(caseProp)) {
            errors.push(`"${form.name}" case_preload uses reserved property "${caseProp}" — use a custom property name instead`)
          }
        }
      }

      // Check case_list_columns don't use reserved words
      if (mod.case_list_columns) {
        for (const col of mod.case_list_columns) {
          if (RESERVED_CASE_PROPERTIES.has(col.field)) {
            errors.push(`Case list column "${col.field}" in "${mod.name}" uses a reserved property name`)
          }
        }
      }
    }
  }

  return errors
}
