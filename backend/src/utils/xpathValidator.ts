/**
 * Lightweight XPath syntax checker for LLM-generated XPath expressions.
 *
 * This is NOT a full XPath parser — it catches common syntax errors that
 * LLMs frequently make when generating CommCare constraint/relevant/calculate
 * expressions. Returns warnings (not hard errors) since we can't fully parse
 * all valid XPath.
 */

export interface XPathWarning {
  expression: string
  message: string
}

/**
 * Check an XPath expression for common syntax errors.
 * Returns an array of warnings (empty = no issues found).
 */
export function validateXPath(expr: string): XPathWarning[] {
  const warnings: XPathWarning[] = []
  if (!expr || !expr.trim()) return warnings

  const trimmed = expr.trim()

  // 1. Balanced parentheses
  let parenDepth = 0
  for (const ch of trimmed) {
    if (ch === '(') parenDepth++
    else if (ch === ')') parenDepth--
    if (parenDepth < 0) break
  }
  if (parenDepth !== 0) {
    warnings.push({ expression: trimmed, message: 'Unbalanced parentheses' })
  }

  // 2. Balanced brackets
  let bracketDepth = 0
  for (const ch of trimmed) {
    if (ch === '[') bracketDepth++
    else if (ch === ']') bracketDepth--
    if (bracketDepth < 0) break
  }
  if (bracketDepth !== 0) {
    warnings.push({ expression: trimmed, message: 'Unbalanced brackets' })
  }

  // 3. Balanced quotes (single and double)
  const singleCount = (trimmed.match(/'/g) || []).length
  if (singleCount % 2 !== 0) {
    warnings.push({ expression: trimmed, message: 'Unbalanced single quotes' })
  }
  const doubleCount = (trimmed.match(/"/g) || []).length
  if (doubleCount % 2 !== 0) {
    warnings.push({ expression: trimmed, message: 'Unbalanced double quotes' })
  }

  // 4. == confusion (XPath uses = not ==)
  if (/[^!<>=]={2}[^=]/.test(trimmed) || trimmed.startsWith('==')) {
    warnings.push({ expression: trimmed, message: 'XPath uses "=" not "==" for equality comparison' })
  }

  // 5. Common invalid function names that LLMs use
  const invalidFunctions: Record<string, string> = {
    'length(': 'Use string-length() instead of length()',
    'substr(': 'Use substring() instead of substr()',
    'contains_text(': 'Use contains() instead of contains_text()',
    'parseInt(': 'Use number() instead of parseInt()',
    'parseFloat(': 'Use number() instead of parseFloat()',
    'toString(': 'Use string() instead of toString()',
    'toLowerCase(': 'XPath has no toLowerCase — use translate()',
    'toUpperCase(': 'XPath has no toUpperCase — use translate()',
    'Math.': 'XPath has no Math object — use floor(), ceiling(), round()',
    'Date(': 'XPath has no Date() — use today() or date()',
    'indexOf(': 'XPath has no indexOf — use contains() or substring-before/after()',
  }
  for (const [pattern, msg] of Object.entries(invalidFunctions)) {
    if (trimmed.includes(pattern)) {
      warnings.push({ expression: trimmed, message: msg })
    }
  }

  // 6. Empty predicate brackets []
  if (/\[\s*\]/.test(trimmed)) {
    warnings.push({ expression: trimmed, message: 'Empty predicate brackets []' })
  }

  // 7. Trailing/leading operators (common LLM error)
  if (/^\s*(and|or|div|mod)\b/.test(trimmed)) {
    warnings.push({ expression: trimmed, message: 'Expression starts with an operator' })
  }
  if (/\b(and|or|div|mod)\s*$/.test(trimmed)) {
    warnings.push({ expression: trimmed, message: 'Expression ends with an operator' })
  }

  return warnings
}
