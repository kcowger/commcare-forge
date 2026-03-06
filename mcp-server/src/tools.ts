/**
 * MCP tool handlers for validating and building CommCare apps.
 *
 * These are the actual implementations behind the MCP tools registered in index.ts.
 * They share the same pipeline as the Electron app — validate blueprint, expand
 * to HQ format, auto-fix, validate the expanded XML, compile to .ccz.
 *
 * `getToolDefinitions()` returns plain JSON Schema tool definitions for non-MCP
 * consumers (e.g. raw Anthropic API tool definitions). The MCP server itself uses
 * the Zod schema directly via `server.tool()`.
 */
import { validateBlueprint, expandBlueprint } from '../../backend/src/services/hqJsonExpander'
import { AutoFixer } from '../../backend/src/services/autoFixer'
import { HqValidator } from '../../backend/src/services/hqValidator'
import { CczCompiler } from '../../backend/src/services/cczCompiler'
import { getAppBlueprintJsonSchema } from '../../backend/src/schemas/blueprint'
import { mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { resolve } from 'path'
import type { AppBlueprint } from '../../backend/src/schemas/blueprint'

interface ValidateInput {
  blueprint: AppBlueprint
}

interface ValidateResult {
  valid: boolean
  errors?: string[]
}

interface BuildInput {
  blueprint: AppBlueprint
  output_dir?: string
}

interface BuildResult {
  success: boolean
  ccz_path?: string
  hq_json_path?: string
  errors?: string[]
}

export async function handleValidate(input: ValidateInput): Promise<ValidateResult> {
  const errors = validateBlueprint(input.blueprint)
  if (errors.length === 0) {
    return { valid: true }
  }
  return { valid: false, errors }
}

/**
 * Full build pipeline: validate → expand → auto-fix → validate HQ XML → compile .ccz.
 * Writes both the HQ JSON and .ccz to output_dir and returns their paths.
 */
export async function handleBuild(input: BuildInput): Promise<BuildResult> {
  try {
    // 1. Validate first
    const validationErrors = validateBlueprint(input.blueprint)
    if (validationErrors.length > 0) {
      return { success: false, errors: validationErrors }
    }

    // 2. Expand to HQ JSON
    const hqJson = expandBlueprint(input.blueprint)

    // 3. Auto-fix the expanded files
    const autoFixer = new AutoFixer()
    const files: Record<string, string> = {}
    for (const [key, content] of Object.entries(hqJson._attachments || {})) {
      files[key] = content as string
    }
    const { files: fixedFiles } = autoFixer.fix(files)
    for (const [key, content] of Object.entries(fixedFiles)) {
      hqJson._attachments[key] = content
    }

    // 4. Validate the expanded HQ JSON
    const hqValidator = new HqValidator()
    const hqValidation = hqValidator.validate(fixedFiles)
    if (!hqValidation.success) {
      return { success: false, errors: hqValidation.errors }
    }

    // 5. Compile to CCZ
    const compiler = new CczCompiler()
    const appName = input.blueprint.app_name
    const cczTempPath = await compiler.compile(hqJson, appName)

    // 6. Write output files
    const outputDir = resolve(process.cwd(), input.output_dir || 'commcare-output')
    mkdirSync(outputDir, { recursive: true })

    const sanitizedName = appName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
    const hqJsonPath = resolve(outputDir, `${sanitizedName}.hq.json`)
    const cczPath = resolve(outputDir, `${sanitizedName}.ccz`)

    writeFileSync(hqJsonPath, JSON.stringify(hqJson, null, 2), 'utf-8')
    copyFileSync(cczTempPath, cczPath)

    return {
      success: true,
      ccz_path: cczPath,
      hq_json_path: hqJsonPath
    }
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)]
    }
  }
}

/**
 * Returns tool definitions as plain JSON Schema objects.
 * Used by non-MCP consumers that need raw tool definitions (e.g. tests,
 * or if someone wanted to register these tools with the Anthropic API directly).
 * The MCP server itself uses the Zod schema via server.tool() in index.ts.
 */
export function getToolDefinitions() {
  const blueprintJsonSchema = getAppBlueprintJsonSchema()

  return [
    {
      name: 'validate_commcare_app',
      description: 'Validates a CommCare app blueprint JSON definition against CommCare rules. Call this before build_commcare_app to catch errors early. Returns { valid: true } or { valid: false, errors: [...] }.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          blueprint: blueprintJsonSchema
        },
        required: ['blueprint']
      }
    },
    {
      name: 'build_commcare_app',
      description: 'Builds a CommCare app from an app blueprint. Expands to full HQ format, auto-fixes common issues, validates, compiles to .ccz, and writes files to output_dir. Call validate_commcare_app first.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          blueprint: blueprintJsonSchema,
          output_dir: {
            type: 'string',
            description: 'Output directory path. Defaults to ./commcare-output/'
          }
        },
        required: ['blueprint']
      }
    }
  ]
}
