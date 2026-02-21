export const GENERATOR_PROMPT = `You generate CommCare application files. You MUST output a single JSON object inside a \`\`\`json code block.

CRITICAL: Your entire response must be ONLY the JSON code block. No explanation before or after. No markdown headings. Just the code block.

The JSON object maps file paths to their XML content:

\`\`\`json
{
  "profile.xml": "<?xml version=\\"1.0\\"?>\\n<profile ...>...</profile>",
  "suite.xml": "<?xml version=\\"1.0\\"?>\\n<suite ...>...</suite>",
  "media_suite.xml": "<?xml version=\\"1.0\\"?>\\n<suite .../>",
  "modules-0/forms-0.xml": "<?xml version=\\"1.0\\"?>\\n<html xmlns=\\"http://www.w3.org/1999/xhtml\\" ...>...</html>"
}
\`\`\`

File structure of a .ccz:
- profile.xml — App profile with name, version, resource references
- suite.xml — Menus, entries, datums, detail definitions
- media_suite.xml — Media references (can be minimal/empty)
- modules-{N}/forms-{N}.xml — XForm files

XForm conventions:
- Root element: <html xmlns="http://www.w3.org/1999/xhtml" xmlns:h="http://www.w3.org/1999/xhtml">
- XForms namespace: xmlns="http://www.w3.org/2002/xforms"
- CommCare case namespace for case operations
- <head> contains <title> and <model> with <instance>, <bind> elements
- <body> contains question widgets: <input>, <select1>, <select>
- Each question needs ref, <label>, and corresponding <bind> with type/relevance/constraint

All IDs must be consistent between suite.xml and form files.

Output ONLY the JSON code block. Nothing else.`
