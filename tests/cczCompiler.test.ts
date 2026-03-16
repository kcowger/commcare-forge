import { describe, it, expect } from 'vitest'
import { CczCompiler } from '../backend/src/services/cczCompiler'
import AdmZip from 'adm-zip'
import { existsSync } from 'fs'

const compiler = new CczCompiler()

function minimalHqJson() {
  return {
    doc_type: 'Application',
    name: 'Test App',
    modules: [{
      name: { en: 'Registration' },
      case_type: 'patient',
      forms: [{
        name: { en: 'Register' },
        xmlns: 'http://openrosa.org/formdesigner/test1',
        unique_id: 'form_abc',
        requires: 'none',
        actions: {
          open_case: { condition: { type: 'always' }, name_update: { question_path: '/data/name' } },
          update_case: { condition: { type: 'never' }, update: {} }
        }
      }],
      case_details: {
        short: { columns: [{ field: 'visit_age', header: { en: 'Age' } }] },
        long: { columns: [] }
      }
    }],
    _attachments: {
      'form_abc.xml': `<?xml version="1.0"?>
<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <model>
      <instance>
        <data xmlns="http://openrosa.org/formdesigner/test1"><name/></data>
      </instance>
      <bind nodeset="/data/name" type="xsd:string"/>
      <itext><translation lang="en" default="">
        <text id="name-label"><value>Name</value></text>
      </translation></itext>
    </model>
  </h:head>
  <h:body>
    <input ref="/data/name"><label ref="jr:itext('name-label')"/></input>
  </h:body>
</h:html>`
    }
  }
}

describe('CczCompiler', () => {
  it('produces a valid CCZ file', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'Test App')
    expect(existsSync(cczPath)).toBe(true)
    expect(cczPath).toContain('.ccz')
    // Verify it's a valid zip
    const zip = new AdmZip(cczPath)
    const entries = zip.getEntries().map(e => e.entryName)
    expect(entries).toContain('profile.ccpr')
    expect(entries).toContain('suite.xml')
    expect(entries).toContain('default/app_strings.txt')
  })

  it('generates profile.ccpr with correct app name', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'My App')
    const zip = new AdmZip(cczPath)
    const profile = zip.readAsText('profile.ccpr')
    expect(profile).toContain('name="My App"')
    expect(profile).toContain('update="http://localhost/update"')
    expect(profile).toContain('<?xml')
  })

  it('generates suite.xml with menus, entries, and resources', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'Test')
    const zip = new AdmZip(cczPath)
    const suite = zip.readAsText('suite.xml')
    expect(suite).toContain('<menu id="m0">')
    expect(suite).toContain('<entry>')
    expect(suite).toContain('<form>http://openrosa.org/formdesigner/test1</form>')
    expect(suite).toContain('<xform>')
    expect(suite).toContain('<locale id="forms.m0f0"/>')
    expect(suite).toContain('<locale id="modules.m0"/>')
  })

  it('generates app_strings.txt with all required keys', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'Test App')
    const zip = new AdmZip(cczPath)
    const strings = zip.readAsText('default/app_strings.txt')
    expect(strings).toContain('app.name=Test App')
    expect(strings).toContain('modules.m0=Registration')
    expect(strings).toContain('forms.m0f0=Register')
  })

  it('adds case blocks to XForms', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'Test')
    const zip = new AdmZip(cczPath)
    const xform = zip.readAsText('modules-0/forms-0.xml')
    expect(xform).toContain('<case>')
    expect(xform).toContain('<create>')
    // DOM serializer may produce <tag></tag> or <tag/> — both are valid XML
    expect(xform).toMatch(/<case_type\s*\/?>/)
    expect(xform).toMatch(/<case_name\s*\/?>/)
    expect(xform).toMatch(/<owner_id\s*\/?>/)

  })

  it('includes case_name in case detail when not in columns', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'Test')
    const zip = new AdmZip(cczPath)
    const suite = zip.readAsText('suite.xml')
    expect(suite).toContain('case_name')
  })

  it('escapes XML special characters in app name', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'App & "Test" <1>')
    const zip = new AdmZip(cczPath)
    const profile = zip.readAsText('profile.ccpr')
    expect(profile).toContain('&amp;')
    expect(profile).toContain('&quot;')
    expect(profile).toContain('&lt;')
    expect(profile).toContain('&gt;')
  })

  it('sanitizes filename for CCZ', async () => {
    const { cczPath } = await compiler.compile(minimalHqJson(), 'My App! @#$')
    expect(cczPath).toContain('My_App____')
  })

  it('generates per-language app_strings for multi-lang apps', async () => {
    const hq = minimalHqJson()
    hq.langs = ['en', 'fr']
    hq.modules[0].name = { en: 'Registration', fr: 'Inscription' }
    hq.modules[0].forms[0].name = { en: 'Register', fr: 'Inscrire' }
    const { cczPath } = await compiler.compile(hq, 'Test App')
    const zip = new AdmZip(cczPath)
    // Default (en) app_strings
    const enStrings = zip.readAsText('default/app_strings.txt')
    expect(enStrings).toContain('modules.m0=Registration')
    expect(enStrings).toContain('forms.m0f0=Register')
    // French app_strings
    const frStrings = zip.readAsText('fr/app_strings.txt')
    expect(frStrings).toContain('modules.m0=Inscription')
    expect(frStrings).toContain('forms.m0f0=Inscrire')
  })

  it('includes fixture files and suite declarations for lookup tables', async () => {
    const hq = minimalHqJson()
    hq._attachments['fixture:facilities'] = `<?xml version="1.0"?>
<fixture id="item-list:facilities" user_id="">
  <facilities_list>
    <item><id>f1</id><name>Clinic A</name></item>
  </facilities_list>
</fixture>`
    const { cczPath } = await compiler.compile(hq, 'Test')
    const zip = new AdmZip(cczPath)
    // Fixture file should be in the CCZ
    const fixtureXml = zip.readAsText('fixtures/facilities.xml')
    expect(fixtureXml).toContain('Clinic A')
    // Suite should reference the fixture
    const suite = zip.readAsText('suite.xml')
    expect(suite).toContain('fixture-facilities')
    expect(suite).toContain('./fixtures/facilities.xml')
  })

  it('generates locale resources for each language in suite.xml', async () => {
    const hq = minimalHqJson()
    hq.langs = ['en', 'fr']
    hq.modules[0].name = { en: 'Registration', fr: 'Inscription' }
    hq.modules[0].forms[0].name = { en: 'Register', fr: 'Inscrire' }
    const { cczPath } = await compiler.compile(hq, 'Test App')
    const zip = new AdmZip(cczPath)
    const suite = zip.readAsText('suite.xml')
    expect(suite).toContain('./default/app_strings.txt')
    expect(suite).toContain('./fr/app_strings.txt')
  })
})
