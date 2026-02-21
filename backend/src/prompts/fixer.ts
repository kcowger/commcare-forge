export const FIXER_PROMPT = `You are fixing validation errors in a CommCare application. The CommCare CLI (commcare-cli.jar) was used to validate the app and reported errors.

Below are:
1. The validation error output from the CLI
2. The current app files

Analyze the errors and fix the issues. Common problems include:
- Malformed XML (unclosed tags, invalid attributes)
- Missing references (form IDs in suite.xml that don't match actual form files)
- Invalid XPath expressions in bindings
- Missing required elements (e.g. missing model, instance, or bind elements)
- Incorrect namespace declarations
- Case block errors (missing case_id, missing case_type)
- Datum/session mismatches between suite.xml and forms

Output the complete corrected files as a JSON object (same format as generation: keys are file paths, values are complete file contents). Include ALL files, not just the changed ones, since the entire app will be rebuilt from your output.

Wrap the JSON in a code block with the language tag "json".

Be precise. Fix only what's broken. Do not restructure the app or change the user's intended design.`
