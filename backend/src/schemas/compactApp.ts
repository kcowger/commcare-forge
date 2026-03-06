/**
 * Shared Zod schema for the compact JSON app format.
 *
 * This is the single source of truth for the structure LLMs must produce when
 * generating CommCare apps. It serves two consumers:
 *
 * 1. **MCP server** — the Zod schema is passed directly to `server.tool()` so
 *    that MCP-connected LLMs see full field-level descriptions in the tool schema.
 *
 * 2. **Electron app backend** — `getCompactAppJsonSchema()` converts this to a
 *    plain JSON Schema object, which is passed as an Anthropic tool definition
 *    via `sendOneShotWithTool()`. This forces Claude to return structured output
 *    instead of freeform text with embedded JSON.
 *
 * The `.describe()` strings on each field double as LLM guidance — they explain
 * what each field does, what values are valid, and common pitfalls to avoid.
 * The behavioral rules (reserved words, type selection, case lifecycle) live in
 * the prompt files, not here, since they're too long for schema descriptions.
 *
 * TypeScript types (CompactApp, CompactModule, etc.) are derived from this
 * schema via `z.infer` and exported at the bottom of this file.
 */
import { z } from 'zod'

// All supported question types in CommCare's compact format.
// Maps 1:1 with XForm control types that the expander generates.
const QUESTION_TYPES = [
  'text', 'int', 'date', 'select1', 'select', 'geopoint', 'image',
  'barcode', 'decimal', 'long', 'trigger', 'phone', 'time', 'datetime',
  'audio', 'video', 'signature', 'hidden', 'secret', 'group', 'repeat'
] as const

const selectOptionSchema = z.object({
  value: z.string().describe('Option value (stored in data)'),
  label: z.string().describe('Option label (shown to user)')
})

/**
 * Question schema — recursive via the `children` getter.
 *
 * Zod v4 supports recursive schemas through getter properties. The getter
 * defers evaluation so `compactQuestionSchema` can reference itself for
 * nested group/repeat children without circular definition errors.
 *
 * When converted to JSON Schema via `z.toJSONSchema()`, this produces a
 * `$defs`/`$ref` pair that Anthropic's API handles natively.
 */
const compactQuestionSchema = z.object({
  id: z.string().describe(
    'Unique identifier within the form. Use snake_case starting with a letter (e.g. "patient_name", "visit_date").'
  ),
  type: z.enum(QUESTION_TYPES).describe(
    'Question type. Use the most specific type: "phone" for phone numbers (not "text"), "date" for dates, "int" for counts, "decimal" for measurements, "select1" for single-choice, "select" for multi-choice, "hidden" with "calculate" for computed values, "group"/"repeat" for nested questions.'
  ),
  label: z.string().describe(
    'Human-readable question text. Write clear, natural labels like "Patient Name", "Date of Birth". Never put technical notes in labels.'
  ),
  hint: z.string().optional().describe('Help text shown below the question'),
  required: z.boolean().optional().describe('True if the question must be answered'),
  readonly: z.boolean().optional().describe('True if visible but not editable (use for display-only preloaded values)'),
  constraint: z.string().optional().describe('XPath constraint expression, e.g. ". > 0 and . < 150"'),
  constraint_msg: z.string().optional().describe('Error message when constraint fails'),
  relevant: z.string().optional().describe('XPath expression — question only shows when true, e.g. "/data/age > 18"'),
  calculate: z.string().optional().describe('XPath expression for auto-computed value (use with type "hidden")'),
  options: z.array(selectOptionSchema).optional().describe(
    'Required for select1/select questions. At least 2 options.'
  ),
  // Recursive: group/repeat questions contain nested children of the same shape.
  get children() {
    return z.array(compactQuestionSchema).optional().describe(
      'Nested questions for group/repeat types'
    )
  },
})

/** Child/sub-case created by a form and linked to the parent case. */
const compactChildCaseSchema = z.object({
  case_type: z.string().describe(
    'The child case type in snake_case (e.g. "referral", "pregnancy", "household_member"). Only letters, digits, underscores, hyphens.'
  ),
  case_name_field: z.string().describe(
    'Question id whose value becomes the child case name'
  ),
  case_properties: z.record(z.string(), z.string()).optional().describe(
    'Map of child case property name -> question id. Do NOT use reserved property names as keys.'
  ),
  relationship: z.enum(['child', 'extension']).optional().describe(
    '"child" (default) or "extension". Use "extension" when the child should prevent the parent from being closed.'
  ),
  repeat_context: z.string().optional().describe(
    'Question id of a repeat group — creates one child case per repeat entry'
  ),
}).describe('Creates a child/sub-case linked to the parent case')

const compactFormSchema = z.object({
  name: z.string().describe('Display name for the form'),
  type: z.enum(['registration', 'followup', 'survey']).describe(
    '"registration" creates a new case (MUST have case_name_field). "followup" updates an existing case (should have case_preload). "survey" has no case management.'
  ),
  case_name_field: z.string().optional().describe(
    'Registration forms only: question id whose value becomes the case name. Required for registration forms.'
  ),
  // Note the asymmetric key/value directions between case_properties and case_preload —
  // this is a common source of LLM errors, so the descriptions are explicit about it.
  case_properties: z.record(z.string(), z.string()).optional().describe(
    'Map of case property name -> question id. These question values get saved to the case. Do NOT include case_name_field here. NEVER use reserved property names (case_id, case_name, case_type, status, name, date, type, etc.) as keys. NEVER map media questions (image, audio, video, signature) to case properties.'
  ),
  case_preload: z.record(z.string(), z.string()).optional().describe(
    'Followup forms only: map of question id -> case property name. Pre-fills form questions with existing case data. To load case name use "case_name" as the value. If user should edit and save back, include same field in BOTH case_preload AND case_properties.'
  ),
  close_case: z.union([
    z.boolean(),
    z.object({
      question: z.string().describe('Question id to check'),
      answer: z.string().describe('Value that triggers case closure')
    })
  ]).optional().describe(
    'Followup forms only. true = always close the case. {question, answer} = close only when that answer is selected. Omit if form should not close the case.'
  ),
  child_cases: z.array(compactChildCaseSchema).optional().describe(
    'Create child/sub-cases linked to the current case. Valid on both registration and followup forms.'
  ),
  questions: z.array(compactQuestionSchema).describe(
    'Array of questions in the form. Every form must have at least one question.'
  ),
}).describe('A form within a module')

const caseListColumnSchema = z.object({
  field: z.string().describe('Case property name'),
  header: z.string().describe('Column header display text')
})

const compactModuleSchema = z.object({
  name: z.string().describe('Display name for the module/menu'),
  case_type: z.string().optional().describe(
    'Required if any form is "registration" or "followup". Use short snake_case (e.g. "patient", "household_visit"). Only letters, digits, underscores, hyphens.'
  ),
  forms: z.array(compactFormSchema).describe('Array of forms in this module'),
  case_list_columns: z.array(caseListColumnSchema).optional().describe(
    'Columns shown in the case list. Each has "field" (case property) and "header" (display text). Do NOT include "name" — it is shown automatically. Do NOT use reserved property names.'
  ),
}).describe('A module (menu) in the app')

/** Top-level schema for a complete CommCare app in compact JSON format. */
export const compactAppSchema = z.object({
  app_name: z.string().describe('Name of the CommCare application'),
  modules: z.array(compactModuleSchema).describe(
    'Array of modules. Each module is a menu containing forms.'
  ),
}).describe('A CommCare application definition in compact JSON format')

// Derive TypeScript types from the Zod schema — single source of truth.
export type CompactApp = z.infer<typeof compactAppSchema>
export type CompactModule = z.infer<typeof compactModuleSchema>
export type CompactForm = z.infer<typeof compactFormSchema>
export type CompactQuestion = z.infer<typeof compactQuestionSchema>
export type CompactChildCase = z.infer<typeof compactChildCaseSchema>

/**
 * Converts the Zod schema to a plain JSON Schema object.
 *
 * Used for:
 * - Anthropic tool definitions (input_schema) in the Electron app's ClaudeService
 * - MCP `getToolDefinitions()` for non-Zod consumers
 *
 * Zod v4 handles the recursive CompactQuestion -> children -> CompactQuestion
 * structure by emitting `$defs` and `$ref` in the output, which Anthropic's
 * API supports natively.
 */
export function getCompactAppJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(compactAppSchema)
}
