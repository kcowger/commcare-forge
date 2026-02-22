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
    const cczPath = await compiler.compile(minimalHqJson(), 'Test App')
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
    const cczPath = await compiler.compile(minimalHqJson(), 'My App')
    const zip = new AdmZip(cczPath)
    const profile = zip.readAsText('profile.ccpr')
    expect(profile).toContain('name="My App"')
    expect(profile).toContain('update="http://localhost/update"')
    expect(profile).toContain('<?xml')
  })

  it('generates suite.xml with menus, entries, and resources', async () => {
    const cczPath = await compiler.compile(minimalHqJson(), 'Test')
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
    const cczPath = await compiler.compile(minimalHqJson(), 'Test App')
    const zip = new AdmZip(cczPath)
    const strings = zip.readAsText('default/app_strings.txt')
    expect(strings).toContain('app.name=Test App')
    expect(strings).toContain('modules.m0=Registration')
    expect(strings).toContain('forms.m0f0=Register')
  })

  it('adds case blocks to XForms', async () => {
    const cczPath = await compiler.compile(minimalHqJson(), 'Test')
    const zip = new AdmZip(cczPath)
    const xform = zip.readAsText('modules-0/forms-0.xml')
    expect(xform).toContain('<case>')
    expect(xform).toContain('<create>')
    expect(xform).toContain('<case_type/>')
    expect(xform).toContain('<case_name/>')
    expect(xform).toContain('<owner_id/>')
  })

  it('includes case_name in case detail when not in columns', async () => {
    const cczPath = await compiler.compile(minimalHqJson(), 'Test')
    const zip = new AdmZip(cczPath)
    const suite = zip.readAsText('suite.xml')
    expect(suite).toContain('case_name')
  })

  it('escapes XML special characters in app name', async () => {
    const cczPath = await compiler.compile(minimalHqJson(), 'App & "Test" <1>')
    const zip = new AdmZip(cczPath)
    const profile = zip.readAsText('profile.ccpr')
    expect(profile).toContain('&amp;')
    expect(profile).toContain('&quot;')
    expect(profile).toContain('&lt;')
    expect(profile).toContain('&gt;')
  })

  it('sanitizes filename for CCZ', async () => {
    const cczPath = await compiler.compile(minimalHqJson(), 'My App! @#$')
    expect(cczPath).toContain('My_App____')
  })
})
