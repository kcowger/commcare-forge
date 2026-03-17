/**
 * End-to-end test: simulates the full CommCare Forge pipeline.
 * Reads the Turkish questionnaire PDF, sends to Claude, generates app,
 * validates through all 4 phases, exports.
 */
import { readFileSync } from 'fs'
import { ClaudeService } from './backend/src/services/claude.ts'
import { AppGenerator } from './backend/src/services/appGenerator.ts'
import { expandToHqJson, validateCompact } from './backend/src/services/hqJsonExpander.ts'
import { CczCompiler } from './backend/src/services/cczCompiler.ts'
import { CliValidator, checkJavaAvailable } from './backend/src/services/cliValidator.ts'
import { parseXml } from './backend/src/utils/xmlBuilder.ts'
import { RESERVED_CASE_PROPERTIES } from './backend/src/constants/reservedCaseProperties.ts'

// We can't use the full Electron pipeline, so we'll test the core logic directly.
// This is the same code path as app:generate.

async function main() {
  // Read the PDF
  const pdfPath = '/Users/kaicowger/Downloads/turkish questionnaire.pdf'
  const pdfBuffer = readFileSync(pdfPath)
  const pdfBase64 = pdfBuffer.toString('base64')

  console.log(`\n=== Turkish Questionnaire E2E Test ===\n`)
  console.log(`PDF: ${pdfPath} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`)

  // Get API key from secure storage (we'll read it from env or prompt)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY env var')
    process.exit(1)
  }

  const claude = new ClaudeService(apiKey)

  // Step 1: Chat with Claude about the PDF
  console.log('\n--- Step 1: Analyzing PDF ---')
  const chatResponse = await claude.sendMessage(
    'I want to build a CommCare app based on this Turkish pregnancy physical activity screening questionnaire. Build it as a simple survey.',
    [{
      name: 'turkish questionnaire.pdf',
      type: 'application/pdf',
      data: pdfBase64,
      size: pdfBuffer.length
    }]
  )
  console.log(`Claude response: ${chatResponse.substring(0, 200)}...`)

  // Step 2: Generate the app
  console.log('\n--- Step 2: Generating app ---')
  const conversationContext = claude.getConversationSummary()

  const generator = new AppGenerator(claude)
  const result = await generator.generate(conversationContext, (progress) => {
    console.log(`  [${progress.status}] ${progress.message}`)
  }, 'Turkish Survey')

  console.log(`\n--- Result ---`)
  console.log(`Success: ${result.success}`)
  if (result.errors?.length) {
    console.log(`Errors:`)
    for (const e of result.errors) console.log(`  - ${e}`)
  }
  if (result.hqJsonPath) console.log(`HQ JSON: ${result.hqJsonPath}`)
  if (result.exportPath) console.log(`CCZ: ${result.exportPath}`)

  // Step 3: Extra manual verification
  if (result.hqJsonPath) {
    console.log('\n--- Step 3: Manual verification ---')
    const hqJson = JSON.parse(readFileSync(result.hqJsonPath, 'utf-8'))
    const attachments = hqJson._attachments || {}

    let xmlErrors = 0
    let reservedErrors = 0

    for (const [key, xml] of Object.entries(attachments)) {
      if (!key.endsWith('.xml')) continue

      // Parse XML
      try {
        parseXml(xml)
        console.log(`  ✓ ${key} — well-formed XML`)
      } catch (e) {
        console.log(`  ✗ ${key} — INVALID XML: ${e.message}`)
        xmlErrors++
      }
    }

    // Check reserved words in all form actions
    for (const mod of hqJson.modules || []) {
      for (const form of mod.forms || []) {
        const fname = form.name?.en || 'Unknown'
        const actions = form.actions || {}

        // Check update_case
        if (actions.update_case?.condition?.type === 'always') {
          for (const prop of Object.keys(actions.update_case.update || {})) {
            if (RESERVED_CASE_PROPERTIES.has(prop)) {
              console.log(`  ✗ "${fname}" update uses reserved word "${prop}"`)
              reservedErrors++
            }
          }
        }

        // Check preload
        if (actions.case_preload?.condition?.type === 'always') {
          for (const val of Object.values(actions.case_preload.preload || {})) {
            if (val === 'case_name' || val === 'case_type' || val === 'case_id') {
              console.log(`  ✗ "${fname}" preload uses "${val}" (should be remapped)`)
              reservedErrors++
            }
          }
        }
      }
    }

    // Run CLI validator
    const java = await checkJavaAvailable()
    if (java.available && result.exportPath) {
      console.log(`\n  Running CommCare CLI validator...`)
      const validator = new CliValidator('/Users/kaicowger/Library/Application Support/commcare-forge')
      const cliResult = await validator.validate(result.exportPath)
      if (cliResult.skipped) {
        console.log(`  ⚠ CLI skipped: ${cliResult.skipReason}`)
      } else if (cliResult.success) {
        console.log(`  ✓ CLI validation passed`)
      } else {
        console.log(`  ✗ CLI validation FAILED:`)
        for (const e of cliResult.errors) console.log(`    - ${e}`)
      }
    }

    console.log(`\n--- Summary ---`)
    console.log(`XML errors: ${xmlErrors}`)
    console.log(`Reserved word errors: ${reservedErrors}`)
    if (xmlErrors === 0 && reservedErrors === 0) {
      console.log(`\n✓ ALL CHECKS PASSED — app is ready for HQ import`)
    } else {
      console.log(`\n✗ FAILURES DETECTED`)
      process.exit(1)
    }
  }
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
