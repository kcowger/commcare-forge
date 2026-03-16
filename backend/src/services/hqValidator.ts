import type { ValidationResult } from '../types'
import { RESERVED_CASE_PROPERTIES } from '../constants/reservedCaseProperties'
import {
  DOC_TYPES, VALIDATION_PATTERNS, STANDARD_CREATE_PROPS,
  MODULE_TYPES, FORM_TYPES, REQUIRES_VALUES,
} from '../constants/commcareConfig'

export class HqValidator {
  /**
   * Validates generated files for HQ-specific and Formplayer-specific issues
   * that the CLI doesn't catch. Checks individual XForm files and cross-file consistency.
   */
  validate(files: Record<string, string>): ValidationResult {
    const errors: string[] = []

    // Per-XForm checks
    const xformXmlns: Map<string, string> = new Map() // xmlns -> filePath
    for (const [filePath, content] of Object.entries(files)) {
      if (!filePath.endsWith('.xml') || filePath === 'suite.xml' || filePath === 'media_suite.xml') continue
      if (filePath.endsWith('.ccpr')) continue

      const formErrors = this.checkXForm(filePath, content)
      errors.push(...formErrors)

      // Collect xmlns for uniqueness check
      const xmlns = this.extractXmlns(content)
      if (xmlns) {
        if (xformXmlns.has(xmlns)) {
          errors.push(`Duplicate xmlns "${xmlns}" in ${filePath} and ${xformXmlns.get(xmlns)}. Each form must have a unique xmlns.`)
        } else {
          xformXmlns.set(xmlns, filePath)
        }
      }
    }

    // Cross-file checks
    const crossFileErrors = this.checkCrossFile(files, xformXmlns)
    errors.push(...crossFileErrors)

    return {
      success: errors.length === 0,
      skipped: false,
      errors,
      stdout: '',
      stderr: ''
    }
  }

  private checkXForm(filePath: string, content: string): string[] {
    const errors: string[] = []

    // A. itext / Localization (CRITICAL — Formplayer crashes without this)
    const itextErrors = this.checkItext(filePath, content)
    errors.push(...itextErrors)

    // B. Reserved property names
    const caseUpdateProps = this.extractCaseUpdateProperties(content)
    for (const prop of caseUpdateProps) {
      if (RESERVED_CASE_PROPERTIES.has(prop.toLowerCase())) {
        errors.push(`Reserved case property "${prop}" in ${filePath}. HQ will reject this. Rename to something like "${prop}_value" or "${prop}_info".`)
      }
    }

    // C. Case property name format
    for (const prop of caseUpdateProps) {
      if (!VALIDATION_PATTERNS.CASE_PROPERTY.test(prop)) {
        errors.push(`Invalid case property name "${prop}" in ${filePath}. Must start with a letter and contain only letters, digits, underscores, or hyphens.`)
      }
    }

    // D. Case type format
    const caseTypes = this.extractCaseTypes(content)
    for (const ct of caseTypes) {
      if (!VALIDATION_PATTERNS.CASE_TYPE.test(ct)) {
        errors.push(`Invalid case type "${ct}" in ${filePath}. Case types can only contain letters, digits, underscores, and hyphens.`)
      }
    }

    // E. Case create block validation
    const createErrors = this.checkCaseCreateBlocks(filePath, content)
    errors.push(...createErrors)

    // F. Case update bind validation
    const updateBindErrors = this.checkCaseUpdateBinds(filePath, content)
    errors.push(...updateBindErrors)

    // G. Bind-instance consistency
    const bindErrors = this.checkBinds(filePath, content)
    errors.push(...bindErrors)

    // H. Case management path consistency — verify case update/preload/create calculate
    // expressions reference question paths that actually exist as bind nodesets
    const pathErrors = this.checkCasePathConsistency(filePath, content)
    errors.push(...pathErrors)

    return errors
  }

  // --- itext validation ---

  private checkItext(filePath: string, content: string): string[] {
    const errors: string[] = []

    // Check for <model> presence
    if (!content.includes('<model>') && !content.includes('<model ')) {
      return errors // Not an XForm
    }

    // 1. Must have an <itext> block
    const hasItext = content.includes('<itext>') || content.includes('<itext ')
    if (!hasItext) {
      errors.push(`XForm ${filePath} is missing <itext> block. Formplayer (Web Apps) REQUIRES itext localization. Add an <itext> block with <translation lang="en" default=""> inside <model>, and convert all inline labels to jr:itext() references.`)
      // If no itext at all, no point checking further itext details
      return errors
    }

    // 2. Must have at least one <translation> with a lang attribute
    const translationMatch = content.match(/<translation\s+[^>]*lang="([^"]+)"/)
    if (!translationMatch) {
      errors.push(`XForm ${filePath} has <itext> but no <translation lang="..."> element. Add at least one translation (e.g. <translation lang="en" default="">).`)
    }

    // 3. Check for inline labels (should use jr:itext instead)
    const inlineLabels = this.findInlineLabels(content)
    if (inlineLabels.length > 0) {
      const examples = inlineLabels.slice(0, 3).join(', ')
      errors.push(`XForm ${filePath} has ${inlineLabels.length} inline label(s) (${examples}). All labels MUST use ref="jr:itext('...')" instead of inline text. Formplayer requires itext references.`)
    }

    // 4. Check that every jr:itext() reference has a matching <text id="..."> in itext
    const itextRefs = this.extractItextReferences(content)
    const itextIds = this.extractItextDefinitions(content)
    for (const ref of itextRefs) {
      if (!itextIds.has(ref)) {
        errors.push(`XForm ${filePath} references jr:itext('${ref}') but no matching <text id="${ref}"> found in <itext>.`)
      }
    }

    // 5. Check for orphaned itext definitions (IDs defined but never referenced) — warning only, not error
    // Skipping this as it's not a breaking issue

    return errors
  }

  /**
   * Find inline labels in the body section (labels with text content instead of ref attribute).
   * Only checks inside <h:body> to avoid false positives from itext <value> elements.
   */
  private findInlineLabels(content: string): string[] {
    const inlineLabels: string[] = []

    // Extract body section
    const bodyMatch = content.match(/<h:body>([\s\S]*)<\/h:body>/)
    if (!bodyMatch) return inlineLabels

    const body = bodyMatch[1]

    // Find <label> elements that have text content (not ref attribute)
    // Match <label>some text</label> but NOT <label ref="..."/>
    const labelMatches = body.matchAll(/<label>([^<]+)<\/label>/g)
    for (const match of labelMatches) {
      const text = match[1].trim()
      if (text) {
        inlineLabels.push(`<label>${text}</label>`)
      }
    }

    return inlineLabels
  }

  /**
   * Extract all jr:itext('...') references from the body.
   */
  private extractItextReferences(content: string): string[] {
    const refs: string[] = []
    const matches = content.matchAll(/jr:itext\('([^']+)'\)/g)
    for (const m of matches) {
      refs.push(m[1])
    }
    return refs
  }

  /**
   * Extract all <text id="..."> definitions from itext block.
   */
  private extractItextDefinitions(content: string): Set<string> {
    const ids = new Set<string>()
    // Only look inside <itext>...</itext>
    const itextMatch = content.match(/<itext>([\s\S]*?)<\/itext>/)
    if (!itextMatch) return ids

    const itextContent = itextMatch[1]
    const matches = itextContent.matchAll(/<text\s+id="([^"]+)"/g)
    for (const m of matches) {
      ids.add(m[1])
    }
    return ids
  }

  // --- Cross-file validation ---

  /**
   * Cross-file validation: suite.xml <-> XForms <-> app_strings.txt consistency
   */
  private checkCrossFile(files: Record<string, string>, xformXmlns: Map<string, string>): string[] {
    const errors: string[] = []
    const suiteXml = files['suite.xml']
    if (!suiteXml) return errors

    // G1. Suite <form> values must match an XForm xmlns
    const suiteFormValues = this.extractSuiteFormValues(suiteXml)
    for (const formUri of suiteFormValues) {
      if (!xformXmlns.has(formUri)) {
        errors.push(`Suite entry references form xmlns "${formUri}" but no XForm file has this xmlns.`)
      }
    }

    // G2. Every command in a menu must have a matching entry
    const menuCommands = this.extractMenuCommands(suiteXml)
    const entryCommands = this.extractEntryCommands(suiteXml)
    // Menu IDs (like "m0") that reference submenus don't need entries — only leaf commands (like "m0-f0") do
    const menuIds = this.extractMenuIds(suiteXml)
    for (const cmd of menuCommands) {
      if (!entryCommands.has(cmd) && !menuIds.has(cmd)) {
        errors.push(`Suite menu references command "${cmd}" but no <entry> defines this command.`)
      }
    }

    // G3. Every locale ID in suite.xml must have a key in app_strings.txt
    const appStrings = files['default/app_strings.txt'] || ''
    const appStringKeys = new Set(
      appStrings.split('\n')
        .map(line => line.split('=')[0]?.trim())
        .filter(k => k)
    )
    const localeIds = this.extractLocaleIds(suiteXml)
    for (const locId of localeIds) {
      if (!appStringKeys.has(locId)) {
        errors.push(`Suite references locale id "${locId}" but no matching key in app_strings.txt.`)
      }
    }

    // H. detail-select references must match detail definitions
    const detailSelectIds = this.extractDetailSelectIds(suiteXml)
    const detailDefinitionIds = this.extractDetailDefinitionIds(suiteXml)
    for (const dsId of detailSelectIds) {
      if (!detailDefinitionIds.has(dsId)) {
        errors.push(`Entry datum references detail-select="${dsId}" but no <detail id="${dsId}"> exists in suite.xml.`)
      }
    }

    return errors
  }

  // --- XForm extraction helpers ---

  private extractXmlns(content: string): string | null {
    // Match xmlns on the <data> element: <data xmlns="http://..." ...>
    const match = content.match(/<data[^>]*\sxmlns="([^"]+)"/)
    return match ? match[1] : null
  }

  private extractCaseUpdateProperties(content: string): string[] {
    const props: string[] = []

    const updateBlocks = content.match(/<update>([\s\S]*?)<\/update>/g)
    if (updateBlocks) {
      for (const block of updateBlocks) {
        const childTags = block.match(/<(\w+)\s*\/?>/g)
        if (childTags) {
          for (const tag of childTags) {
            const match = tag.match(/<(\w+)/)
            if (match && match[1] !== 'update') {
              props.push(match[1])
            }
          }
        }
      }
    }

    // Extra properties in <create> blocks beyond standard ones
    const createBlocks = content.match(/<create>([\s\S]*?)<\/create>/g)
    if (createBlocks) {
      for (const block of createBlocks) {
        const childTags = block.match(/<(\w+)\s*\/?>/g)
        if (childTags) {
          for (const tag of childTags) {
            const match = tag.match(/<(\w+)/)
            if (match && match[1] !== 'create' && !STANDARD_CREATE_PROPS.has(match[1])) {
              props.push(match[1])
            }
          }
        }
      }
    }

    return props
  }

  private extractCaseTypes(content: string): string[] {
    const types: string[] = []
    // From <case_type> elements with calculate binds
    const calcMatches = content.matchAll(/nodeset="\/data\/case\/create\/case_type"\s+calculate="'([^']+)'"/g)
    for (const m of calcMatches) {
      types.push(m[1])
    }
    // From literal <case_type>value</case_type>
    const literalMatches = content.matchAll(/<case_type>([^<]+)<\/case_type>/g)
    for (const m of literalMatches) {
      types.push(m[1].trim())
    }
    return types
  }

  private checkCaseCreateBlocks(filePath: string, content: string): string[] {
    const errors: string[] = []
    const createBlocks = content.match(/<create>([\s\S]*?)<\/create>/g)
    if (!createBlocks) return errors

    for (const block of createBlocks) {
      // Must have case_type
      if (!block.includes('<case_type')) {
        errors.push(`Case <create> block in ${filePath} is missing <case_type>. Every case must have a type.`)
      }
      // Must have case_name
      if (!block.includes('<case_name')) {
        errors.push(`Case <create> block in ${filePath} is missing <case_name>. Every case must have a name.`)
      }
      // Must have owner_id
      if (!block.includes('<owner_id')) {
        errors.push(`Case <create> block in ${filePath} is missing <owner_id>. Every case must have an owner.`)
      }
    }

    // Verify case_name has a calculate bind
    if (createBlocks.length > 0) {
      const hasNameBind = /nodeset="\/data\/case\/create\/case_name"\s+calculate=/.test(content)
      if (!hasNameBind) {
        errors.push(`Case <create> in ${filePath} has <case_name> but no calculate bind for it. Add: <bind nodeset="/data/case/create/case_name" calculate="..."/>`)
      }
      const hasTypeBind = /nodeset="\/data\/case\/create\/case_type"\s+calculate=/.test(content)
      if (!hasTypeBind) {
        errors.push(`Case <create> in ${filePath} has <case_type> but no calculate bind for it. Add: <bind nodeset="/data/case/create/case_type" calculate="'type_name'"/>`)
      }
      const hasOwnerBind = /nodeset="\/data\/case\/create\/owner_id"\s+calculate=/.test(content)
      if (!hasOwnerBind) {
        errors.push(`Case <create> in ${filePath} has <owner_id> but no calculate bind for it. Add: <bind nodeset="/data/case/create/owner_id" calculate="instance('commcaresession')/session/context/userid"/>`)
      }
    }

    return errors
  }

  private checkCaseUpdateBinds(filePath: string, content: string): string[] {
    const errors: string[] = []
    const updateBlocks = content.match(/<update>([\s\S]*?)<\/update>/g)
    if (!updateBlocks) return errors

    // Extract update property names
    for (const block of updateBlocks) {
      const childTags = block.match(/<(\w+)\s*\/?>/g)
      if (!childTags) continue
      for (const tag of childTags) {
        const match = tag.match(/<(\w+)/)
        if (!match || match[1] === 'update') continue
        const propName = match[1]

        // Check that a bind exists for this property with a calculate
        const bindPattern = new RegExp(`nodeset="/data/case/update/${propName}"\\s+calculate=`)
        if (!bindPattern.test(content)) {
          errors.push(`Case update property "${propName}" in ${filePath} has no calculate bind. Add: <bind nodeset="/data/case/update/${propName}" calculate="..."/>`)
        }
      }
    }

    return errors
  }

  private checkBinds(filePath: string, content: string): string[] {
    const errors: string[] = []

    const instanceMatch = content.match(/<instance>\s*<data[^>]*>([\s\S]*?)<\/data>\s*<\/instance>/)
    if (!instanceMatch) return errors

    const instanceContent = instanceMatch[1]

    const binds = content.matchAll(/nodeset="([^"]+)"/g)
    for (const bind of binds) {
      const nodeset = bind[1]
      if (!nodeset.startsWith('/data/')) continue

      const subPath = nodeset.substring(6)
      const parts = subPath.split('/')
      const leafNode = parts[parts.length - 1]

      if (!instanceContent.includes(`<${leafNode}`) && !instanceContent.includes(`<${leafNode}/>`)) {
        errors.push(`Bind references "${nodeset}" but <${leafNode}> not found in instance data in ${filePath}.`)
      }
    }

    return errors
  }

  // --- Case management path consistency ---

  /**
   * Verify that case management calculate expressions reference question paths
   * that actually exist as bind nodesets in the XForm. Catches mismatches caused
   * by questions inside groups (e.g. calculate="/data/q" when the real path is
   * "/data/group/q").
   */
  private checkCasePathConsistency(filePath: string, content: string): string[] {
    const errors: string[] = []

    // Collect all bind nodesets (the set of valid paths in this form)
    const validPaths = new Set<string>()
    const bindNodesets = content.matchAll(/nodeset="([^"]+)"/g)
    for (const m of bindNodesets) {
      validPaths.add(m[1])
    }

    // Find all case-related binds whose calculate references a /data/ form path
    // These are binds like: nodeset="/data/case/update/prop" calculate="/data/some_question"
    // or: nodeset="/data/case/create/case_name" calculate="/data/some_question"
    const caseBinds = content.matchAll(
      /nodeset="(\/data\/case\/(?:update|create)\/[^"]+)"\s+calculate="([^"]+)"/g
    )
    for (const m of caseBinds) {
      const caseNodeset = m[1]
      const calculate = m[2]

      // Only check calculate expressions that reference form data paths
      // Skip literals like "'patient'" and instance references
      if (!calculate.startsWith('/data/') || calculate.startsWith('/data/case/')) continue

      if (!validPaths.has(calculate)) {
        const propName = caseNodeset.split('/').pop()
        errors.push(
          `Case property "${propName}" in ${filePath} references path "${calculate}" ` +
          `but no question exists at that path. The question may be inside a group — ` +
          `check that the path includes the group name (e.g. "/data/group_name/question_id").`
        )
      }
    }

    // Check case preload binds (these use nodeset="/data/question" as the target)
    // Preload works by: <setvalue ref="/data/preloaded_q" event="..." value="instance('casedb')/..."/>
    // But preload paths are in the HQ JSON actions, not in XForm binds, so we check the
    // data instance elements instead: every preload question path must have a data element
    // This is already covered by bind-instance consistency check above

    return errors
  }

  // --- Suite.xml extraction helpers ---

  private extractSuiteFormValues(suiteXml: string): string[] {
    const values: string[] = []
    const matches = suiteXml.matchAll(/<entry>[\s\S]*?<form>([^<]+)<\/form>/g)
    for (const m of matches) {
      values.push(m[1].trim())
    }
    return values
  }

  private extractMenuCommands(suiteXml: string): string[] {
    const commands: string[] = []
    const menuBlocks = suiteXml.matchAll(/<menu\s[^>]*>([\s\S]*?)<\/menu>/g)
    for (const block of menuBlocks) {
      const cmdMatches = block[1].matchAll(/<command\s+id="([^"]+)"\s*\/>/g)
      for (const cmd of cmdMatches) {
        commands.push(cmd[1])
      }
    }
    return commands
  }

  private extractEntryCommands(suiteXml: string): Set<string> {
    const commands = new Set<string>()
    const matches = suiteXml.matchAll(/<entry>[\s\S]*?<command\s+id="([^"]+)"/g)
    for (const m of matches) {
      commands.add(m[1])
    }
    return commands
  }

  private extractMenuIds(suiteXml: string): Set<string> {
    const ids = new Set<string>()
    const matches = suiteXml.matchAll(/<menu\s+id="([^"]+)"/g)
    for (const m of matches) {
      ids.add(m[1])
    }
    return ids
  }

  private extractLocaleIds(suiteXml: string): string[] {
    const ids: string[] = []
    const matches = suiteXml.matchAll(/<locale\s+id="([^"]+)"/g)
    for (const m of matches) {
      ids.push(m[1])
    }
    return ids
  }

  private extractDetailSelectIds(suiteXml: string): string[] {
    const ids: string[] = []
    const matches = suiteXml.matchAll(/detail-select="([^"]+)"/g)
    for (const m of matches) {
      ids.push(m[1])
    }
    return ids
  }

  private extractDetailDefinitionIds(suiteXml: string): Set<string> {
    const ids = new Set<string>()
    const matches = suiteXml.matchAll(/<detail\s+id="([^"]+)"/g)
    for (const m of matches) {
      ids.add(m[1])
    }
    return ids
  }

  // =====================================================================
  // HQ JSON Structure Validation
  // =====================================================================

  /**
   * Validates the HQ import JSON structure — doc_types, required fields, field values,
   * and HQ-specific rules that operate on the JSON (not XForm XML).
   */
  validateHqJsonStructure(hqJson: Record<string, any>): ValidationResult {
    const errors: string[] = []

    // --- Application level ---
    this.expectField(errors, hqJson, 'doc_type', DOC_TYPES.Application, 'Application')
    this.expectRequired(errors, hqJson, ['name', 'langs', 'modules', '_attachments'], 'Application')
    if (!Array.isArray(hqJson.modules)) {
      errors.push('Application.modules must be an array')
      return this.result(errors)
    }
    if (hqJson.modules.length === 0) {
      errors.push('Application has no modules (HQ rule 1.2)')
    }
    if (!Array.isArray(hqJson.langs) || hqJson.langs.length === 0) {
      errors.push('Application.langs must be a non-empty array')
    }

    const modules = hqJson.modules

    // --- Module level ---
    for (let mIdx = 0; mIdx < modules.length; mIdx++) {
      const mod = modules[mIdx]
      const mc = `modules[${mIdx}]`

      this.expectField(errors, mod, 'doc_type', DOC_TYPES.Module, mc)
      this.expectRequired(errors, mod, ['unique_id', 'name', 'forms', 'case_details'], mc)
      this.expectEnum(errors, mod, 'module_type', [...MODULE_TYPES], mc)

      // Case details structure
      if (mod.case_details) {
        this.expectField(errors, mod.case_details, 'doc_type', DOC_TYPES.DetailPair, `${mc}.case_details`)
        if (mod.case_details.short) {
          this.expectField(errors, mod.case_details.short, 'doc_type', DOC_TYPES.Detail, `${mc}.case_details.short`)
        }
        if (mod.case_details.long) {
          this.expectField(errors, mod.case_details.long, 'doc_type', DOC_TYPES.Detail, `${mc}.case_details.long`)
        }
      }

      // Rule 2.2: Modules with case-requiring forms must have detail columns
      const hasCaseForm = (mod.forms || []).some((f: any) => f.requires === 'case')
      if (hasCaseForm && mod.case_type) {
        const shortCols = mod.case_details?.short?.columns || []
        if (shortCols.length === 0) {
          errors.push(`${mc} "${mod.name?.en}": Module requires cases but has no case detail columns. HQ requires at least one.`)
        }
      }

      // Detail column field regex
      for (const col of (mod.case_details?.short?.columns || [])) {
        if (col.field && !VALIDATION_PATTERNS.DETAIL_FIELD.test(col.field)) {
          errors.push(`${mc}: Case detail column field "${col.field}" doesn't match HQ's required pattern.`)
        }
      }

      // --- Form level ---
      for (let fIdx = 0; fIdx < (mod.forms || []).length; fIdx++) {
        const form = mod.forms[fIdx]
        const fc = `${mc}.forms[${fIdx}]`

        this.expectField(errors, form, 'doc_type', DOC_TYPES.Form, fc)
        this.expectRequired(errors, form, ['unique_id', 'xmlns', 'name', 'actions'], fc)
        this.expectEnum(errors, form, 'form_type', [...FORM_TYPES], fc)
        this.expectEnum(errors, form, 'requires', [...REQUIRES_VALUES], fc)

        // Attachment must exist
        if (form.unique_id && hqJson._attachments) {
          const key = `${form.unique_id}.xml`
          if (!hqJson._attachments[key]) {
            errors.push(`${fc}: Missing XForm attachment "${key}" in _attachments`)
          }
        }

        // --- Actions structure ---
        const actions = form.actions
        if (!actions) continue

        this.expectField(errors, actions, 'doc_type', DOC_TYPES.FormActions, `${fc}.actions`)

        if (actions.open_case) {
          this.expectField(errors, actions.open_case, 'doc_type', DOC_TYPES.OpenCaseAction, `${fc}.actions.open_case`)
          this.checkCondition(errors, actions.open_case.condition, `${fc}.actions.open_case.condition`)
        }
        if (actions.update_case) {
          this.expectField(errors, actions.update_case, 'doc_type', DOC_TYPES.UpdateCaseAction, `${fc}.actions.update_case`)
          this.checkCondition(errors, actions.update_case.condition, `${fc}.actions.update_case.condition`)

          // Check update_case keys for reserved words
          if (actions.update_case.update) {
            for (const key of Object.keys(actions.update_case.update)) {
              if (RESERVED_CASE_PROPERTIES.has(key.toLowerCase())) {
                errors.push(`${fc}: update_case uses reserved property "${key}". HQ will reject this.`)
              }
            }
          }
        }
        if (actions.close_case) {
          this.expectField(errors, actions.close_case, 'doc_type', DOC_TYPES.FormAction, `${fc}.actions.close_case`)
          this.checkCondition(errors, actions.close_case.condition, `${fc}.actions.close_case.condition`)
        }
        if (actions.case_preload) {
          this.expectField(errors, actions.case_preload, 'doc_type', DOC_TYPES.PreloadAction, `${fc}.actions.case_preload`)
          this.checkCondition(errors, actions.case_preload.condition, `${fc}.actions.case_preload.condition`)
        }

        // Rule 5.6: Can't update a case without opening or requiring one
        const opensCase = actions.open_case?.condition?.type === 'always'
        const requiresCase = form.requires === 'case'
        const updatesCase = actions.update_case?.condition?.type === 'always'
        if (updatesCase && !opensCase && !requiresCase) {
          errors.push(`${fc} "${form.name?.en}": Updates a case but neither opens nor requires one (HQ rule 5.6).`)
        }

        // Subcases
        for (let sIdx = 0; sIdx < (actions.subcases || []).length; sIdx++) {
          const sc = actions.subcases[sIdx]
          const sCtx = `${fc}.actions.subcases[${sIdx}]`
          this.expectField(errors, sc, 'doc_type', DOC_TYPES.OpenSubCaseAction, sCtx)
          this.expectRequired(errors, sc, ['case_type', 'name_update', 'condition'], sCtx)
          this.expectEnum(errors, sc, 'relationship', ['child', 'extension'], sCtx)
          this.checkCondition(errors, sc.condition, `${sCtx}.condition`)

          // Check subcase properties for reserved words
          if (sc.case_properties) {
            for (const key of Object.keys(sc.case_properties)) {
              if (RESERVED_CASE_PROPERTIES.has(key.toLowerCase())) {
                errors.push(`${sCtx}: uses reserved property "${key}". HQ will reject this.`)
              }
            }
          }
        }
      }
    }

    return this.result(errors)
  }

  // =====================================================================
  // CCZ File Validation
  // =====================================================================

  /**
   * Validates the files that make up a .ccz package — suite.xml, profile, app_strings, XForms.
   */
  validateCczFiles(files: Record<string, string>): ValidationResult {
    const errors: string[] = []

    // suite.xml
    const suiteXml = files['suite.xml']
    if (!suiteXml) {
      errors.push('CCZ missing suite.xml')
    } else {
      if (!suiteXml.includes('<suite')) errors.push('suite.xml missing <suite> root element')
      if (!/<entry>/.test(suiteXml)) errors.push('suite.xml has no <entry> elements')
      if (!/<menu\s/.test(suiteXml)) errors.push('suite.xml has no <menu> elements')
      if (!/<locale\s/.test(suiteXml)) errors.push('suite.xml has no <locale> resource')
    }

    // profile.ccpr
    const profile = files['profile.ccpr']
    if (!profile) {
      errors.push('CCZ missing profile.ccpr')
    } else {
      if (!profile.includes('uniqueid=')) errors.push('profile.ccpr missing uniqueid attribute')
      if (!profile.includes('suite.xml')) errors.push('profile.ccpr does not reference suite.xml')
    }

    // app_strings.txt
    const appStrings = files['default/app_strings.txt']
    if (!appStrings) {
      errors.push('CCZ missing default/app_strings.txt')
    } else {
      if (!appStrings.includes('app.name=')) errors.push('app_strings.txt missing app.name key')
    }

    // At least one XForm
    const xformFiles = Object.keys(files).filter(k => k.startsWith('modules-') && k.endsWith('.xml'))
    if (xformFiles.length === 0) {
      errors.push('CCZ has no XForm files')
    }

    return this.result(errors)
  }

  // =====================================================================
  // Helpers for structure validation
  // =====================================================================

  private result(errors: string[]): ValidationResult {
    return { success: errors.length === 0, skipped: false, errors, stdout: '', stderr: '' }
  }

  private expectField(errors: string[], obj: any, field: string, expected: string, ctx: string) {
    if (obj?.[field] !== expected) {
      errors.push(`${ctx}.${field} should be "${expected}" but is "${obj?.[field]}"`)
    }
  }

  private expectRequired(errors: string[], obj: any, fields: string[], ctx: string) {
    for (const f of fields) {
      if (obj?.[f] === undefined || obj?.[f] === null) {
        errors.push(`${ctx} is missing required field "${f}"`)
      }
    }
  }

  private expectEnum(errors: string[], obj: any, field: string, valid: string[], ctx: string) {
    if (obj?.[field] !== undefined && !valid.includes(obj[field])) {
      errors.push(`${ctx}.${field} has invalid value "${obj[field]}". Valid: ${valid.join(', ')}`)
    }
  }

  private checkCondition(errors: string[], cond: any, ctx: string) {
    if (!cond) { errors.push(`${ctx} is missing`); return }
    if (cond.doc_type !== DOC_TYPES.FormActionCondition) {
      errors.push(`${ctx}.doc_type should be "${DOC_TYPES.FormActionCondition}" but is "${cond.doc_type}"`)
    }
    if (!['always', 'never', 'if'].includes(cond.type)) {
      errors.push(`${ctx}.type has invalid value "${cond.type}". Valid: always, never, if`)
    }
  }
}
