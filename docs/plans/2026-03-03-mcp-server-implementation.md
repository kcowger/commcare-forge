# CommCare Forge MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that exposes CommCare Forge's validation, expansion, and compilation pipeline as tools for Claude Code.

**Architecture:** Thin MCP wrapper in `mcp-server/` that imports backend services from `backend/src/`. Two tools (validate, build) and two resources (CommCare reference, compact JSON schema). stdio transport, no API key needed.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, existing backend services (hqJsonExpander, hqValidator, autoFixer, cczCompiler)

---

### Task 1: Scaffold the MCP server package

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`

**Step 1: Create mcp-server/package.json**

```json
{
  "name": "commcare-forge-mcp",
  "version": "0.1.0",
  "description": "MCP server for building CommCare applications",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "adm-zip": "^0.5.16"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.7",
    "@types/node": "^20.0.0",
    "typescript": "^5.7.2"
  }
}
```

**Step 2: Create mcp-server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "paths": {
      "@backend/*": ["../backend/src/*"]
    }
  },
  "include": ["src/**/*", "../backend/src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Install dependencies**

Run: `cd mcp-server && npm install`
Expected: node_modules created, package-lock.json generated

**Step 4: Commit**

```bash
git add mcp-server/package.json mcp-server/tsconfig.json mcp-server/package-lock.json
git commit -m "feat: scaffold MCP server package"
```

---

### Task 2: Extract the compact JSON schema as an MCP resource document

**Files:**
- Create: `docs/compact-json-schema.md`

**Step 1: Write the compact JSON schema doc**

Extract the format specification from `backend/src/prompts/generator.ts` into a standalone reference doc. This is the content of `GENERATOR_PROMPT` reformatted as a reference document (not a prompt). Include:
- The JSON structure (app_name, modules, forms, questions)
- All field descriptions from the "Field Reference" section
- Question type list with descriptions
- Reserved case property names
- Smart type selection rules
- Case lifecycle guidance (close_case, child_cases)
- The Patient Tracker example

Strip prompt-specific framing like "Output ONLY the JSON code block" and "You generate CommCare app definitions". Frame it as a reference specification: "CommCare Compact JSON Format Specification".

**Step 2: Commit**

```bash
git add docs/compact-json-schema.md
git commit -m "docs: extract compact JSON schema as standalone reference"
```

---

### Task 3: Create MCP resources (CommCare reference + compact schema)

**Files:**
- Create: `mcp-server/src/resources.ts`

**Step 1: Write the failing test**

Create `tests/mcp/resources.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getResources, readResource } from '../../mcp-server/src/resources'

describe('MCP Resources', () => {
  it('lists two resources', () => {
    const resources = getResources()
    expect(resources).toHaveLength(2)
    expect(resources.map(r => r.uri)).toContain('commcare://reference')
    expect(resources.map(r => r.uri)).toContain('commcare://compact-schema')
  })

  it('reads the CommCare reference', () => {
    const content = readResource('commcare://reference')
    expect(content).toContain('XForm XML Structure')
    expect(content).toContain('<h:html')
  })

  it('reads the compact JSON schema', () => {
    const content = readResource('commcare://compact-schema')
    expect(content).toContain('app_name')
    expect(content).toContain('case_type')
    expect(content).toContain('RESERVED')
  })

  it('throws for unknown URI', () => {
    expect(() => readResource('commcare://unknown')).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/resources.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `mcp-server/src/resources.ts`:

```typescript
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve paths relative to repo root (mcp-server/src/../../)
const REPO_ROOT = resolve(__dirname, '..', '..')

interface McpResource {
  uri: string
  name: string
  description: string
  mimeType: string
}

export function getResources(): McpResource[] {
  return [
    {
      uri: 'commcare://reference',
      name: 'CommCare XML Reference',
      description: 'XForm, Suite XML, and Case XML structure reference for CommCare applications',
      mimeType: 'text/markdown'
    },
    {
      uri: 'commcare://compact-schema',
      name: 'CommCare Compact JSON Schema',
      description: 'Specification for the compact JSON format used to define CommCare applications',
      mimeType: 'text/markdown'
    }
  ]
}

export function readResource(uri: string): string {
  switch (uri) {
    case 'commcare://reference':
      return readFileSync(resolve(REPO_ROOT, 'docs', 'commcare-reference.md'), 'utf-8')
    case 'commcare://compact-schema':
      return readFileSync(resolve(REPO_ROOT, 'docs', 'compact-json-schema.md'), 'utf-8')
    default:
      throw new Error(`Unknown resource URI: ${uri}`)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/resources.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add mcp-server/src/resources.ts tests/mcp/resources.test.ts
git commit -m "feat: add MCP resource definitions for CommCare reference docs"
```

---

### Task 4: Create the validate_commcare_app tool

**Files:**
- Create: `mcp-server/src/tools.ts`

**Step 1: Write the failing test**

Create `tests/mcp/tools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { handleValidate } from '../../mcp-server/src/tools'

describe('validate_commcare_app', () => {
  it('returns valid for a correct compact JSON', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Patients',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            questions: [
              { id: 'name', type: 'text', label: 'Name', required: true }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(true)
  })

  it('returns errors for missing case_type', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Patients',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            questions: [
              { id: 'name', type: 'text', label: 'Name' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('case_type')
  })

  it('returns errors for reserved property names', async () => {
    const result = await handleValidate({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Mod',
          case_type: 'patient',
          forms: [{
            name: 'Register',
            type: 'registration',
            case_name_field: 'name',
            case_properties: { 'status': 'status_field' },
            questions: [
              { id: 'name', type: 'text', label: 'Name' },
              { id: 'status_field', type: 'text', label: 'Status' }
            ]
          }]
        }]
      }
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('reserved'))).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `mcp-server/src/tools.ts`:

```typescript
import { validateCompact, expandToHqJson } from '../../backend/src/services/hqJsonExpander'
import { AutoFixer } from '../../backend/src/services/autoFixer'
import { HqValidator } from '../../backend/src/services/hqValidator'
import { CczCompiler } from '../../backend/src/services/cczCompiler'
import { mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { resolve } from 'path'
import type { CompactApp } from '../../backend/src/services/hqJsonExpander'

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

export async function handleBuild(input: BuildInput): Promise<BuildResult> {
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
  // Merge fixed files back
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
}

export function getToolDefinitions() {
  return [
    {
      name: 'validate_commcare_app',
      description: 'Validates a CommCare compact JSON app definition against CommCare rules. Call this before build_commcare_app to catch errors early. Returns { valid: true } or { valid: false, errors: [...] }.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          compact_json: {
            type: 'object',
            description: 'The compact app definition with app_name and modules array'
          }
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
          compact_json: {
            type: 'object',
            description: 'A validated compact app definition'
          },
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add mcp-server/src/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add validate and build tool handlers"
```

---

### Task 5: Write the build_commcare_app tool test

**Files:**
- Modify: `tests/mcp/tools.test.ts`

**Step 1: Add build tool tests**

Append to `tests/mcp/tools.test.ts`:

```typescript
import { handleBuild } from '../../mcp-server/src/tools'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

describe('build_commcare_app', () => {
  const testOutputDir = join(tmpdir(), `mcp-test-${randomUUID()}`)

  afterAll(() => {
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true })
    }
  })

  it('builds a valid app and writes .ccz and .hq.json', async () => {
    const result = await handleBuild({
      compact_json: {
        app_name: 'Test App',
        modules: [{
          name: 'Patients',
          case_type: 'patient',
          forms: [{
            name: 'Register Patient',
            type: 'registration',
            case_name_field: 'patient_name',
            case_properties: { age: 'age' },
            questions: [
              { id: 'patient_name', type: 'text', label: 'Patient Name', required: true },
              { id: 'age', type: 'int', label: 'Age' }
            ]
          }],
          case_list_columns: [{ field: 'age', header: 'Age' }]
        }]
      },
      output_dir: testOutputDir
    })
    expect(result.success).toBe(true)
    expect(result.ccz_path).toBeDefined()
    expect(result.hq_json_path).toBeDefined()
    expect(existsSync(result.ccz_path!)).toBe(true)
    expect(existsSync(result.hq_json_path!)).toBe(true)
  })

  it('returns errors for invalid compact JSON', async () => {
    const result = await handleBuild({
      compact_json: {
        app_name: '',
        modules: []
      }
    })
    expect(result.success).toBe(false)
    expect(result.errors!.length).toBeGreaterThan(0)
  })
})
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: PASS (all tests including the new build tests)

**Step 3: Commit**

```bash
git add tests/mcp/tools.test.ts
git commit -m "test: add build_commcare_app tool tests"
```

---

### Task 6: Create the MCP server entry point

**Files:**
- Create: `mcp-server/src/index.ts`

**Step 1: Write the MCP server**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getResources, readResource } from './resources.js'
import { getToolDefinitions, handleValidate, handleBuild } from './tools.js'

const server = new McpServer({
  name: 'commcare-forge',
  version: '0.1.0'
})

// Register resources
server.resource(
  'commcare-reference',
  'commcare://reference',
  { description: 'CommCare XML Reference — XForm, Suite XML, and Case XML structure', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, text: readResource(uri.href), mimeType: 'text/markdown' }]
  })
)

server.resource(
  'commcare-compact-schema',
  'commcare://compact-schema',
  { description: 'Compact JSON format specification for defining CommCare applications', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, text: readResource(uri.href), mimeType: 'text/markdown' }]
  })
)

// Register tools
server.tool(
  'validate_commcare_app',
  'Validates a CommCare compact JSON app definition. Returns { valid: true } or { valid: false, errors: [...] }.',
  {
    compact_json: {
      type: 'object',
      description: 'The compact app definition with app_name and modules array'
    }
  },
  async ({ compact_json }) => {
    const result = await handleValidate({ compact_json })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    }
  }
)

server.tool(
  'build_commcare_app',
  'Builds a CommCare app from validated compact JSON. Writes .ccz and .hq.json to output_dir.',
  {
    compact_json: {
      type: 'object',
      description: 'A validated compact app definition'
    },
    output_dir: {
      type: 'string',
      description: 'Output directory path. Defaults to ./commcare-output/'
    }
  },
  async ({ compact_json, output_dir }) => {
    const result = await handleBuild({ compact_json, output_dir })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    }
  }
)

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
```

**Step 2: Build the MCP server**

Run: `cd mcp-server && npm run build`
Expected: TypeScript compiles to `mcp-server/dist/` without errors

**Step 3: Smoke test — run the server and check it starts**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node mcp-server/dist/index.js`
Expected: JSON response with server info (name: "commcare-forge", version: "0.1.0")

**Step 4: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat: add MCP server entry point with stdio transport"
```

---

### Task 7: Add build:mcp script to root package.json

**Files:**
- Modify: `package.json` (root)

**Step 1: Add the script**

Add to the `"scripts"` section in root `package.json`:

```json
"build:mcp": "cd mcp-server && npm run build"
```

**Step 2: Update vitest config to include MCP tests**

Check that `tests/mcp/**/*.test.ts` is already covered by the existing `tests/**/*.test.ts` glob in `vitest.config.ts`. It should be — no change needed.

**Step 3: Run all tests to make sure nothing is broken**

Run: `npm test`
Expected: All existing tests pass, plus the new MCP tests

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add build:mcp script to root package.json"
```

---

### Task 8: Test end-to-end with Claude Code configuration

**Files:**
- No new files — manual testing

**Step 1: Build the MCP server**

Run: `npm run build:mcp`
Expected: Compiles successfully to `mcp-server/dist/`

**Step 2: Add the MCP server to Claude Code config**

Create or update `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "commcare-forge": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"]
    }
  }
}
```

**Step 3: Verify Claude Code discovers the tools**

Restart Claude Code in the project directory. Check that:
- `validate_commcare_app` tool is available
- `build_commcare_app` tool is available
- `commcare://reference` resource is available
- `commcare://compact-schema` resource is available

**Step 4: Commit the MCP config**

```bash
git add .mcp.json
git commit -m "feat: add MCP server configuration for Claude Code"
```

---

### Task 9: Final cleanup and documentation

**Files:**
- Modify: root `README.md` (add MCP server section)

**Step 1: Add MCP server section to README**

Add a section to the existing README explaining:
- What the MCP server is
- How to build it (`npm run build:mcp`)
- How to configure it in Claude Code (`.mcp.json`)
- The two tools and two resources
- Example usage flow

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add MCP server section to README"
```
