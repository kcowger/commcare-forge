# CommCare Forge — Agent Guidelines

## What This Project Does
CommCare Forge is a desktop app (Electron) that generates CommCare mobile applications
from natural language descriptions. It uses Claude (Anthropic API) for conversation and
app generation, the CommCare CLI (commcare-cli.jar) to validate generated apps, and a
temporary URL service to enable one-click import into CommCare HQ.

## Architecture
- Desktop: Electron (main + renderer process)
- Frontend: React + TypeScript + Tailwind (renderer)
- Backend: Node.js + TypeScript (main process)
- Validation: Java-based CommCare CLI (commcare-cli.jar)
- AI: Anthropic Claude API
- Import: Clipboard + browser open to HQ's import page

## Key Files
- electron/main.ts — Electron main process, IPC handlers
- backend/src/services/appGenerator.ts — Core generation + validation loop
- backend/src/services/cliValidator.ts — Runs CLI and parses output
- backend/src/services/hqImport.ts — Opens HQ import page, copies fake URL to clipboard
- backend/src/services/appExporter.ts — Converts app to HQ import format
- backend/src/prompts/ — All Claude API prompts
- docs/ — CommCare reference documentation used in prompts

## Development
- `npm run dev` — Starts Electron in dev mode with hot reload
- `npm run build` — Builds for production
- `npm run dist` — Creates platform installers
- Java 17+ required for CLI validation

## Testing
- Backend: `cd backend && npm test`
- Frontend: `cd frontend && npm test`
- Integration: `npm run test:integration` (requires Java)

## Common Patterns
- The generate-validate-fix loop in appGenerator.ts is the core workflow
- CLI output parsing in cliValidator.ts is fragile — test thoroughly when changing
- Prompts in backend/src/prompts/ are critical to output quality — edit carefully
- API key stored in OS keychain via keytar, never in plaintext
- HQ import works by opening the import page and copying a fake URL to clipboard for step 1
- Generated app JSON is saved locally; user uploads it to HQ on step 2

## CommCare Concepts
- A CommCare app can be represented as a .ccz file (ZIP) or as HQ source format
- .ccz is used for CLI validation; HQ source format is used for import
- Apps have modules (containers) which have forms (XForms XML)
- Forms can create, update, and close cases (longitudinal records)
- The suite.xml defines navigation, case lists, and app structure
- The CommCare CLI validates apps by running them through the same engine used on phones
- HQ's import page accepts a file upload of app source JSON (accessed via Project Settings → Import App from Another Server)
