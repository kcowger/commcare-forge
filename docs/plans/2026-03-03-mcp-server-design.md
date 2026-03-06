# CommCare Forge MCP Server Design

## Goal

Expose CommCare Forge's app generation logic as an MCP server so Claude Code can build CommCare applications from natural language — the same end-to-end flow as the Electron app, but from the terminal.

## Key Decisions

- **Approach:** Two-tool pipeline. Claude Code orchestrates validation and build as separate steps.
- **Knowledge delivery:** MCP resources. Claude Code reads the CommCare reference and compact JSON schema before generating. No separate Claude API calls from the server.
- **Location:** `mcp-server/` directory inside this repo. Imports directly from `backend/src/`.
- **Output:** Files written to current working directory (`./commcare-output/` default).
- **Transport:** stdio.
- **No external dependencies:** No Anthropic API key, no Java runtime.

## Architecture

```
mcp-server/
├── src/
│   ├── index.ts          # MCP server entry point (stdio transport)
│   ├── tools.ts          # Tool definitions and handlers
│   └── resources.ts      # Resource definitions
├── package.json
└── tsconfig.json
```

The server is a thin MCP wrapper around existing backend services. No code duplication.

## MCP Resources

### `commcare://reference`
- Source: `docs/commcare-reference.md`
- Content: XForm XML structure, Suite XML, Case XML, data bindings, itext localization
- Same reference doc currently used in the Electron app's system prompt

### `commcare://compact-schema`
- Source: New file extracted from `backend/src/prompts/generator.ts`
- Content: Compact JSON format spec, question types, case lifecycle rules, reserved property names, smart type selection rules
- The "how to write compact JSON" guide, stripped of prompt framing

Claude Code reads both resources before generating compact JSON.

## MCP Tools

### `validate_commcare_app`

Validates a compact JSON app definition against CommCare's rules.

**Input:**
```json
{
  "compact_json": { "app_name": "...", "modules": [...] }
}
```

**Output (success):**
```json
{ "valid": true }
```

**Output (errors):**
```json
{ "valid": false, "errors": ["Module 'Registration' has case forms but no case_type"] }
```

**Implementation:** Calls `validateCompact()` from `hqJsonExpander.ts`.

### `build_commcare_app`

Expands validated compact JSON into full CommCare artifacts (.ccz and HQ JSON).

**Input:**
```json
{
  "compact_json": { "app_name": "...", "modules": [...] },
  "output_dir": "./commcare-output/"
}
```

**Output (success):**
```json
{
  "success": true,
  "ccz_path": "./commcare-output/MyApp.ccz",
  "hq_json_path": "./commcare-output/MyApp.hq.json"
}
```

**Output (errors):**
```json
{ "success": false, "errors": ["..."] }
```

**Implementation pipeline:**
1. `expandToHqJson()` — compact JSON to full HQ import format
2. `autoFixer.fix()` — programmatic fixes (itext, reserved properties, missing binds)
3. `hqValidator.validate()` — safety net validation
4. `cczCompiler.compile()` — package into .ccz
5. Write files to `output_dir`

## Typical Usage Flow

```
User: "Build me a CommCare app for tracking prenatal visits"

Claude Code:
  1. Reads commcare://reference and commcare://compact-schema
  2. Generates compact JSON from user's description
  3. Calls validate_commcare_app(json)
     → Returns errors
  4. Fixes the JSON based on error messages
  5. Calls validate_commcare_app(fixed_json)
     → Returns { valid: true }
  6. Calls build_commcare_app(valid_json)
     → Returns { success: true, ccz_path: "...", hq_json_path: "..." }
  7. Reports success to user with file paths
```

## Configuration

User adds to `.mcp.json` or `~/.claude.json`:

```json
{
  "mcpServers": {
    "commcare-forge": {
      "command": "node",
      "args": ["/path/to/commcare-forge/mcp-server/dist/index.js"]
    }
  }
}
```

Build step: `npm run build:mcp` compiles TypeScript to `mcp-server/dist/`.

## What the Server Does NOT Do

- Call Claude's API (Claude Code is the LLM)
- Require an Anthropic API key
- Require Java
- Duplicate any backend logic (imports from `backend/src/`)
- Handle conversation or chat state
