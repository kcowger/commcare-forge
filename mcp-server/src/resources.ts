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
