# CommCare Forge — Agent Guidelines

## What This Project Does

CommCare Forge is a desktop app (Electron) that generates CommCare mobile applications from natural language descriptions or uploaded documents. It uses Claude (Anthropic API) to power a conversational interface where users describe their app, then generates, validates, and exports a complete CommCare application ready for import into CommCare HQ.

## Architecture

- **Desktop**: Electron (main + renderer process)
- **Frontend**: React + TypeScript + Tailwind CSS (renderer process)
- **Backend**: Node.js + TypeScript (main process)
- **AI**: Anthropic Claude API (Sonnet for generation, Haiku for fix loop)
- **Import**: Guided flow via clipboard + browser to HQ's import page

### Three-Tiered Generation Pipeline

1. User describes app via chat (with optional file uploads: PDF, DOCX, XLSX, images)
2. **Tier 1 — Scaffold**: Claude plans the app structure + data model (case types, modules, forms)
3. **Tier 2 — Module content**: For each module, Claude designs case list columns
4. **Tier 3 — Form content**: For each form, Claude designs questions + case configuration
5. **Assembly**: Tiers are combined into a full `AppBlueprint` (nested question format)
6. `validateBlueprint()` checks semantic rules; if errors, Claude (Haiku) fixes per-form via structured output
7. Fix loop repeats until validation passes or stuck detection triggers
8. `expandBlueprint()` converts to full HQ-compatible JSON (XForms, suite.xml, etc.)

Each tier has its own slim structured output schema, avoiding Anthropic's schema compilation timeout. Data flows top-down: the scaffold's case types define what modules and forms build against.

## Key Files

| File | Purpose |
|------|---------|
| `electron/main.ts` | Electron main process |
| `electron/preload.ts` | IPC bridge (contextBridge) |
| `electron/ipc-handlers.ts` | All IPC handlers |
| `backend/src/schemas/blueprint.ts` | Zod schemas for all tiers (scaffold, module, form) + assembled AppBlueprint + assembly utilities |
| `backend/src/services/appGenerator.ts` | Three-tiered generation orchestrator: scaffold → modules → forms → assemble → validate → fix → expand |
| `backend/src/services/hqJsonExpander.ts` | AppBlueprint → full HQ JSON expansion + semantic validation |
| `backend/src/services/claude.ts` | Anthropic API client (streaming, file attachments, PDF splitting, structured output) |
| `backend/src/services/appExporter.ts` | Exports HQ JSON and CCZ files |
| `backend/src/services/cczCompiler.ts` | Compiles HQ JSON into .ccz (ZIP) |
| `backend/src/services/hqValidator.ts` | Validates HQ JSON against known HQ rules |
| `backend/src/services/buildLogger.ts` | Logs build attempts for debugging |
| `backend/src/prompts/system.ts` | System prompt for conversation phase |
| `backend/src/prompts/scaffoldPrompt.ts` | System prompt for Tier 1 — app structure planning |
| `backend/src/prompts/modulePrompt.ts` | System prompt for Tier 2 — module/case list design |
| `backend/src/prompts/formPrompt.ts` | System prompt for Tier 3 — form questions + case config |
| `backend/src/prompts/formFixerPrompt.ts` | System prompt for per-form fixing (Haiku) |
| `frontend/src/components/ChatInterface.tsx` | Main chat UI |
| `frontend/src/hooks/useChat.ts` | Chat state management |

## Development

```bash
npm run dev     # Start in dev mode with hot reload
npm run build   # Build for production
npm run dist    # Create platform installers
```

## Key Patterns

- **App Blueprint format**: Claude outputs a small JSON with just app structure (modules, forms, questions, case properties). The expander adds all XForm XML, suite.xml, binds, itext, etc. This is critical for reliability.
- **Three-tiered generation**: The pipeline splits into scaffold (app structure), module content (case lists), and form content (questions) — each with its own slim structured output schema to avoid compilation timeouts.
- **Structured output**: All tiers use Anthropic's `output_config` API with `zodOutputFormat()` to constrain Claude's response to valid JSON matching the Zod schema. No text parsing or JSON repair needed.
- **Zod schemas**: The tier-specific schemas + assembled AppBlueprint are defined in `backend/src/schemas/blueprint.ts`. TypeScript types are derived via `z.infer`. Schema `.describe()` strings serve as LLM guidance.
- **Reserved case properties**: HQ rejects a specific set of reserved words in `case_properties` keys AND `case_preload` values. The expander silently filters them; the validator catches them for the fix loop.
- **PDF splitting**: Claude API has a 100-page PDF limit. Large PDFs are automatically split into chunks using pdf-lib.
- **API key security**: Stored in electron-store with encryption, only accessed in the main process, never sent to the renderer.

## CommCare Concepts

- **Module**: A container for forms, tied to a case type
- **Form**: An XForm (XML) that collects data. Types: registration (creates a case), followup (updates a case), survey (no case)
- **Case**: A longitudinal record (e.g., a patient). Has properties that forms read/write.
- **HQ JSON**: The import format for CommCare HQ. Contains modules, forms, XForm XML as `_attachments`, suite.xml, profile.xml, and app_strings.
- **CCZ**: A ZIP file used by CommCare mobile. Different from HQ JSON.
