/**
 * MCP tool handlers for validating and building CommCare apps.
 *
 * These are the actual implementations behind the MCP tools registered in index.ts.
 * They share the same pipeline as the Electron app — validate compact JSON, expand
 * to HQ format, auto-fix, validate the expanded XML, compile to .ccz.
 *
 * `getToolDefinitions()` returns plain JSON Schema tool definitions for non-MCP
 * consumers (e.g. raw Anthropic API tool definitions). The MCP server itself uses
 * the Zod schema directly via `server.tool()`.
 */
import { validateCompact, expandToHqJson } from '../../backend/src/services/hqJsonExpander'
import { AutoFixer } from '../../backend/src/services/autoFixer'
import { HqValidator } from '../../backend/src/services/hqValidator'
import { CczCompiler } from '../../backend/src/services/cczCompiler'
import { getCompactAppJsonSchema } from '../../backend/src/schemas/compactApp'
import { mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { resolve } from 'path'
import type { CompactApp } from '../../backend/src/schemas/compactApp'

interface ValidateInput {
  compact_json: CompactApp
}

interface ValidateResult {
  valid: boolean
  errors?: string[]
}

interface BuildInput {
  compact_json: CompactApp
  output_dir?: string
}

interface BuildResult {
  success: boolean
  ccz_path?: string
  hq_json_path?: string
  errors?: string[]
}

export async function handleValidate(input: ValidateInput): Promise<ValidateResult> {
  const errors = validateCompact(input.compact_json)
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
    const validationErrors = validateCompact(input.compact_json)
    if (validationErrors.length > 0) {
      return { success: false, errors: validationErrors }
    }

    // 2. Expand to HQ JSON
    const hqJson = expandToHqJson(input.compact_json)

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
    const appName = input.compact_json.app_name
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
  const compactJsonSchema = getCompactAppJsonSchema()

  return [
    {
      name: 'validate_commcare_app',
      description: 'Validates a CommCare compact JSON app definition against CommCare rules. Call this before build_commcare_app to catch errors early. Returns { valid: true } or { valid: false, errors: [...] }.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          compact_json: compactJsonSchema
        },
        required: ['compact_json']
      }
    },
    {
      name: 'build_commcare_app',
      description: 'Builds a CommCare app from compact JSON. Expands to full HQ format, auto-fixes common issues, validates, compiles to .ccz, and writes files to output_dir. Call validate_commcare_app first.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          compact_json: compactJsonSchema,
          output_dir: {
            type: 'string',
            description: 'Output directory path. Defaults to ./commcare-output/'
          }
        },
        required: ['compact_json']
      }
    }
  ]
}
