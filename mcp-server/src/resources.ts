import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'

// Find repo root by walking up from __dirname looking for the docs directory.
// This works both in source (mcp-server/src/) and compiled output (mcp-server/dist/mcp-server/src/).
function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'docs', 'commcare-reference.md'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Could not find repo root from ' + startDir)
}

const REPO_ROOT = findRepoRoot(__dirname)

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
      uri: 'commcare://blueprint-schema',
      name: 'CommCare App Blueprint Schema',
      description: 'Specification for the app blueprint format used to define CommCare applications',
      mimeType: 'text/markdown'
    }
  ]
}

export function readResource(uri: string): string {
  switch (uri) {
    case 'commcare://reference':
      return readFileSync(resolve(REPO_ROOT, 'docs', 'commcare-reference.md'), 'utf-8')
    case 'commcare://blueprint-schema':
      return readFileSync(resolve(REPO_ROOT, 'docs', 'blueprint-schema.md'), 'utf-8')
    default:
      throw new Error(`Unknown resource URI: ${uri}`)
  }
}
