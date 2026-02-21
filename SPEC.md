# CommCare Forge — Project Specification

## What This Is

CommCare Forge is an open source desktop application that uses AI to build CommCare applications from natural language descriptions. Users describe the app they want, the system asks clarifying questions, generates the app, validates it by running it through CommCare Core (the same engine that powers CommCare Mobile), and then publishes it to a temporary URL the user can paste into CommCare HQ's import page.

This spec is designed to be handed to Claude Code to build the entire project.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  Desktop App (Electron)                              │
│                                                      │
│  ┌─────────────┐     ┌──────────────────┐           │
│  │  Frontend    │────▶│  Backend Process  │           │
│  │  (React)     │◀────│  (Node.js)       │           │
│  └─────────────┘     └──────┬───────────┘           │
│                              │         │             │
│                              ▼         ▼             │
│                    ┌──────────┐  ┌──────────────┐   │
│                    │ Claude   │  │ CommCare CLI  │   │
│                    │ API      │  │ (Java JAR)    │   │
│                    └──────────┘  └──────────────┘   │
│                              │                       │
└──────────────────────────────────────────────────────┘
```

**Desktop App:** Electron application packaging the full stack. Runs locally on the user's machine. No server deployment needed.

**Frontend:** React single-page app (TypeScript, Tailwind CSS) rendered inside Electron's browser window.

**Backend Process:** Node.js running inside Electron's main process. Handles conversation state, calls Claude API, orchestrates app generation and validation, manages file operations.

**CommCare CLI:** The `commcare-cli.jar` bundled with the app. Runs on Java (bundled with the installer or required as a prerequisite). Used to validate generated apps.

**Claude API:** Powers the natural language conversation and app generation. Uses Anthropic's API with the `claude-sonnet-4-5-20250929` model.

---

## User Flow

### Step 1: Describe Your App

The user opens CommCare Forge and sees a clean interface with a text area and a file attachment area. They can provide input in three ways (or any combination):

**Option A: Natural language description**

> "I need an app for community health workers to register pregnant women, track their antenatal visits, flag high-risk pregnancies based on age, blood pressure, and previous complications, and generate a follow-up schedule for each trimester."

**Option B: Upload existing documents**

The user drags and drops or selects files that represent what they want digitized. Supported file types:

- **PDFs:** Paper forms, clinical protocols, government guidelines, registration templates, checklists
- **Images (PNG, JPG):** Photos of paper forms, whiteboard sketches, screenshots of existing tools
- **Word docs (DOCX):** Form templates, SOPs, program guides
- **Excel files (XLSX, CSV):** Data collection templates, indicator lists, field inventories

The AI parses the uploaded files, extracts the structure (fields, sections, skip logic implied by branching instructions, calculated fields), and uses that as the basis for the CommCare app. The uploaded document becomes the source of truth for what fields to include.

**Option C: Both**

The user uploads a file and adds context: "This is the ANC register we currently use on paper. We need to digitize it but also add automatic risk scoring based on the criteria on page 2."

**How file parsing works:**

Files are sent to the Claude API as attachments (PDFs and images are natively supported). The system prompt instructs Claude to:

1. Extract every field, question, and data point from the document
2. Identify sections that map to CommCare modules or form sections
3. Infer data types (text, number, date, single-select, multi-select) from the document context
4. Identify any branching logic, skip patterns, or conditional sections
5. Note any calculations, scoring, or derived fields
6. Present a structured summary of what it found before proceeding to clarification

This is particularly valuable for health programs digitizing existing paper-based protocols, where the paper form is the authoritative spec for what the digital version should capture.

### Step 2: Clarification Conversation

The AI asks clarifying questions in a chat interface. The goal is to nail down the spec before generating anything. Questions should cover:

- Case types and relationships (e.g. "Should each pregnancy be its own case, or a property on a patient case?")
- Module structure (what forms belong in which modules)
- Specific data points to capture in each form
- Conditional logic and skip conditions
- Calculations and derived fields
- Case list display fields
- Follow-up scheduling logic
- Languages needed

The AI should ask 3-5 focused questions per round, not overwhelm the user with 20 questions at once. It should feel like a conversation with a knowledgeable CommCare app builder.

### Step 3: Confirm and Generate

Once the AI has enough information, it presents a structured summary of the app it's about to build:

- Modules and their purposes
- Forms within each module with key questions listed
- Case types and their properties
- Key logic (skip conditions, calculations, case updates)
- Case list display configuration

The user reviews this and either confirms or asks for changes. Changes loop back into the conversation.

### Step 4: Build and Validate

On confirmation, the backend:

1. Calls Claude API to generate the full CommCare app definition (XForms XML, suite.xml, profile.xml, and all supporting files)
2. Packages them into a `.ccz` file (which is just a ZIP with a .ccz extension)
3. Runs the `.ccz` through `commcare-cli.jar` to validate it
4. If the CLI reports errors, sends those errors back to Claude to fix, then re-validates
5. Repeats until the app passes validation or hits a max retry count (5 attempts)
6. Shows the user the result: success with import option, or partial success with a list of remaining issues

The UI should show a progress indicator during this step with status messages like:
- "Generating app definition..."
- "Validating with CommCare engine..."
- "Found 3 issues, fixing..."
- "Re-validating..."
- "App validated successfully!"

### Step 5: Import to CommCare HQ

Once validated, the user clicks "Import to HQ." The app:

1. Prompts the user for their HQ server and project space domain (e.g. server: `www.commcarehq.org`, domain: `my-project`). These should be saved as defaults for next time.
2. Saves the generated app JSON to a known local path (e.g. `~/Documents/CommCare Forge/exports/{app-name}.json`)
3. Copies a fake but structurally valid HQ app URL to the clipboard (e.g. `https://india.commcarehq.org/a/forge/apps/view/00000000000000000000000000000000/`)
4. Opens the user's default browser to `https://{server}/a/{domain}/settings/project/import_app/`
5. Displays a message in the app: "Paste the URL from your clipboard into the App URL field and click Next. Then upload the file at `{path}`."

The user's flow:
1. Paste the clipboard URL into the "App URL" field, click Next
2. On step 2, click "Choose File," browse to the path shown in CommCare Forge, click "Import Application"

**Why this approach:** HQ's import page uses HTMX for the step 1 → step 2 transition (not a standard form POST), making auto-submission from an external page unreliable. The clipboard approach is simple, works regardless of HQ's frontend implementation, and requires no infrastructure.

**Fallback:** User can also download the raw `.ccz` file for manual import or archival.

**Future improvement:** If an HQ API endpoint for app import is added, CommCare Forge can skip all of this and import directly via API key auth.

---

## Technical Details

### Project Structure

```
commcare-forge/
├── README.md
├── AGENTS.md              # Instructions for AI agents working on this repo
├── package.json           # Root package.json for Electron app
├── electron/
│   ├── main.ts            # Electron main process
│   ├── preload.ts         # Preload script for IPC
│   └── ipc-handlers.ts   # IPC handlers bridging frontend ↔ backend
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatInterface.tsx    # Main conversation UI with file attachment support
│   │   │   ├── AppSummary.tsx       # Structured app spec review
│   │   │   ├── ProgressTracker.tsx  # Build/validate progress
│   │   │   ├── ImportPanel.tsx      # HQ import + URL display
│   │   │   └── Header.tsx
│   │   ├── hooks/
│   │   │   └── useChat.ts           # IPC-based chat hook
│   │   └── types/
│   │       └── index.ts
│   └── public/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── services/
│   │   │   ├── claude.ts            # Anthropic API client
│   │   │   ├── appGenerator.ts      # Orchestrates generation + validation loop
│   │   │   ├── cliValidator.ts      # Runs commcare-cli.jar and parses output
│   │   │   ├── cczBuilder.ts        # Packages app files into .ccz
│   │   │   ├── appExporter.ts       # Converts to HQ JSON import format
│   │   │   └── hqImport.ts          # Opens HQ import page, copies fake URL to clipboard
│   │   ├── prompts/
│   │   │   ├── system.ts            # System prompt for conversation
│   │   │   ├── generator.ts         # Prompt for app generation
│   │   │   └── fixer.ts             # Prompt for fixing validation errors
│   │   └── types/
│   │       └── index.ts
│   └── lib/
│       └── commcare-cli.jar         # Bundled from GitHub releases
├── docs/
│   ├── commcare-xform-spec.md       # Reference: XForm specification
│   ├── commcare-suite-spec.md       # Reference: Suite XML specification
│   ├── commcare-case-xml.md         # Reference: Case XML specification
│   └── commcare-app-structure.md    # Reference: CCZ file structure
├── scripts/
│   ├── download-cli.sh              # Script to fetch latest commcare-cli.jar
│   └── build-installers.sh          # Script to build platform installers
└── build/
    └── electron-builder.yml         # Electron Builder config for installers
```

### Platform & Distribution

**Electron** packages the app as a standalone desktop application.

**Supported platforms:**
- macOS (.dmg)
- Windows (.exe installer)
- Linux (.AppImage)

**Java bundling:** The installer should bundle a minimal Java 17 runtime (using jlink or a bundled JRE) so users don't need to install Java separately. If bundling proves too complex, require Java 17+ as a prerequisite and check for it on app startup with a clear error message.

**electron-builder** handles packaging and installer creation. Configuration in `build/electron-builder.yml`.

### Environment Variables / Settings

Since this is a desktop app, configuration is stored locally:

```
# Settings stored in Electron's app data directory
ANTHROPIC_API_KEY=sk-ant-...       # Required: User enters on first launch
HQ_SERVER=www.commcarehq.org       # Default HQ server
HQ_DOMAIN=                         # User's project space domain
MAX_VALIDATION_RETRIES=5           # Max fix-and-retry attempts
```

**First-launch setup:** The app prompts for an Anthropic API key on first launch. This is stored in Electron's secure storage (electron-store with encryption or the OS keychain via keytar). The app also prompts for the user's HQ server and project space domain, which are saved for future sessions.

### HQ Import Details

The import flow uses HQ's existing "Import App from Another Server" feature (Project Settings → Import App from Another Server).

**HQ import page URL:** `https://{server}/a/{domain}/settings/project/import_app/`

**Step 1 (App URL):** The page uses HTMX (`hx-post` to `/a/{domain}/settings/project/import_app/steps/`) with a form field named `app_url`. It validates that the URL looks like a valid HQ app URL (pattern: `https://{server}/a/{domain}/apps/view/{app_id}/`). It does not verify the server or app actually exist, so any structurally valid URL works.

**Step 2 (File Upload):** After submitting step 1, the page shows a file upload form with fields for `Application Name` and `Application Source File`. The user uploads the generated JSON file here.

**Fake URL for step 1:** CommCare Forge copies a URL like `https://india.commcarehq.org/a/forge/apps/view/00000000000000000000000000000000/` to the clipboard. Using a different server (e.g. `india.commcarehq.org` when the user is on `www.commcarehq.org`) avoids any same-server validation that might try to actually look up the app.

**Form field reference (from HQ source):**
- CSRF token field: `csrfmiddlewaretoken` (hidden input)
- URL field: `app_url` (type: url, id: `id_app_url`)
- HTMX action attribute: `hq-hx-action="extract_app_info_from_url"`

### Claude API Integration

**System prompt for conversation phase:**

The system prompt should instruct Claude to act as an expert CommCare app builder. It should:
- Understand CommCare's module/form/case model deeply
- Ask smart clarifying questions (not generic ones)
- Think about edge cases the user hasn't considered
- Structure its understanding in terms of CommCare concepts (modules, forms, case types, case properties, case relationships, display conditions, form logic)

Include the following reference documentation in the system prompt (or as attached documents):
- CommCare XForm specification: https://dimagi.github.io/xform-spec/
- CommCare Suite specification: https://github.com/dimagi/commcare-core/wiki/Suite20
- CommCare Case XML specification: https://github.com/dimagi/commcare-core/wiki/casexml20
- CommCare app building guide: https://dimagi.atlassian.net/wiki/spaces/commcarepublic/overview

**Handling uploaded files:**

When the user uploads files (PDFs, images, DOCX, XLSX), they need to be included in the Claude API call:

- **PDFs and images:** Send directly to Claude as base64-encoded attachments using the document/image content blocks. Claude natively understands these formats.
- **DOCX files:** Extract text content using a library like `mammoth` (Node.js) and include as text in the user message. If the doc contains images (e.g. embedded form screenshots), extract those separately and include as image attachments.
- **XLSX/CSV files:** Parse into a structured text representation (e.g. markdown table or JSON) using a library like `xlsx` (SheetJS) and include as text in the user message.

The system prompt should include specific instructions for when files are attached:

```
When the user uploads a document (paper form, protocol, checklist, template):
1. Extract every field, question, section header, and data point
2. Identify data types: text fields, numeric fields, dates, checkboxes, dropdowns, multi-select
3. Note any branching logic (e.g. "If yes, go to section B")
4. Note any calculations or scoring (e.g. "Total = sum of items 1-5")
5. Identify repeating sections (e.g. a table where rows are added for each child)
6. Present a structured summary of everything you found
7. Ask clarifying questions about anything ambiguous before generating
```

**System prompt for generation phase:**

When generating the actual app, Claude should output the complete file structure needed for a `.ccz` file. A `.ccz` is a ZIP containing:

```
profile.xml          # App profile and settings
suite.xml            # Module/form structure, menus, case list config
media_suite.xml      # Media references (can be empty)
modules-0/
  forms-0.xml        # XForm for first form in first module
  forms-1.xml        # XForm for second form in first module
modules-1/
  forms-0.xml        # XForm for first form in second module
...
```

The prompt should instruct Claude to output this as a structured JSON object where keys are file paths and values are file contents. The backend then writes these to disk and zips them.

**System prompt for fix phase:**

When the CLI reports validation errors, send Claude the errors along with the current app files and ask it to fix the issues. Be specific about what the CLI output means.

### CommCare CLI Validation

The validation step runs:

```bash
java -jar commcare-cli.jar play /path/to/generated.ccz
```

The CLI will:
- Report errors if the app files are malformed
- Attempt to load and parse the app structure
- Show the module list if successful

Parse the CLI output to determine:
- **Success:** CLI shows module list without errors
- **Failure:** CLI reports specific errors (malformed XML, missing references, etc.)

Capture both stdout and stderr. Set a timeout (30 seconds) to prevent hanging.

**Important:** The CLI normally expects a username/password to sync user data from HQ. For validation purposes, we only need to check that the app loads without errors. The CLI should fail gracefully if no user data is available, and the app structure validation happens before the user data sync. If needed, you may need to pass dummy credentials or find a flag that skips the sync step. Investigate the CLI's behavior and adapt accordingly.

### HQ Import Format

CommCare HQ's import page (`/a/{domain}/settings/project/import_app/`) accepts a URL pointing to an app's source. This is the same mechanism used when copying apps between HQ instances.

**Investigate:** Download a sample app source from HQ to understand the exact structure HQ expects for import. The URL format on HQ is typically:
```
https://www.commcarehq.org/a/{domain}/apps/source/{app_id}/
```

The generated app must be in the JSON format HQ expects for file upload on the import page. This is a different format than the `.ccz` used for CLI validation. The generation pipeline needs to produce both:
1. `.ccz` for CLI validation
2. HQ-compatible JSON for file upload import

### Security Requirements

**API keys:**
- Anthropic API key is stored in Electron's secure storage (OS keychain via keytar, or encrypted electron-store)
- API key is never sent to the frontend renderer process; all API calls happen in the main process
- Users can update or delete their API key from the app settings

**No cloud infrastructure required:**
- The app runs entirely locally except for Claude API calls
- No AWS, S3, or cloud storage needed
- App definitions are saved to the local filesystem only
- The only network calls are to the Anthropic API and opening HQ in the browser

**File handling:**
- Generated app files are stored in the OS temp directory
- Temp files are cleaned up after import or after a timeout (1 hour)
- File paths are sanitized to prevent directory traversal

**No credentials for HQ:**
- The app never handles HQ usernames, passwords, or session tokens
- The user authenticates with HQ themselves in their own browser
- The only data sent to the cloud is the app definition (not sensitive)

### Frontend Design

**Aesthetic:** Modern, minimal, professional. Think Linear or Vercel's design language. Dark mode supported.

**Color palette:**
- Primary: Deep blue (#1a1a2e or similar)
- Accent: Bright teal or green (for success states and CTAs)
- Background: Near-white (#fafafa) for light mode, near-black (#0a0a0a) for dark mode
- Text: High contrast, clean sans-serif font (Inter or similar)

**Layout:**
- Full-width chat interface as the main interaction
- Sidebar or overlay for the app summary during review
- Bottom-anchored input field for chat messages
- Floating progress indicator during generation/validation
- Import panel showing the saved file path, "Open in HQ" button, and import instructions

**Responsiveness:** Desktop-only. No need for mobile responsiveness since this is an Electron app.

**Animations:** Subtle transitions for chat messages appearing, progress state changes. Nothing flashy.

---

## CommCare Reference Material

The AI needs deep knowledge of CommCare to generate valid apps. The following documentation should be scraped, processed, and included as context in Claude API calls.

### Required Documentation to Include

1. **CommCare XForm Spec:** https://dimagi.github.io/xform-spec/
   - Covers form XML structure, data types, bindings, calculations, skip logic, output references, instances

2. **CommCare Suite Spec:** https://github.com/dimagi/commcare-core/wiki/Suite20
   - Covers module/menu structure, entries, datums, session management, details (case lists/details)

3. **Case XML Spec:** https://github.com/dimagi/commcare-core/wiki/casexml20
   - Covers case create/update/close/index operations within forms

4. **CommCare App Building Documentation:** https://dimagi.atlassian.net/wiki/spaces/commcarepublic/overview
   - General app building concepts, module types, form types, case management patterns

5. **CCZ File Structure:** Reference the HQ docs on how `.ccz` files are structured (zip containing profile.xml, suite.xml, form XMLs, etc.)

6. **HQ App Source Format:** Download and document the source format HQ uses for app import/export (distinct from .ccz format)

### How to Include Documentation

These docs should be fetched and cached locally during build time (not at runtime). Store them as markdown files in the `docs/` directory. Include relevant portions in Claude API calls using the system prompt or as document attachments.

Given context window limits, prioritize:
- XForm spec (most critical for generating valid forms)
- Case XML spec (critical for case management)
- Suite spec (critical for app structure)
- HQ app source format (critical for import)
- App building docs (supplementary, for understanding patterns)

---

## AGENTS.md Content

Include this file in the repo root so AI agents working on the codebase understand the project:

```markdown
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
```

---

## Open Questions / Known Risks

1. **HQ Import Format:** The exact format that HQ's import page expects needs to be reverse-engineered by downloading an app source from HQ and examining it. This is critical to the import workflow. Without the correct format, HQ will reject the import.

2. **CLI Validation Depth:** The CLI may need a username/password to fully initialize. Without real user data, it may only validate structural integrity (which might be sufficient). Test this and document the behavior.

3. **CCZ Structure Completeness:** The exact file structure of a `.ccz` that the CLI and HQ accept needs to be verified by examining real `.ccz` files. Download a sample from HQ and unzip it to understand the full structure.

4. **Context Window Limits:** Including all CommCare documentation in every Claude API call may exceed context limits. May need to use a retrieval-based approach (RAG) or selectively include only relevant docs based on the conversation.

5. **CLI JAR Download URL:** The exact URL for downloading the latest `commcare-cli.jar` from GitHub releases needs to be confirmed. The release asset naming convention may vary.

6. **Complex App Generation Quality:** Multi-module apps with case management are significantly harder to generate correctly than simple forms. Expect the fix-and-retry loop to be exercised frequently. The prompts will need heavy iteration to get good results.

7. **Java Bundling:** Bundling a JRE with the Electron app adds significant size (~50-100MB). Evaluate whether to bundle or require Java as a prerequisite. Bundling is better UX; prerequisite is simpler to implement.

8. **HQ Import URL Validation:** The fake URL approach (using `india.commcarehq.org` when user is on `www.commcarehq.org`) has been tested and works. If HQ changes its URL validation logic in the future, this may break. The fallback is to have the user manually enter any valid-looking HQ app URL.

9. **HQ Import Page Stability:** The import wizard's two-step flow could change in future HQ releases. The form field name (`app_url`) and HTMX endpoint (`/steps/`) are documented in the spec based on current source. Monitor for changes.

---

## Getting Started (for Claude Code)

1. Initialize the Electron + React project structure
2. Set up the development environment (electron-vite or similar for hot reload)
3. Download a sample `.ccz` from CommCare HQ and unzip it to understand the exact file structure
4. Download a sample app source from HQ to understand the import format
5. Build the backend services in this order: cliValidator → cczBuilder → claude client → appExporter → hqImport → appGenerator → IPC handlers
6. Build the frontend chat interface
7. Wire everything together via Electron IPC
8. Test with a simple app first ("registration form with name, age, phone number") before attempting complex apps
9. Test the full HQ import flow (fake URL in step 1, file upload in step 2)
10. Build platform installers
11. Iterate on prompts based on what the CLI rejects

Start simple. Get a single-form app generating and validating before tackling multi-module case management apps.
