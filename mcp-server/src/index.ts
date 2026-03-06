/**
 * MCP server entry point — exposes CommCare app building as MCP tools.
 *
 * This lets any MCP-compatible LLM (Claude Desktop, Cursor, etc.) validate
 * and build CommCare apps by calling tools with structured blueprint JSON input.
 *
 * The tools use the shared Zod schema from `backend/src/schemas/blueprint.ts`,
 * so the LLM sees full field-level descriptions and type constraints in the
 * tool schema — no need to read a separate resource to understand the format.
 *
 * Resources (commcare://reference, commcare://blueprint-schema) are still
 * available for deeper reference when the LLM needs behavioral guidance
 * beyond what the schema descriptions provide.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readResource } from './resources.js'
import { handleValidate, handleBuild } from './tools.js'
import { appBlueprintSchema } from '../../backend/src/schemas/blueprint'

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
  'commcare-blueprint-schema',
  'commcare://blueprint-schema',
  { description: 'App Blueprint format specification for defining CommCare applications', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, text: readResource(uri.href), mimeType: 'text/markdown' }]
  })
)

// Register tools
server.tool(
  'validate_commcare_app',
  'Validates a CommCare app blueprint JSON definition. Returns { valid: true } or { valid: false, errors: [...] }.',
  {
    blueprint: appBlueprintSchema.describe('The app blueprint definition with app_name and modules array')
  },
  async ({ blueprint }) => {
    const result = await handleValidate({ blueprint })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  }
)

server.tool(
  'build_commcare_app',
  'Builds a CommCare app from a validated app blueprint. Writes .ccz and .hq.json to output_dir.',
  {
    blueprint: appBlueprintSchema.describe('A validated app blueprint definition'),
    output_dir: z.string().optional().describe('Output directory path. Defaults to ./commcare-output/')
  },
  async ({ blueprint, output_dir }) => {
    const result = await handleBuild({ blueprint, output_dir })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  }
)

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
