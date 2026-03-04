import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readResource } from './resources.js'
import { handleValidate, handleBuild } from './tools.js'

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
    compact_json: z.record(z.string(), z.any()).describe('The compact app definition with app_name and modules array')
  },
  async ({ compact_json }) => {
    const result = await handleValidate({ compact_json: compact_json as any })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  }
)

server.tool(
  'build_commcare_app',
  'Builds a CommCare app from validated compact JSON. Writes .ccz and .hq.json to output_dir.',
  {
    compact_json: z.record(z.string(), z.any()).describe('A validated compact app definition'),
    output_dir: z.string().optional().describe('Output directory path. Defaults to ./commcare-output/')
  },
  async ({ compact_json, output_dir }) => {
    const result = await handleBuild({ compact_json: compact_json as any, output_dir })
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
