import { describe, it, expect } from 'vitest'
import { HqValidator } from '../backend/src/services/hqValidator'

const validator = new HqValidator()

function makeXForm(body: string, opts?: { itext?: string; binds?: string; instance?: string }): string {
  const instanceData = opts?.instance || '<name/>'
  const binds = opts?.binds || '<bind nodeset="/data/name" type="xsd:string"/>'
  const itext = opts?.itext || `<text id="name-label"><value>Name</value></text>`
  return `<?xml version="1.0"?>
<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Test</h:title>
    <model>
      <instance>
        <data xmlns="http://openrosa.org/formdesigner/test123" xmlns:jrm="http://dev.commcarehq.org/jr/xforms" uiVersion="1" version="1" name="test">${instanceData}</data>
      </instance>
      ${binds}
      <itext>
        <translation lang="en" default="">
          ${itext}
        </translation>
      </itext>
    </model>
  </h:head>
  <h:body>
${body}
  </h:body>
</h:html>`
}

function validXForm(): string {
  return makeXForm(
    `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`
  )
}

function suiteXml(formXmlns: string): string {
  return `<?xml version="1.0"?>
<suite version="1">
  <entry>
    <form>${formXmlns}</form>
    <command id="m0-f0">
      <text><locale id="forms.m0f0"/></text>
    </command>
  </entry>
  <menu id="m0">
    <text><locale id="modules.m0"/></text>
    <command id="m0-f0"/>
  </menu>
</suite>`
}

function appStrings(): string {
  return 'forms.m0f0=Test Form\nmodules.m0=Test Module\napp.name=Test'
}

// --- itext validation ---

describe('HqValidator itext checks', () => {
  it('passes a valid XForm with proper itext', () => {
    const result = validator.validate({
      'modules-0/forms-0.xml': validXForm()
    })
    expect(result.errors).toEqual([])
  })

  it('errors on inline labels', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label>Patient Name</label>\n    </input>`
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining('inline label'))
  })

  it('errors on missing itext block', () => {
    const xform = `<?xml version="1.0"?>
<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <model>
      <instance><data xmlns="http://test/1"><name/></data></instance>
      <bind nodeset="/data/name" type="xsd:string"/>
    </model>
  </h:head>
  <h:body>
    <input ref="/data/name"><label ref="jr:itext('name-label')"/></input>
  </h:body>
</h:html>`
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining('missing <itext>'))
  })

  it('errors on missing itext definition for a reference', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('missing-label')"/>\n    </input>`,
      { itext: '<text id="name-label"><value>Name</value></text>' }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining("missing-label"))
  })
})

// --- Case validation ---

describe('HqValidator case checks', () => {
  it('errors on reserved case property in update block', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><update><date/></update></case>',
        binds: '<bind nodeset="/data/name" type="xsd:string"/>\n      <bind nodeset="/data/case/update/date" calculate="/data/name"/>'
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining('Reserved case property'))
  })

  it('errors on missing case create binds', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><create><case_type/><case_name/><owner_id/></create></case>',
        binds: '<bind nodeset="/data/name" type="xsd:string"/>'
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining('case_name'))
    expect(result.errors).toContainEqual(expect.stringContaining('case_type'))
    expect(result.errors).toContainEqual(expect.stringContaining('owner_id'))
  })

  it('errors on case update property without calculate bind', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><update><visit_notes/></update></case>',
        binds: '<bind nodeset="/data/name" type="xsd:string"/>'
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining('visit_notes'))
  })
})

// --- Cross-file validation ---

describe('HqValidator cross-file checks', () => {
  it('passes with consistent files', () => {
    const xmlns = 'http://openrosa.org/formdesigner/test123'
    const result = validator.validate({
      'modules-0/forms-0.xml': validXForm(),
      'suite.xml': suiteXml(xmlns),
      'default/app_strings.txt': appStrings()
    })
    expect(result.errors).toEqual([])
  })

  it('errors when suite references unknown xmlns', () => {
    const result = validator.validate({
      'modules-0/forms-0.xml': validXForm(),
      'suite.xml': suiteXml('http://unknown/xmlns'),
      'default/app_strings.txt': appStrings()
    })
    expect(result.errors).toContainEqual(expect.stringContaining('xmlns'))
  })

  it('errors when suite locale ID is missing from app_strings', () => {
    const result = validator.validate({
      'modules-0/forms-0.xml': validXForm(),
      'suite.xml': suiteXml('http://openrosa.org/formdesigner/test123'),
      'default/app_strings.txt': 'app.name=Test'
    })
    expect(result.errors).toContainEqual(expect.stringContaining('locale id'))
  })
})
