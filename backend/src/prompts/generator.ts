export const GENERATOR_PROMPT = `You are generating a complete CommCare application as a .ccz file structure. Based on the conversation and confirmed app specification, output the complete set of files needed.

A .ccz file is a ZIP containing:
- profile.xml — App profile and settings
- suite.xml — Module/form structure, menus, case list config
- media_suite.xml — Media references (can be empty/minimal)
- modules-{N}/forms-{N}.xml — XForm files for each form in each module

Output your response as a JSON object where:
- Keys are file paths (e.g. "profile.xml", "suite.xml", "modules-0/forms-0.xml")
- Values are the complete XML content for each file

The JSON must be valid and parseable. Wrap it in a code block with the language tag "json".

Requirements for the generated XML:

**profile.xml:**
- Must include app name, version, and required features
- Reference all form and suite resources

**suite.xml:**
- Define menus for each module
- Define entries (command, datum, session) for each form
- Define detail elements for case lists and case details
- Include proper assertions and locale references

**XForm files (modules-N/forms-N.xml):**
- Valid XForms 1.0 with CommCare extensions
- Proper data model with all fields
- Correct bindings with data types, relevance conditions, constraints, and calculations
- Proper case blocks for create/update/close operations
- Appropriate question types (input, select1, select)
- Labels for all questions

Follow CommCare XForm conventions:
- Namespace: xmlns="http://www.w3.org/2002/xforms"
- CommCare namespace: xmlns:cc="http://commcarehq.org/xforms"
- Data namespace should use a unique xmlns for the form
- Use jr:// protocol for resources
- Case operations use the case XML block format

Ensure all cross-references between suite.xml and form files are consistent (form IDs, menu IDs, datum IDs must match).`
