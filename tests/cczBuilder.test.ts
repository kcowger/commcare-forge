import { describe, it, expect } from 'vitest'
import { CczBuilder } from '../backend/src/services/cczBuilder'
import { CczParser } from '../backend/src/services/cczParser'
import { existsSync } from 'fs'

const builder = new CczBuilder()
const parser = new CczParser()

describe('CczBuilder', () => {
  it('builds a valid CCZ file from a file map', async () => {
    const files = {
      'profile.ccpr': '<profile name="Test"/>',
      'suite.xml': '<suite version="1"/>',
      'default/app_strings.txt': 'app.name=Test'
    }
    const cczPath = await builder.build(files, 'Test')
    expect(existsSync(cczPath)).toBe(true)
    expect(cczPath).toMatch(/\.ccz$/)
  })

  it('round-trips files through build and parse', async () => {
    const files = {
      'profile.ccpr': '<?xml version="1.0"?><profile name="Round Trip Test"/>',
      'suite.xml': '<?xml version="1.0"?><suite version="1"/>',
      'default/app_strings.txt': 'app.name=Round Trip\nmodules.m0=Mod A'
    }
    const cczPath = await builder.build(files, 'Round Trip Test')
    const parsed = parser.parse(cczPath)

    expect(parsed.files['profile.ccpr']).toBe(files['profile.ccpr'])
    expect(parsed.files['suite.xml']).toBe(files['suite.xml'])
    expect(parsed.files['default/app_strings.txt']).toBe(files['default/app_strings.txt'])
  })

  it('sanitizes special characters in output filename', async () => {
    const cczPath = await builder.build({ 'suite.xml': '<suite/>' }, 'Test App! @#$')
    expect(cczPath).toContain('Test_App____')
    expect(cczPath).toMatch(/\.ccz$/)
  })
})

describe('CczParser', () => {
  it('extracts app name from profile', async () => {
    const cczPath = await builder.build({
      'profile.ccpr': '<?xml version="1.0"?><profile name="My App"/>',
      'suite.xml': '<suite version="1"/>'
    }, 'test')
    const parsed = parser.parse(cczPath)
    expect(parsed.appName).toBe('My App')
  })

  it('generates markdown summary', async () => {
    const cczPath = await builder.build({
      'profile.ccpr': '<?xml version="1.0"?><profile name="Summary Test"/>',
      'suite.xml': `<?xml version="1.0"?><suite version="1">
        <menu id="m0"><text><locale id="modules.m0"/></text><command id="m0-f0"/></menu>
      </suite>`,
      'default/app_strings.txt': 'modules.m0=Patient Registration\nforms.m0f0=Register'
    }, 'test')
    const parsed = parser.parse(cczPath)
    expect(parsed.markdownSummary).toContain('Summary Test')
    expect(parsed.markdownSummary).toContain('Patient Registration')
  })

  it('only reads text file extensions', async () => {
    const cczPath = await builder.build({
      'profile.ccpr': '<profile name="Test"/>',
      'suite.xml': '<suite/>',
      'binary.dat': 'binary data here'
    }, 'test')
    const parsed = parser.parse(cczPath)
    expect(parsed.files['profile.ccpr']).toBeDefined()
    expect(parsed.files['suite.xml']).toBeDefined()
    expect(parsed.files['binary.dat']).toBeUndefined()
  })
})
