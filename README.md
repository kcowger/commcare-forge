# CommCare Forge

Build CommCare apps using AI. Describe what you need in plain language or upload an existing paper form, and CommCare Forge generates a complete CommCare application ready to import into CommCare HQ.

## How It Works

1. **Open the app** and enter your Anthropic API key (one-time setup)
2. **Describe your app** in the chat, or upload a PDF/Word/Excel document of an existing form
3. **Review** the AI's questions and confirm the design
4. **Click Build** — the app is generated, validated, and exported
5. **Import to CommCare HQ** with the guided import flow

No coding required. No command line. No dependencies to install.

## Download

Go to [Releases](../../releases) and download the installer for your platform:

- **Windows**: `commcare-forge-x.x.x-setup.exe`
- **macOS**: `CommCare Forge-x.x.x.dmg`
- **Linux**: `CommCare Forge-x.x.x.AppImage`

## Getting Started

### 1. Get an Anthropic API Key

CommCare Forge uses Claude (by Anthropic) to generate apps. You need an API key:

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an account or sign in
3. Go to **API Keys** and create a new key
4. Copy the key (it starts with `sk-ant-`)

### 2. Set Up the App

1. Open CommCare Forge
2. Click the **Settings** icon
3. Paste your API key
4. Optionally, enter your CommCare HQ server and project space domain for one-click import

### 3. Build Your First App

Type something like:

> I need a patient registration app for community health workers that captures name, age, gender, phone number, and GPS location.

Or upload an existing paper form (PDF, Word doc, Excel template, or image) and let the AI extract the fields automatically.

The AI will ask clarifying questions about your app's structure, then generate it when you're ready.

## Supported Input Formats

| Format | Use Case |
|--------|----------|
| **PDF** | Paper forms, clinical protocols, government guidelines |
| **Word (.docx)** | Form templates, SOPs, program guides |
| **Excel (.xlsx)** | Data collection templates, indicator lists |
| **Images (.png, .jpg)** | Photos of paper forms, whiteboard sketches |

You can also combine uploads with text descriptions for additional context.

## Importing to CommCare HQ

After generating an app, CommCare Forge provides two ways to get it into HQ:

- **Guided import**: Opens the HQ import page with step-by-step instructions
- **Download JSON**: Save the file and manually upload it through HQ's import page

## Privacy and Security

- **Runs locally**: The app runs entirely on your machine. No cloud infrastructure, no accounts, no telemetry.
- **API key stays local**: Your Anthropic API key is stored in encrypted local storage and never leaves your machine except to authenticate with the Anthropic API.
- **No HQ credentials**: CommCare Forge never handles your HQ username or password. You authenticate with HQ yourself in your own browser.
- **Only outbound call**: The Anthropic API (to power the AI conversation and generation). That's it.

## Building from Source

If you want to run or modify CommCare Forge locally:

```bash
# Clone the repo
git clone https://github.com/kcowger/commcare-forge.git
cd commcare-forge

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Create distributable installer
npm run dist
```

**Requirements for development**:
- Node.js 20+
- npm

## Tech Stack

- **Electron** — Desktop application framework
- **React + TypeScript** — Frontend UI
- **Tailwind CSS** — Styling
- **Anthropic Claude API** — AI-powered generation
- **electron-store** — Encrypted local settings storage

## License

[BSD 3-Clause](LICENSE)
