import React, { useState, useMemo } from 'react'

interface TreeModule {
  name: string
  caseType?: string
  forms: TreeForm[]
}

interface TreeForm {
  name: string
  type?: string
  details: string[]
}

function parseSpec(spec: string): TreeModule[] {
  const modules: TreeModule[] = []
  const lines = spec.split('\n')
  let currentModule: TreeModule | null = null
  let currentForm: TreeForm | null = null
  let inCaseTypes = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect ## Case Types section — stop adding modules
    if (/^##\s+Case\s+Type/i.test(trimmed)) {
      inCaseTypes = true
      // Parse case types and associate with modules
      for (let j = i + 1; j < lines.length; j++) {
        const ctLine = lines[j].trim()
        if (/^##\s/.test(ctLine) && !/^###/.test(ctLine)) break
        // Match "**case_type_name**" or "### case_type_name" or "- **name**: ..."
        const ctMatch = ctLine.match(/(?:\*\*|###?\s+)(\w[\w_-]*)(?:\*\*)?/)
        if (ctMatch) {
          const caseName = ctMatch[1]
          // Try to find which module uses this case type
          for (const mod of modules) {
            if (mod.name.toLowerCase().replace(/\s+/g, '_').includes(caseName) ||
                caseName.includes(mod.name.toLowerCase().replace(/\s+/g, '_')) ||
                mod.name.toLowerCase().includes(caseName.replace(/_/g, ' '))) {
              mod.caseType = caseName
            }
          }
        }
      }
      continue
    }

    if (inCaseTypes) continue

    // ## Modules heading — skip it
    if (/^##\s+Modules?\s*$/i.test(trimmed)) continue

    // ### N. ModuleName or ### ModuleName — new module
    if (/^###\s+/.test(trimmed) && !/^####/.test(trimmed)) {
      const name = trimmed.replace(/^###\s+(\d+\.\s*)?/, '').trim()
      if (name) {
        currentModule = { name, forms: [] }
        currentForm = null
        modules.push(currentModule)

        // Check for case_type in same line or nearby: (case_type: xxx) or case type: xxx
        const caseMatch = trimmed.match(/case[_\s]type[:\s]+[`*]*(\w[\w_-]*)[`*]*/i)
        if (caseMatch) currentModule.caseType = caseMatch[1]
      }
      continue
    }

    // #### FormName — new form
    if (/^####\s+/.test(trimmed) && currentModule) {
      const name = trimmed.replace(/^####\s+(\d+\.\s*)?/, '').trim()
      if (name) {
        currentForm = { name, details: [] }
        currentModule.forms.push(currentForm)

        const typeMatch = name.match(/\((registration|followup|follow-up|survey|intake)\)/i)
        if (typeMatch) currentForm.type = typeMatch[1].toLowerCase()
      }
      continue
    }

    // **FormName** on its own line (alternate form heading pattern)
    if (/^\*\*[^*]+\*\*\s*$/.test(trimmed) && currentModule && !currentForm) {
      const name = trimmed.replace(/\*\*/g, '').trim()
      if (name) {
        currentForm = { name, details: [] }
        currentModule.forms.push(currentForm)
      }
      continue
    }

    // - **FormName**: description (form as a bold list item under module)
    if (/^-\s+\*\*[^*]+\*\*/.test(trimmed) && currentModule) {
      const match = trimmed.match(/^-\s+\*\*([^*]+)\*\*(.*)/)
      if (match) {
        const name = match[1].trim()
        currentForm = { name, details: [] }
        currentModule.forms.push(currentForm)

        const typeMatch = name.match(/\((registration|followup|follow-up|survey|intake)\)/i)
        if (typeMatch) currentForm.type = typeMatch[1].toLowerCase()

        // If there's description after the bold name, add it as a detail
        const desc = match[2].replace(/^[:\s-]+/, '').trim()
        if (desc) currentForm.details.push(desc)
      }
      continue
    }

    // Check for case_type mention on module-level lines
    if (currentModule && !currentModule.caseType) {
      const caseMatch = trimmed.match(/case[_\s]type[:\s]+[`*]*(\w[\w_-]*)[`*]*/i)
      if (caseMatch) currentModule.caseType = caseMatch[1]
    }

    // List items as details for current form
    if (/^-\s+/.test(trimmed) && currentForm) {
      const detail = trimmed.replace(/^-\s+/, '').trim()
      if (detail) currentForm.details.push(detail)
    }
  }

  return modules
}

interface AppPreviewTreeProps {
  spec: string
}

export default function AppPreviewTree({ spec }: AppPreviewTreeProps) {
  const modules = useMemo(() => parseSpec(spec), [spec])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (modules.length === 0) return null

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const totalForms = modules.reduce((sum, m) => sum + m.forms.length, 0)

  return (
    <div className="px-5 py-3 border-b border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent/70">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
        <span className="text-xs font-medium text-white/50">
          {modules.length} module{modules.length !== 1 ? 's' : ''}, {totalForms} form{totalForms !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-0.5">
        {modules.map((mod, mIdx) => {
          const modKey = `m${mIdx}`
          const isModExpanded = expanded[modKey]

          return (
            <div key={modKey}>
              <button
                onClick={() => toggle(modKey)}
                className="flex items-center gap-1.5 w-full text-left py-0.5 group"
              >
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
                  className={`text-white/30 transition-transform ${isModExpanded ? 'rotate-90' : ''}`}
                >
                  <path d="M8 5l8 7-8 7z" />
                </svg>
                <span className="text-xs font-medium text-white/80 group-hover:text-white transition-colors">
                  {mod.name}
                </span>
                {mod.caseType && (
                  <span className="text-[10px] text-accent/60 ml-1">
                    case: {mod.caseType}
                  </span>
                )}
                <span className="text-[10px] text-white/30 ml-auto">
                  {mod.forms.length} form{mod.forms.length !== 1 ? 's' : ''}
                </span>
              </button>

              {isModExpanded && (
                <div className="ml-4 border-l border-white/5 pl-2 space-y-0.5">
                  {mod.forms.map((form, fIdx) => {
                    const formKey = `m${mIdx}f${fIdx}`
                    const isFormExpanded = expanded[formKey]

                    return (
                      <div key={formKey}>
                        <button
                          onClick={() => form.details.length > 0 ? toggle(formKey) : undefined}
                          className={`flex items-center gap-1.5 w-full text-left py-0.5 group ${form.details.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          {form.details.length > 0 ? (
                            <svg
                              width="8" height="8" viewBox="0 0 24 24" fill="currentColor"
                              className={`text-white/20 transition-transform ${isFormExpanded ? 'rotate-90' : ''}`}
                            >
                              <path d="M8 5l8 7-8 7z" />
                            </svg>
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-white/10 flex-shrink-0" />
                          )}
                          <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors">
                            {form.name.replace(/\s*\([^)]*\)\s*$/, '')}
                          </span>
                          {form.type && (
                            <span className="text-[10px] text-white/25">{form.type}</span>
                          )}
                          {form.details.length > 0 && (
                            <span className="text-[10px] text-white/20 ml-auto">
                              {form.details.length} item{form.details.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </button>

                        {isFormExpanded && (
                          <div className="ml-4 pl-2 border-l border-white/5">
                            {form.details.map((detail, dIdx) => (
                              <div key={dIdx} className="text-[11px] text-white/35 py-px leading-relaxed truncate">
                                {detail.replace(/\*\*/g, '')}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {mod.forms.length === 0 && (
                    <div className="text-[11px] text-white/25 py-0.5 italic">No forms listed</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
