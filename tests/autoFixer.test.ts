import { describe, it, expect } from 'vitest'
import { AutoFixer } from '../backend/src/services/autoFixer'

const fixer = new AutoFixer()

function makeXForm(body: string, opts?: { itext?: string; binds?: string; instance?: string }): string {
  const instanceData = opts?.instance || '<name/>'
  const binds = opts?.binds || '<bind nodeset="/data/name" type="xsd:string"/>'
  const itextBlock = opts?.itext
    ? `<itext><translation lang="en" default="">${opts.itext}</translation></itext>`
    : ''
  return `<?xml version="1.0"?>
<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Test</h:title>
    <model>
      <instance>
        <data xmlns="http://openrosa.org/formdesigner/abc123" xmlns:jrm="http://dev.commcarehq.org/jr/xforms" uiVersion="1" version="1" name="test">${instanceData}</data>
      </instance>
      ${binds}
      ${itextBlock}
    </model>
  </h:head>
  <h:body>
${body}
  </h:body>
</h:html>`
}

describe('AutoFixer', () => {
  it('converts inline labels to itext references', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label>Patient Name</label>\n    </input>`
    )
    const { files, fixes } = fixer.fix({ 'modules-0/forms-0.xml': xform })
    const fixed = files['modules-0/forms-0.xml']
    expect(fixed).toContain("jr:itext('name-label')")
    expect(fixed).not.toContain('<label>Patient Name</label>')
    expect(fixed).toContain('<itext>')
    expect(fixed).toContain('Patient Name')
    expect(fixes.length).toBeGreaterThan(0)
  })

  it('converts inline item labels to itext references', () => {
    const xform = makeXForm(
      `    <select1 ref="/data/color">\n      <label>Color</label>\n      <item>\n        <label>Red</label>\n        <value>red</value>\n      </item>\n    </select1>`,
      { instance: '<color/>', binds: '<bind nodeset="/data/color" type="xsd:string"/>' }
    )
    const { files } = fixer.fix({ 'modules-0/forms-0.xml': xform })
    const fixed = files['modules-0/forms-0.xml']
    expect(fixed).toContain("jr:itext('color-red-label')")
  })

  it('renames reserved case property names', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><update><date/></update></case>',
        binds: '<bind nodeset="/data/name" type="xsd:string"/>\n      <bind nodeset="/data/case/update/date" calculate="/data/name"/>',
        itext: '<text id="name-label"><value>Name</value></text>'
      }
    )
    const { files, fixes } = fixer.fix({ 'modules-0/forms-0.xml': xform })
    const fixed = files['modules-0/forms-0.xml']
    expect(fixed).toContain('visit_date')
    expect(fixed).toContain('nodeset="/data/case/update/visit_date"')
    expect(fixes).toContainEqual(expect.stringContaining('Renamed'))
  })

  it('adds missing case create binds', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><create><case_type/><case_name/><owner_id/></create></case>',
        binds: '<bind nodeset="/data/name" type="xsd:string"/>',
        itext: '<text id="name-label"><value>Name</value></text>'
      }
    )
    const { files, fixes } = fixer.fix({ 'modules-0/forms-0.xml': xform })
    const fixed = files['modules-0/forms-0.xml']
    expect(fixed).toContain('nodeset="/data/case/create/case_type"')
    expect(fixed).toContain('nodeset="/data/case/create/case_name"')
    expect(fixed).toContain('nodeset="/data/case/create/owner_id"')
    expect(fixes.length).toBeGreaterThanOrEqual(3)
  })

  it('adds missing case update binds', () => {
    const xform = makeXForm(
      `    <input ref="/data/notes">\n      <label ref="jr:itext('notes-label')"/>\n    </input>`,
      {
        instance: '<notes/><case><update><visit_notes/></update></case>',
        binds: '<bind nodeset="/data/notes" type="xsd:string"/>',
        itext: '<text id="notes-label"><value>Notes</value></text>'
      }
    )
    const { files, fixes } = fixer.fix({ 'modules-0/forms-0.xml': xform })
    const fixed = files['modules-0/forms-0.xml']
    expect(fixed).toContain('nodeset="/data/case/update/visit_notes"')
    expect(fixes).toContainEqual(expect.stringContaining('visit_notes'))
  })

  it('adds missing app_strings entries for suite locale IDs', () => {
    const suiteXml = `<?xml version="1.0"?>
<suite version="1">
  <menu id="m0">
    <text><locale id="modules.m0"/></text>
    <command id="m0-f0"/>
  </menu>
</suite>`
    const { files, fixes } = fixer.fix({
      'suite.xml': suiteXml,
      'default/app_strings.txt': 'app.name=Test'
    })
    expect(files['default/app_strings.txt']).toContain('modules.m0=')
    expect(fixes).toContainEqual(expect.stringContaining('missing key'))
  })

  it('passes through already-valid files unchanged', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      { itext: '<text id="name-label"><value>Name</value></text>' }
    )
    const { files, fixes } = fixer.fix({ 'modules-0/forms-0.xml': xform })
    expect(fixes).toEqual([])
    expect(files['modules-0/forms-0.xml']).toBe(xform)
  })

  it('skips non-XForm files', () => {
    const { fixes } = fixer.fix({
      'suite.xml': '<suite/>',
      'media_suite.xml': '<suite/>',
      'profile.ccpr': '<profile/>'
    })
    expect(fixes).toEqual([])
  })
})
