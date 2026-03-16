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

const languageSchema = z.object({
  code: z.string().describe('Language code (e.g. "en", "fr", "sw")'),
  label: z.string().describe('Language display name (e.g. "English", "French")'),
  default: z.boolean().optional().describe('True if this is the default language'),
})

const selectOptionSchema = z.object({
  value: z.string().describe('Option value (stored in data)'),
  label: z.string().describe('Option label (shown to user)'),
  labels_by_language: z.record(z.string(), z.string()).optional().describe(
    'Translations: language code -> label text. Only needed for multi-language apps.'
  ),
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
  labels_by_language: z.record(z.string(), z.string()).optional().describe(
    'Translations for label: language code -> label text. Only for multi-language apps.'
  ),
  hints_by_language: z.record(z.string(), z.string()).optional().describe(
    'Translations for hint: language code -> hint text. Only for multi-language apps.'
  ),
  options: z.array(selectOptionSchema).optional().describe(
    'Required for select1/select questions. At least 2 options.'
  ),
  lookup_table: z.object({
    tag: z.string().describe('Tag of the lookup table to use (must match a tag in app-level lookup_tables)'),
    value_field: z.string().describe('Field name in the lookup table whose value is stored when selected'),
    label_field: z.string().describe('Field name in the lookup table whose value is shown to the user'),
  }).optional().describe(
    'Use a lookup table instead of static options for select1/select questions. When set, options array is ignored.'
  ),
  // Recursive: group/repeat questions contain nested children of the same shape.
  get children() {
    return z.array(compactQuestionSchema).optional().describe(
      'Nested questions for group/repeat types'
    )
  },
}).refine(
  q => (q.type !== 'select1' && q.type !== 'select') || (q.options && q.options.length >= 2),
  { message: 'select1/select questions must have at least 2 options' }
).refine(
  q => q.type !== 'hidden' || q.calculate,
  { message: 'hidden questions should have a calculate expression' }
).refine(
  q => (q.type !== 'group' && q.type !== 'repeat') || (q.children && q.children.length > 0),
  { message: 'group/repeat questions must have at least one child question' }
)

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
    'Followup forms only: map of question id -> case property name. Pre-fills form questions with existing case data. To load the case name use "name" as the value (NOT "case_name"). If user should edit and save back, include same field in BOTH case_preload AND case_properties.'
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
  form_links: z.array(z.object({
    form_name: z.string().describe('Name of the target form to navigate to after submission'),
    label: z.string().optional().describe('Button label for the link (defaults to target form name)'),
  })).optional().describe(
    'Navigate to another form after this form is submitted. post_form_workflow should be "form" when using this.'
  ),
  post_form_workflow: z.enum(['default', 'form', 'parent_module']).optional().describe(
    'What happens after form submission. "default" returns to form list. "form" follows form_links. "parent_module" returns to parent menu.'
  ),
  questions: z.array(compactQuestionSchema).min(1, 'Every form must have at least one question').describe(
    'Array of questions in the form. Every form must have at least one question.'
  ),
}).refine(
  f => f.type !== 'registration' || f.case_name_field,
  { message: 'Registration forms must have case_name_field' }
).refine(
  f => !f.close_case || f.type === 'followup',
  { message: 'close_case is only valid on followup forms' }
).describe('A form within a module')

const caseListColumnSchema = z.object({
  field: z.string().describe('Case property name'),
  header: z.string().describe('Column header display text')
})

const compactModuleSchema = z.object({
  name: z.string().describe('Display name for the module/menu'),
  case_type: z.string().regex(/^[\w-]+$/, 'case_type must only contain letters, digits, underscores, and hyphens').optional().describe(
    'Required if any form is "registration" or "followup". Use short snake_case (e.g. "patient", "household_visit"). Only letters, digits, underscores, hyphens.'
  ),
  forms: z.array(compactFormSchema).min(1, 'Module must have at least one form').describe('Array of forms in this module'),
  case_list_columns: z.array(caseListColumnSchema).optional().describe(
    'Columns shown in the case list. Each has "field" (case property) and "header" (display text). Do NOT include "name" — it is shown automatically. Do NOT use reserved property names.'
  ),
}).describe('A module (menu) in the app')

const lookupTableFieldSchema = z.object({
  field_name: z.string().describe('Field/column name in the lookup table'),
  label: z.string().describe('Display label for this field'),
})

const lookupTableSchema = z.object({
  tag: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'tag must be lowercase alphanumeric with underscores/hyphens').describe(
    'Unique identifier for this lookup table (e.g. "facilities", "districts"). Used to reference from questions.'
  ),
  fields: z.array(lookupTableFieldSchema).min(1, 'Lookup table must have at least one field').describe(
    'Column definitions for the table.'
  ),
  data: z.array(z.record(z.string(), z.string())).min(1, 'Lookup table must have at least one row').describe(
    'Array of data rows. Each row is a map of field_name -> value.'
  ),
}).describe('A lookup table (fixture) for dynamic select options')

/** Top-level schema for a complete CommCare app in compact JSON format. */
export const compactAppSchema = z.object({
  app_name: z.string().describe('Name of the CommCare application'),
  languages: z.array(languageSchema).optional().describe(
    'Languages supported by this app. If omitted, defaults to English only. The default language is used as the primary language.'
  ),
  lookup_tables: z.array(lookupTableSchema).optional().describe(
    'Lookup tables (fixtures) provide dynamic option lists for select questions. Define tables here and reference them from questions via lookup_table.'
  ),
  modules: z.array(compactModuleSchema).min(1, 'App must have at least one module').describe(
    'Array of modules. Each module is a menu containing forms.'
  ),
}).describe('A CommCare application definition in compact JSON format')

// Derive TypeScript types from the Zod schema — single source of truth.
export type CompactApp = z.infer<typeof compactAppSchema>
export type CompactModule = z.infer<typeof compactModuleSchema>
export type CompactForm = z.infer<typeof compactFormSchema>
export type CompactQuestion = z.infer<typeof compactQuestionSchema>
export type CompactChildCase = z.infer<typeof compactChildCaseSchema>
export type CompactLookupTable = z.infer<typeof lookupTableSchema>

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
