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

// --- Case path consistency ---

describe('HqValidator case path consistency', () => {
  it('passes when case update calculate paths match real bind nodesets', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><create><case_type/><case_name/><owner_id/></create><update><patient_name/></update></case>',
        binds: [
          '<bind nodeset="/data/name" type="xsd:string"/>',
          '<bind nodeset="/data/case/create/case_type" calculate="\'patient\'"/>',
          '<bind nodeset="/data/case/create/case_name" calculate="/data/name"/>',
          '<bind nodeset="/data/case/create/owner_id" calculate="instance(\'commcaresession\')/session/context/userid"/>',
          '<bind nodeset="/data/case/update/patient_name" calculate="/data/name"/>'
        ].join('\n      ')
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toEqual([])
  })

  it('errors when case update calculate references a non-existent path', () => {
    const xform = makeXForm(
      `    <input ref="/data/info_group/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<info_group><name/></info_group><case><update><patient_name/></update></case>',
        binds: [
          '<bind nodeset="/data/info_group/name" type="xsd:string"/>',
          '<bind nodeset="/data/case/update/patient_name" calculate="/data/name"/>'
        ].join('\n      ')
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toContainEqual(expect.stringContaining('patient_name'))
    expect(result.errors).toContainEqual(expect.stringContaining('/data/name'))
  })

  it('passes when case update correctly references grouped question path', () => {
    const xform = makeXForm(
      `    <input ref="/data/info_group/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<info_group><name/></info_group><case><update><patient_name/></update></case>',
        binds: [
          '<bind nodeset="/data/info_group/name" type="xsd:string"/>',
          '<bind nodeset="/data/case/update/patient_name" calculate="/data/info_group/name"/>'
        ].join('\n      ')
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toEqual([])
  })

  it('ignores literal calculate values in case create binds', () => {
    const xform = makeXForm(
      `    <input ref="/data/name">\n      <label ref="jr:itext('name-label')"/>\n    </input>`,
      {
        instance: '<name/><case><create><case_type/><case_name/><owner_id/></create></case>',
        binds: [
          '<bind nodeset="/data/name" type="xsd:string"/>',
          '<bind nodeset="/data/case/create/case_type" calculate="\'patient\'"/>',
          '<bind nodeset="/data/case/create/case_name" calculate="/data/name"/>',
          '<bind nodeset="/data/case/create/owner_id" calculate="instance(\'commcaresession\')/session/context/userid"/>'
        ].join('\n      ')
      }
    )
    const result = validator.validate({ 'modules-0/forms-0.xml': xform })
    expect(result.errors).toEqual([])
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

// --- HQ JSON Structure Validation ---

function validHqJson(): Record<string, any> {
  return {
    doc_type: 'Application',
    application_version: '2.0',
    name: 'Test',
    langs: ['en'],
    modules: [{
      doc_type: 'Module',
      module_type: 'basic',
      unique_id: 'mod1',
      name: { en: 'Test Module' },
      case_type: 'patient',
      forms: [{
        doc_type: 'Form',
        form_type: 'module_form',
        unique_id: 'form1',
        xmlns: 'http://test/1',
        name: { en: 'Register' },
        requires: 'none',
        actions: {
          doc_type: 'FormActions',
          open_case: {
            doc_type: 'OpenCaseAction',
            name_update: { question_path: '/data/name' },
            condition: { type: 'always', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' }
          },
          update_case: {
            doc_type: 'UpdateCaseAction',
            update: {},
            condition: { type: 'never', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' }
          },
          close_case: {
            doc_type: 'FormAction',
            condition: { type: 'never', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' }
          },
          case_preload: {
            doc_type: 'PreloadAction',
            preload: {},
            condition: { type: 'never', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' }
          },
          subcases: []
        }
      }],
      case_details: {
        doc_type: 'DetailPair',
        short: { doc_type: 'Detail', columns: [{ field: 'case_name', header: { en: 'Name' } }] },
        long: { doc_type: 'Detail', columns: [] }
      }
    }],
    _attachments: {
      'form1.xml': '<h:html xmlns:h="http://www.w3.org/1999/xhtml"><h:head><model></model></h:head><h:body></h:body></h:html>'
    }
  }
}

describe('HqValidator HQ JSON structure', () => {
  it('passes valid HQ JSON', () => {
    const result = validator.validateHqJsonStructure(validHqJson())
    expect(result.errors).toEqual([])
  })

  it('errors on wrong Application doc_type', () => {
    const hq = validHqJson()
    hq.doc_type = 'Wrong'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('Application'))
  })

  it('errors on missing modules', () => {
    const hq = validHqJson()
    delete hq.modules
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('modules'))
  })

  it('errors on wrong Form doc_type', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].doc_type = 'BadForm'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('Form'))
  })

  it('errors on invalid form_type', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].form_type = 'invalid_form'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('form_type'))
  })

  it('errors on missing attachment for form', () => {
    const hq = validHqJson()
    hq._attachments = {}
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('form1.xml'))
  })

  it('errors on invalid condition type', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].actions.open_case.condition.type = 'bad'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('condition'))
  })

  it('errors on missing condition doc_type', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].actions.open_case.condition.doc_type = 'Bad'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('FormActionCondition'))
  })

  it('errors on update_case without open/require (rule 5.6)', () => {
    const hq = validHqJson()
    // Set update to always but open to never, requires=none
    hq.modules[0].forms[0].actions.update_case.condition.type = 'always'
    hq.modules[0].forms[0].actions.open_case.condition.type = 'never'
    hq.modules[0].forms[0].requires = 'none'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('rule 5.6'))
  })

  it('passes update_case when form requires case', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].actions.update_case.condition.type = 'always'
    hq.modules[0].forms[0].actions.open_case.condition.type = 'never'
    hq.modules[0].forms[0].requires = 'case'
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toEqual([])
  })

  it('errors on case module with no detail columns (rule 2.2)', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].requires = 'case'
    hq.modules[0].case_details.short.columns = []
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('detail columns'))
  })

  it('errors on reserved word in update_case', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].actions.update_case.update = { case_name: { question_path: '/data/name' } }
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('reserved'))
  })

  it('errors on invalid subcase relationship', () => {
    const hq = validHqJson()
    hq.modules[0].forms[0].actions.subcases = [{
      doc_type: 'OpenSubCaseAction',
      case_type: 'visit',
      name_update: { question_path: '/data/name' },
      relationship: 'invalid',
      condition: { type: 'always', question: null, answer: null, operator: null, doc_type: 'FormActionCondition' },
      case_properties: {}
    }]
    const result = validator.validateHqJsonStructure(hq)
    expect(result.errors).toContainEqual(expect.stringContaining('relationship'))
  })
})

// --- CCZ File Validation ---

describe('HqValidator CCZ file checks', () => {
  it('passes valid CCZ files', () => {
    const result = validator.validateCczFiles({
      'suite.xml': '<suite><entry><form>test</form><command id="m0-f0"/></entry><menu id="m0"><command id="m0-f0"/></menu><locale id="app.name"/></suite>',
      'profile.ccpr': '<profile uniqueid="abc"><suite>suite.xml</suite></profile>',
      'default/app_strings.txt': 'app.name=Test',
      'modules-0/forms-0.xml': '<h:html/>'
    })
    expect(result.errors).toEqual([])
  })

  it('errors on missing suite.xml', () => {
    const result = validator.validateCczFiles({
      'profile.ccpr': '<profile uniqueid="abc"><suite>suite.xml</suite></profile>',
      'default/app_strings.txt': 'app.name=Test',
      'modules-0/forms-0.xml': '<h:html/>'
    })
    expect(result.errors).toContainEqual(expect.stringContaining('suite.xml'))
  })

  it('errors on missing profile.ccpr', () => {
    const result = validator.validateCczFiles({
      'suite.xml': '<suite><entry/><menu id="m0"/><locale id="x"/></suite>',
      'default/app_strings.txt': 'app.name=Test',
      'modules-0/forms-0.xml': '<h:html/>'
    })
    expect(result.errors).toContainEqual(expect.stringContaining('profile'))
  })

  it('errors on missing app_strings.txt', () => {
    const result = validator.validateCczFiles({
      'suite.xml': '<suite><entry/><menu id="m0"/><locale id="x"/></suite>',
      'profile.ccpr': '<profile uniqueid="abc"><suite>suite.xml</suite></profile>',
      'modules-0/forms-0.xml': '<h:html/>'
    })
    expect(result.errors).toContainEqual(expect.stringContaining('app_strings'))
  })

  it('errors on no XForm files', () => {
    const result = validator.validateCczFiles({
      'suite.xml': '<suite><entry/><menu id="m0"/><locale id="x"/></suite>',
      'profile.ccpr': '<profile uniqueid="abc"><suite>suite.xml</suite></profile>',
      'default/app_strings.txt': 'app.name=Test'
    })
    expect(result.errors).toContainEqual(expect.stringContaining('XForm'))
  })

  it('errors on suite.xml missing entries', () => {
    const result = validator.validateCczFiles({
      'suite.xml': '<suite></suite>',
      'profile.ccpr': '<profile uniqueid="abc"><suite>suite.xml</suite></profile>',
      'default/app_strings.txt': 'app.name=Test',
      'modules-0/forms-0.xml': '<h:html/>'
    })
    expect(result.errors).toContainEqual(expect.stringContaining('entry'))
  })
})
