/**
 * Orchestrates the three-tiered app generation pipeline:
 *
 *   Tier 1: Scaffold — plan app structure + data model (Sonnet, structured output)
 *   Tier 2: Module content — case list columns per module (Sonnet, structured output)
 *   Tier 3: Form content — questions + case config per form (Sonnet, structured output)
 *   Assembly — combine tiers into a full AppBlueprint
 *   Validate — check semantic rules; if errors, re-generate failing forms (Haiku)
 *   Expand — convert to HQ JSON, export, compile .ccz
 *
 * Each tier uses its own slim structured output schema, keeping well within
 * Anthropic's schema compilation limits. Data flows top-down: the scaffold's
 * case_types define the "contract" that modules and forms build against.
 */
import type { AppDefinition, GenerationProgress } from '../types'
import { ClaudeService } from './claude'
import { CczCompiler } from './cczCompiler'
import { AppExporter } from './appExporter'
import { BuildLogger } from './buildLogger'
import { SCAFFOLD_PROMPT } from '../prompts/scaffoldPrompt'
import { MODULE_PROMPT } from '../prompts/modulePrompt'
import { FORM_PROMPT } from '../prompts/formPrompt'
import { FORM_FIXER_PROMPT } from '../prompts/formFixerPrompt'
import {
  scaffoldSchema, moduleContentSchema, formContentSchema,
  assembleBlueprint, unflattenQuestions, flattenQuestions, closeCaseToFlat,
  type Scaffold, type ModuleContent, type FormContent, type AppBlueprint, type BlueprintForm,
} from '../schemas/blueprint'
import { expandBlueprint, validateBlueprint } from './hqJsonExpander'

type ReportFn = (
  status: GenerationProgress['status'],
  message: string,
  attempt: number,
  totalSteps?: number,
  completedSteps?: number,
  currentStep?: string,
) => void

export class AppGenerator {
  private claudeService: ClaudeService
  private cczCompiler: CczCompiler
  private appExporter: AppExporter

  constructor(claudeService: ClaudeService) {
    this.claudeService = claudeService
    this.cczCompiler = new CczCompiler()
    this.appExporter = new AppExporter()
  }

  async generate(
    conversationContext: string,
    onProgress?: (progress: GenerationProgress) => void,
    appName?: string
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string; errors?: string[] }> {
    const report: ReportFn = (status, message, attempt, totalSteps, completedSteps, currentStep) => {
      if (onProgress) {
        onProgress({ status, message, attempt, totalSteps, completedSteps, currentStep })
      }
    }

    const resolvedAppName = appName || this.inferAppName(conversationContext)
    const logger = new BuildLogger(resolvedAppName)

    try {
      return await this.doGenerate(conversationContext, report, resolvedAppName, logger)
    } finally {
      const logPath = logger.save()
      console.log(`Build log saved: ${logPath}`)
    }
  }

  private async doGenerate(
    conversationContext: string,
    report: ReportFn,
    resolvedAppName: string,
    logger: BuildLogger
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string; errors?: string[] }> {

    // ── Tier 1: Scaffold ──────────────────────────────────────────────

    report('scaffolding', 'Planning app structure...', 0)
    logger.logSection('SCAFFOLD')
    logger.log('Requesting scaffold from Claude...')

    const scaffoldMessage = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nBased on this conversation, plan the app structure. App name: "${resolvedAppName}".`

    let scaffold: Scaffold
    try {
      scaffold = await this.claudeService.sendOneShotStructured(
        SCAFFOLD_PROMPT, scaffoldMessage, scaffoldSchema,
        () => {},
        { maxTokens: 16384 }
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.log(`FATAL: Scaffold generation failed: ${errMsg}`)
      report('failed', 'Failed to plan app structure', 0)
      return { success: false, errors: [`Scaffold failed: ${errMsg}`] }
    }

    scaffold.app_name = resolvedAppName

    // Calculate total steps for progress tracking
    const totalSteps = scaffold.modules.length +
      scaffold.modules.reduce((sum, m) => sum + m.forms.length, 0)
    let completedSteps = 0

    logger.log(`Scaffold: ${scaffold.modules.length} modules, ${totalSteps - scaffold.modules.length} forms, ${scaffold.case_types?.length ?? 0} case types`)

    // Build case type property lookup
    const caseTypeProps = new Map<string, Array<{ name: string; label: string }>>()
    if (scaffold.case_types) {
      for (const ct of scaffold.case_types) {
        caseTypeProps.set(ct.name, ct.properties)
      }
    }

    // ── Tier 2 + 3: Modules and Forms (depth-first) ──────────────────

    const moduleContents: ModuleContent[] = []
    const formContents: FormContent[][] = []

    for (let mIdx = 0; mIdx < scaffold.modules.length; mIdx++) {
      const sm = scaffold.modules[mIdx]
      report('generating_module', `Building ${sm.name}...`, 0, totalSteps, completedSteps, sm.name)
      logger.logSection(`MODULE ${mIdx}: ${sm.name}`)

      // Get case type properties for this module
      const props = sm.case_type ? (caseTypeProps.get(sm.case_type) ?? []) : []
      const propsDesc = props.length > 0
        ? `\n\nCase type "${sm.case_type}" has these properties:\n${props.map(p => `- ${p.name}: ${p.label}`).join('\n')}`
        : ''

      // Tier 2: Module content
      const moduleMessage = `App: "${scaffold.app_name}" — ${scaffold.description}

Module: "${sm.name}"
Case type: ${sm.case_type ?? 'none (survey-only)'}
Purpose: ${sm.purpose}
Forms: ${sm.forms.map(f => `"${f.name}" (${f.type})`).join(', ')}${propsDesc}

Design the case list columns for this module.`

      let mc: ModuleContent
      try {
        mc = await this.claudeService.sendOneShotStructured(
          MODULE_PROMPT, moduleMessage, moduleContentSchema,
          () => {},
          { maxTokens: 4096 }
        )
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.log(`WARNING: Module content generation failed: ${errMsg}, using defaults`)
        mc = { case_list_columns: null }
      }

      moduleContents.push(mc)
      completedSteps++
      logger.log(`Module "${sm.name}": ${mc.case_list_columns?.length ?? 0} case list columns`)

      // Tier 3: Form content (depth-first within this module)
      const moduleForms: FormContent[] = []
      // Track registration form's case_properties for followup forms
      let registrationCaseProps: Record<string, string> | null = null

      for (let fIdx = 0; fIdx < sm.forms.length; fIdx++) {
        const sf = sm.forms[fIdx]
        const formStepName = `${sm.name} > ${sf.name}`
        report('generating_form', `Building ${formStepName}...`, 0, totalSteps, completedSteps, formStepName)
        logger.logSection(`FORM ${mIdx}.${fIdx}: ${sf.name}`)

        // Build context for the form
        let formMessage = `App: "${scaffold.app_name}" — ${scaffold.description}

Module: "${sm.name}" (${sm.purpose})
Case type: ${sm.case_type ?? 'none'}${propsDesc}

Module's case list columns: ${mc.case_list_columns ? JSON.stringify(mc.case_list_columns) : 'none'}

Form: "${sf.name}"
Type: ${sf.type}
Purpose: ${sf.purpose}

Sibling forms in this module: ${sm.forms.map(f => `"${f.name}" (${f.type})`).join(', ')}`

        // For followup forms, provide the registration form's case_properties
        if (sf.type === 'followup' && registrationCaseProps) {
          formMessage += `\n\nThe registration form's case_properties mapping (property -> question_id): ${JSON.stringify(registrationCaseProps)}\nUse case_preload to pre-fill questions with these case properties where appropriate.`
        }

        formMessage += '\n\nDesign the questions and case configuration for this form.'

        let fc: FormContent
        try {
          fc = await this.claudeService.sendOneShotStructured(
            FORM_PROMPT, formMessage, formContentSchema,
            () => {},
            { maxTokens: 32768 }
          )
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          logger.log(`FATAL: Form content generation failed: ${errMsg}`)
          report('failed', `Failed to generate "${sf.name}"`, 0)
          return { success: false, errors: [`Form "${sf.name}" failed: ${errMsg}`] }
        }

        // Track registration form's case_properties for subsequent followup forms
        if (sf.type === 'registration' && fc.case_properties) {
          registrationCaseProps = fc.case_properties
        }

        moduleForms.push(fc)
        completedSteps++
        logger.log(`Form "${sf.name}": ${fc.questions.length} questions`)
      }

      formContents.push(moduleForms)
    }

    // ── Assembly ──────────────────────────────────────────────────────

    logger.logSection('ASSEMBLY')
    const blueprint = assembleBlueprint(scaffold, moduleContents, formContents)
    logger.log(`Assembled blueprint: ${blueprint.modules.length} modules, ${blueprint.modules.reduce((s, m) => s + m.forms.length, 0)} forms`)

    // ── Validate + Fix Loop ──────────────────────────────────────────

    return await this.validateAndFix(blueprint, resolvedAppName, report, logger)
  }

  private async validateAndFix(
    blueprint: AppBlueprint,
    resolvedAppName: string,
    report: ReportFn,
    logger: BuildLogger,
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string; errors?: string[] }> {
    const recentErrorSignatures: string[] = []
    const MAX_STUCK_REPEATS = 3
    let attempt = 0

    while (true) {
      attempt++
      logger.logSection(`VALIDATION ATTEMPT ${attempt}`)
      report('validating', `Validating app definition (attempt ${attempt})...`, attempt)

      const errors = validateBlueprint(blueprint)
      logger.log(`Validation: ${errors.length} error(s)`)
      for (const err of errors) logger.log(`  ERROR: ${err}`)

      if (errors.length === 0) {
        logger.log('RESULT: SUCCESS — blueprint validated')
        report('expanding', 'Expanding to HQ format...', attempt)

        const hqJson = expandBlueprint(blueprint)

        const hqErrors = this.validateHqJson(hqJson)
        if (hqErrors.length > 0) {
          logger.log(`WARNING: HQ JSON validation found ${hqErrors.length} issue(s):`)
          for (const err of hqErrors) logger.log(`  HQ ERROR: ${err}`)
        }

        report('success', 'App generated and validated!', attempt)
        return await this.exportResults(hqJson, resolvedAppName, logger)
      }

      // Stuck detection
      const sig = errors.slice().sort().join('|||')
      recentErrorSignatures.push(sig)
      if (recentErrorSignatures.length > MAX_STUCK_REPEATS) recentErrorSignatures.shift()
      if (recentErrorSignatures.length === MAX_STUCK_REPEATS && recentErrorSignatures.every(s => s === sig)) {
        logger.log(`RESULT: FAILED — same errors repeated ${MAX_STUCK_REPEATS} times`)
        report('failed', `Unable to resolve: ${errors[0]?.substring(0, 200)}`, attempt)
        try {
          const hqJson = expandBlueprint(blueprint)
          const result = await this.exportResults(hqJson, resolvedAppName, logger)
          return { ...result, success: false, errors }
        } catch {
          return { success: false, errors }
        }
      }

      // Fix module-level errors programmatically
      for (const err of errors) {
        const match = err.match(/"([^"]+)" has case forms but no case_type/)
        if (match) {
          const modName = match[1]
          const mod = blueprint.modules.find(m => m.name === modName)
          if (mod && !mod.case_type) {
            mod.case_type = modName.toLowerCase().replace(/\s+/g, '_')
            logger.log(`Auto-fixed: set case_type for "${modName}" to "${mod.case_type}"`)
          }
        }
      }

      // Group errors by form and fix per-form
      logger.logSection(`FIX ATTEMPT ${attempt}`)
      const formErrors = this.groupErrorsByForm(errors, blueprint)

      for (const [formName, formErrs] of formErrors) {
        report('fixing', `Fixing ${formName} (attempt ${attempt})...`, attempt, undefined, undefined, formName)

        const [mIdx, fIdx] = this.findFormIndices(blueprint, formName)
        if (mIdx === -1) {
          logger.log(`WARNING: Could not find form "${formName}" to fix, skipping`)
          continue
        }

        const form = blueprint.modules[mIdx].forms[fIdx]
        const currentContent = {
          case_name_field: form.case_name_field ?? null,
          case_properties: form.case_properties ?? null,
          case_preload: form.case_preload ?? null,
          close_case: closeCaseToFlat(form.close_case),
          child_cases: form.child_cases?.map(c => ({
            case_type: c.case_type,
            case_name_field: c.case_name_field,
            case_properties: c.case_properties ?? null,
            relationship: c.relationship ?? null,
            repeat_context: c.repeat_context ?? null,
          })) ?? null,
          questions: flattenQuestions(form.questions),
        }

        const fixMessage = `## Validation Errors\n${formErrs.join('\n')}\n\n## Current Form Content\n${JSON.stringify(currentContent, null, 2)}`

        try {
          const fixed = await this.claudeService.sendOneShotStructured(
            FORM_FIXER_PROMPT, fixMessage, formContentSchema,
            () => {},
            { model: 'claude-haiku-4-5-20251001', maxTokens: 32768 }
          )

          // Reassemble the fixed form back into the blueprint
          blueprint.modules[mIdx].forms[fIdx] = this.reassembleForm(form.name, form.type, fixed)
          logger.log(`Fixed "${formName}": ${fixed.questions.length} questions`)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          logger.log(`WARNING: Fix failed for "${formName}": ${errMsg}`)
        }
      }
    }
  }

  /** Reassemble a FormContent back into a BlueprintForm */
  private reassembleForm(name: string, type: 'registration' | 'followup' | 'survey', fc: FormContent): BlueprintForm {
    const closeCase = fc.close_case == null ? undefined : {
      ...(fc.close_case.question != null && { question: fc.close_case.question }),
      ...(fc.close_case.answer != null && { answer: fc.close_case.answer }),
    }

    const childCases = fc.child_cases?.map(c => ({
      case_type: c.case_type,
      case_name_field: c.case_name_field,
      ...(c.case_properties != null && { case_properties: c.case_properties }),
      ...(c.relationship != null && { relationship: c.relationship }),
      ...(c.repeat_context != null && { repeat_context: c.repeat_context }),
    }))

    return {
      name,
      type,
      ...(fc.case_name_field != null && { case_name_field: fc.case_name_field }),
      ...(fc.case_properties != null && { case_properties: fc.case_properties }),
      ...(fc.case_preload != null && { case_preload: fc.case_preload }),
      ...(closeCase !== undefined && { close_case: closeCase }),
      ...(childCases !== undefined && { child_cases: childCases }),
      questions: unflattenQuestions(fc.questions),
    }
  }

  /** Group validation errors by form name */
  private groupErrorsByForm(errors: string[], blueprint: AppBlueprint): Map<string, string[]> {
    const grouped = new Map<string, string[]>()
    for (const err of errors) {
      const match = err.match(/^"([^"]+)"/)
      if (match) {
        const name = match[1]
        const isForm = blueprint.modules.some(m => m.forms.some(f => f.name === name))
        if (isForm) {
          if (!grouped.has(name)) grouped.set(name, [])
          grouped.get(name)!.push(err)
          continue
        }
      }
      // Module-level or unrecognized errors are handled programmatically above
    }
    return grouped
  }

  /** Find module and form indices by form name */
  private findFormIndices(blueprint: AppBlueprint, formName: string): [number, number] {
    for (let mIdx = 0; mIdx < blueprint.modules.length; mIdx++) {
      for (let fIdx = 0; fIdx < blueprint.modules[mIdx].forms.length; fIdx++) {
        if (blueprint.modules[mIdx].forms[fIdx].name === formName) {
          return [mIdx, fIdx]
        }
      }
    }
    return [-1, -1]
  }

  /** Validate HQ JSON structure after expansion. Safety net for expander bugs. */
  private validateHqJson(json: any): string[] {
    const errors: string[] = []

    if (json.doc_type !== 'Application') {
      errors.push('Missing or invalid doc_type (expected "Application")')
    }

    const modules = json.modules || []
    const attachments = json._attachments || {}

    for (let mIdx = 0; mIdx < modules.length; mIdx++) {
      const mod = modules[mIdx]
      const modName = mod.name?.en || `Module ${mIdx}`
      const forms = mod.forms || []

      const usesCases = forms.some((f: any) => {
        const a = f.actions || {}
        return (a.open_case?.condition?.type === 'always') ||
               (a.update_case?.condition?.type === 'always')
      })

      if (usesCases && !mod.case_type) {
        errors.push(`${modName} uses cases but doesn't have a case_type defined`)
      }

      for (let fIdx = 0; fIdx < forms.length; fIdx++) {
        const form = forms[fIdx]
        const formName = form.name?.en || `Form ${fIdx}`

        if (!form.unique_id) {
          errors.push(`${formName} in ${modName} has no unique_id`)
        } else {
          const attachKey = `${form.unique_id}.xml`
          if (!attachments[attachKey]) {
            errors.push(`${formName} in ${modName}: no _attachment for unique_id "${form.unique_id}"`)
          } else {
            const xform = attachments[attachKey]

            if (!/<(input|select1?|group|repeat|trigger|upload)\s/.test(xform)) {
              errors.push(`"${formName}" has no question elements in its XForm`)
            }

            if (!/<itext>/.test(xform)) {
              errors.push(`${formName} XForm is missing <itext> block`)
            }

            if (/<label>[^<]+<\/label>/.test(xform)) {
              errors.push(`${formName} XForm has inline labels — must use jr:itext() references`)
            }
          }
        }

        if (!form.xmlns) {
          errors.push(`${formName} in ${modName} has no xmlns`)
        }
      }
    }

    return errors
  }

  /** Export HQ JSON + compile CCZ. */
  private async exportResults(
    hqJson: any,
    appName: string,
    logger: BuildLogger
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string }> {
    // Export HQ JSON
    const hqJsonPath = this.appExporter.exportForHQSync(appName, hqJson)
    logger.log(`HQ JSON exported: ${hqJsonPath}`)

    // Compile CCZ from HQ JSON
    let exportPath: string | undefined
    try {
      const cczPath = await this.cczCompiler.compile(hqJson, appName)
      exportPath = await this.appExporter.exportCcz(cczPath, appName)
      logger.log(`CCZ exported: ${exportPath}`)
    } catch (err: any) {
      logger.log(`WARNING: CCZ compilation failed: ${err.message}`)
    }

    return {
      success: true,
      appDefinition: { name: appName, files: {} },
      cczPath: exportPath,
      exportPath,
      hqJsonPath
    }
  }

  /**
   * Best-effort app name extraction from the first user message.
   * Strips common request prefixes ("Build me a...", "Create a...") and
   * takes the first 5 words as the app name.
   */
  private inferAppName(context: string): string {
    const firstLine = context.split('\n').find(l => l.startsWith('User:'))
    if (firstLine) {
      let desc = firstLine.replace('User:', '').trim()
      // Strip common request prefixes to get to the actual app description
      desc = desc.replace(
        /^(I need|I want|Create|Build|Make|Generate|Design|Develop|Help me build|Help me create|Can you build|Can you create|Please create|Please build)\s+(a|an|the|me a|me an)?\s*/i,
        ''
      )
      const words = desc.split(/\s+/).slice(0, 5).join(' ')
      if (words.length > 3) {
        return words.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'CommCare App'
      }
    }
    return 'CommCare App'
  }
}
