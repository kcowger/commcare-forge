# How to Build CommCare Forge with Claude Code

## Prerequisites

Before you start, you need these installed on your machine:

1. **Claude Code** (Anthropic's CLI tool): https://docs.anthropic.com/en/docs/claude-code
2. **Git**: You already have this
3. **Node.js 20+**: https://nodejs.org/
4. **Java 17+**: Needed to run commcare-cli.jar for validation

You do NOT need to know how to code. Claude Code will write everything.

---

## Step 1: Create the GitHub Repo

Go to https://github.com/new and create a new repo:

- **Name:** `commcare-forge`
- **Description:** "AI-powered desktop app for generating CommCare applications from natural language or uploaded documents"
- **Public** (since you want it open source)
- **Add a README:** Yes
- **License:** BSD 3-Clause (matches CommCare's license)

Clone it locally:

```bash
git clone https://github.com/kcowger/commcare-forge.git
cd commcare-forge
```

## Step 2: Add the Spec to the Repo

Copy the `COMMCARE_FORGE_SPEC.md` file into the repo root:

```bash
cp ~/Downloads/COMMCARE_FORGE_SPEC.md ./SPEC.md
```

Commit it:

```bash
git add SPEC.md
git commit -m "Add project specification"
git push
```

## Step 3: Launch Claude Code

From inside the repo directory:

```bash
claude
```

This opens the Claude Code interactive session.

## Step 4: Give Claude Code the Initial Prompt

Copy and paste this entire prompt into Claude Code. This is the full set of instructions it needs to scaffold and build the project.

---

**PASTE THIS INTO CLAUDE CODE:**

```
Read the file SPEC.md in this repo. That is the complete project specification for CommCare Forge, an Electron desktop app that uses AI to generate CommCare mobile applications.

Before writing any code, do the following setup steps in order:

1. Create the full project structure as described in the spec (Electron + React frontend + Node.js backend)
2. Create the AGENTS.md file as described in the spec
3. Set up the Electron app with electron-vite for hot reload during development
4. Set up the React frontend with TypeScript and Tailwind CSS
5. Set up the Node.js backend with TypeScript
6. Add a script that downloads the latest commcare-cli.jar from https://github.com/dimagi/commcare-core/releases
7. Create the .env.example file with all required environment variables
8. Make sure `npm run dev` starts the Electron app in development mode with hot reload
9. Make sure `npm run build` builds the production app
10. Make sure `npm run dist` creates platform installers (at minimum, macOS .dmg and Windows .exe)

For the Electron setup:
- Use electron-builder for packaging
- Use electron-vite or electron-forge with vite for the dev environment
- The React frontend runs in the renderer process
- The Node.js backend services run in the main process
- Use IPC (contextBridge + ipcRenderer/ipcMain) to communicate between frontend and backend
- Store the Anthropic API key in electron-store with encryption

For the frontend:
- React + TypeScript + Tailwind CSS
- A chat interface as the main UI
- Support for file attachments in the chat (drag and drop or file picker for PDFs, images, DOCX, XLSX)
- A progress tracker component for the build/validate cycle
- An import panel that shows the saved file path and instructions for importing to HQ

For the backend services, build them in this order:
1. cliValidator.ts - Runs commcare-cli.jar against a .ccz file and parses stdout/stderr to determine success or failure
2. cczBuilder.ts - Takes a JSON object of {filepath: content} and packages it into a .ccz (ZIP) file
3. claude.ts - Anthropic API client that handles conversation, generation, and fix prompts. Must support sending file attachments (PDFs, images as base64).
4. appExporter.ts - Converts generated app files to the JSON format HQ expects for import
5. hqImport.ts - Copies a fake HQ URL to clipboard, opens HQ import page in default browser, shows instructions
6. appGenerator.ts - Orchestrates the full generate → validate → fix → retry loop (max 5 retries)

For the prompts (in backend/src/prompts/):
- system.ts: System prompt for the conversation phase. Instructs Claude to act as an expert CommCare app builder. Include instructions for parsing uploaded documents (extracting fields, sections, data types, branching logic, calculations).
- generator.ts: Prompt for the generation phase. Instructs Claude to output a JSON object where keys are file paths and values are file contents for the .ccz structure.
- fixer.ts: Prompt for the fix phase. Sends CLI error output and current files, asks Claude to fix the issues.

Important notes:
- The CommCare CLI jar URL is: https://github.com/dimagi/commcare-core/releases - look for the latest release with a commcare-cli.jar asset
- The CLI is run with: java -jar commcare-cli.jar play /path/to/app.ccz
- A .ccz file is a ZIP containing profile.xml, suite.xml, media_suite.xml, and module/form XML files
- The app needs to produce TWO output formats: .ccz for CLI validation, and HQ-compatible JSON for import
- The HQ JSON format needs to be investigated - download a sample from an HQ instance at /a/{domain}/apps/source/{app_id}/ to understand the structure
- For now, stub out the HQ JSON export (appExporter.ts) with a TODO since the exact format needs investigation

Do NOT build everything at once. Start with:
1. Project scaffolding and dev environment (make sure npm run dev works)
2. The chat interface with file attachment support
3. The Claude API integration (conversation only, no generation yet)
4. Get a basic conversation working end-to-end

Then stop and let me test it before proceeding to the generation and validation pipeline.

Commit after each major milestone with clear commit messages.
```

---

## Step 5: Test the Initial Build

After Claude Code finishes the initial scaffolding:

```bash
npm install
npm run dev
```

This should open an Electron window with the chat interface. Test that:

- The app opens
- You can enter an API key in the settings
- You can type a message and get a response from Claude
- You can attach a file (PDF or image)

If something doesn't work, tell Claude Code what's broken and it will fix it.

## Step 6: Build the Generation Pipeline

Once the basic chat works, give Claude Code this next prompt:

```
The basic chat interface is working. Now build the generation and validation pipeline:

1. Implement the generate → validate → fix → retry loop in appGenerator.ts
2. When the user confirms the app summary, trigger generation
3. The generator prompt should instruct Claude to output a JSON object where keys are file paths (like "profile.xml", "suite.xml", "modules-0/forms-0.xml") and values are the XML content
4. cczBuilder.ts takes that JSON and creates a .ccz file in a temp directory
5. cliValidator.ts runs the CLI against the .ccz and returns success/failure with error messages
6. If validation fails, send the errors + current files to Claude with the fixer prompt, get corrected output, rebuild the .ccz, and re-validate
7. Max 5 retries before giving up
8. Show progress in the UI (generating, validating, fixing, re-validating, etc.)
9. On success, save the .ccz to ~/Documents/CommCare Forge/exports/{app-name}.ccz

Test with a simple prompt: "Create a registration form with fields for name, age, and phone number"

The CLI jar needs to be downloaded first. Run the download script or download it manually from https://github.com/dimagi/commcare-core/releases and put it in backend/lib/commcare-cli.jar

Commit when the pipeline is working end-to-end.
```

## Step 7: Build the HQ Import Flow

```
Now build the HQ import flow:

1. After successful validation, show an "Import to HQ" button in the UI
2. When clicked, prompt for HQ server (default: www.commcarehq.org) and project space domain. Save these as defaults for next time using electron-store.
3. Save the generated app JSON to ~/Documents/CommCare Forge/exports/{app-name}.json
4. Copy this fake URL to the clipboard: https://india.commcarehq.org/a/forge/apps/view/00000000000000000000000000000000/
5. Open the user's default browser to: https://{server}/a/{domain}/settings/project/import_app/
6. Show a message in the app with these instructions:
   "Your app has been saved. To import it to CommCare HQ:
   1. Paste the URL from your clipboard into the App URL field and click Next
   2. On the next page, enter an application name
   3. Click Choose File and select: {full path to saved JSON file}
   4. Click Import Application"

Also add a "Download .ccz" button as a fallback option that saves the .ccz to a user-chosen location.

Note: The HQ JSON export format (appExporter.ts) may still be stubbed out. If it is, just save the .ccz for now and note in the UI that direct HQ import is coming soon. The .ccz download should always work.

Commit when done.
```

## Step 8: Set Up GitHub Releases

```
Set up GitHub Actions to automatically build and publish platform installers on every tagged release:

1. Create .github/workflows/release.yml
2. On push of a tag matching v*, build the Electron app for:
   - macOS (dmg, universal binary for Intel + Apple Silicon)
   - Windows (exe installer)
   - Linux (AppImage)
3. Upload the built installers as GitHub Release assets
4. Use electron-builder's publish configuration to upload to GitHub Releases

The workflow should:
- Check out the repo
- Install Node.js 20
- Install dependencies
- Run npm run dist
- Upload artifacts to the GitHub release

Also add a .github/workflows/ci.yml that runs on every PR:
- Install dependencies
- Run TypeScript type checking
- Run any tests
- Build the app (but don't create installers)

Commit the workflow files.
```

## Step 9: Create First Release

After everything is working:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build the installers and attach them to the release at `https://github.com/kcowger/commcare-forge/releases/tag/v0.1.0`.

---

## Ongoing: Iterating on Prompts

The biggest ongoing work will be improving the prompts to generate valid CommCare apps. When Claude generates invalid XML or missing references:

```
The CLI is rejecting generated apps with this error:
[paste the error]

Here's what was generated:
[paste the relevant XML or describe what happened]

Update the generator prompt (backend/src/prompts/generator.ts) to prevent this class of error. Also update the fixer prompt if the fix loop isn't catching it.
```

## Ongoing: Investigating HQ JSON Format

To figure out the exact JSON format HQ expects for import:

1. Go to any CommCare HQ project with an app
2. Navigate to: `https://www.commcarehq.org/a/{domain}/apps/source/{app_id}/`
3. Save the JSON output
4. Give it to Claude Code:

```
Here is a sample CommCare HQ app source JSON (the format used for importing apps between servers). This was downloaded from HQ at /a/{domain}/apps/source/{app_id}/.

[paste the JSON or save it as a file in the repo at docs/sample-hq-app-source.json]

Update appExporter.ts to convert our generated app files into this exact JSON format so it can be uploaded through HQ's import page. Match the structure exactly.
```

---

## Summary of What You'll Tell Claude Code

| Step | What You Paste |
|------|---------------|
| 1 | The big initial scaffolding prompt (Step 4 above) |
| 2 | "Build the generation pipeline" prompt (Step 6) |
| 3 | "Build the HQ import flow" prompt (Step 7) |
| 4 | "Set up GitHub Actions" prompt (Step 8) |
| 5 | Ongoing prompt iteration as you test and find issues |

Each step builds on the previous one. Don't skip ahead. Test each step before moving to the next.
