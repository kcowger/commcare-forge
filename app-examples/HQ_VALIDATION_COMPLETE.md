# Complete CommCare HQ Build Validation Audit

**Source**: `commcare-hq-master/corehq/apps/app_manager/`
**Date**: 2026-03-18
**Purpose**: Every code path that can block `make_build()` or `create_all_files()`

---

## How HQ Builds Work (The Pipeline)

```
make_build()
  ├── copy.validate_app()                    ← ApplicationValidator.validate_app()
  │   ├── Check empty langs
  │   ├── _check_modules()                   ← module.validate_for_build() for each module
  │   ├── _check_forms()                     ← form.validate_for_build() for each form
  │   ├── Check ModuleIdMissing
  │   ├── Check parent_select dependency cycle
  │   ├── _child_module_errors()             ← root_module cycle + unknown root
  │   ├── _check_subscription()
  │   ├── _validate_fixtures()
  │   ├── _validate_intents()
  │   ├── _validate_practice_users()
  │   └── self.app.create_all_files()        ← SUITE GENERATION (errors caught as exceptions)
  │       ├── SuiteGenerator.generate_suite() ← entries, menus, details, workflow, instances
  │       ├── Form.render_xform()            ← XForm rendering & case XML generation
  │       └── MediaSuiteGenerator
  ├── If errors → raise AppValidationError   ← BUILD BLOCKED
  └── copy.create_build_files()              ← attachments
```

**Key insight**: There are TWO categories of validation:
1. **Pre-flight validators** (validators.py) — return error dicts, collected into a list
2. **Suite generation exceptions** (entries.py, menus.py, details.py, workflow.py, instances.py, xform.py) — raise exceptions that get caught by `validate_app()` and converted to `{'type': 'error', 'message': str(e)}`

---

## SECTION A: Application-Level Validators
**File**: `helpers/validators.py` → `ApplicationValidator`

### A1. Empty language
| Error Type | `empty lang` |
|---|---|
| **Trigger** | Any lang in `app.langs` is empty/falsy |
| **Message** | (type only) |
| **Forge Check** | YES — checks `langs` is non-empty array |

### A2. No modules
| Error Type | `no modules` |
|---|---|
| **Trigger** | `app.modules` is empty |
| **Message** | (type only) |
| **Forge Check** | YES — `Application has no modules (HQ rule 1.2)` |

### A3. Module ID missing
| Error Type | `ModuleIdMissingException` (raised, not dict) |
|---|---|
| **Trigger** | Any module has no `unique_id` |
| **Message** | Exception |
| **Forge Check** | YES — checks `unique_id` required on modules |

### A4. Parent select dependency cycle
| Error Type | `parent cycle` |
|---|---|
| **Trigger** | Circular reference in `parent_select.module_id` chain |
| **Message** | (type only) |
| **Forge Check** | NO |

### A5. Root module dependency cycle
| Error Type | `root cycle` |
|---|---|
| **Trigger** | Circular reference in `root_module_id` chain |
| **Message** | (type only) |
| **Forge Check** | NO |

### A6. Unknown root module
| Error Type | `unknown root` |
|---|---|
| **Trigger** | A module's `root_module_id` references a `unique_id` that doesn't exist |
| **Message** | (type only) |
| **Forge Check** | NO |

### A7. Duplicate xmlns
| Error Type | `duplicate xmlns` |
|---|---|
| **Trigger** | Two non-shadow forms share the same `xmlns` |
| **Message** | `{"type": "duplicate xmlns", "xmlns": ...}` |
| **Forge Check** | YES — cross-file check on xmlns uniqueness |

### A8. Subscription: Usercase
| Error Type | `subscription` |
|---|---|
| **Trigger** | App uses usercase but domain lacks `USERCASE` privilege |
| **Message** | "Your application is using User Properties..." |
| **Forge Check** | NO (subscription/privilege check) |

### A9. Fixtures privilege
| Error Type | `error` |
|---|---|
| **Trigger** | Form uses fixtures but domain lacks `LOOKUP_TABLES` privilege |
| **Message** | "Usage of lookup tables is not supported..." |
| **Forge Check** | NO (subscription check) |

### A10. Intents privilege
| Error Type | `error` |
|---|---|
| **Trigger** | Form uses ODK intents without `CUSTOM_INTENTS` or `TEMPLATED_INTENTS` privilege |
| **Message** | "Usage of integrations is not supported..." |
| **Forge Check** | NO (subscription check) |

### A11. Practice user config
| Error Type | `practice user config error` |
|---|---|
| **Trigger** | `enable_practice_users` is true but practice user misconfigured |
| **Message** | (from PracticeUserException) |
| **Forge Check** | NO (not relevant to Forge-generated apps) |

---

## SECTION B: Module-Level Validators
**File**: `helpers/validators.py` → `ModuleBaseValidator`, `ModuleValidator`, `AdvancedModuleValidator`, `ShadowModuleValidator`

### B1. No case type
| Error Type | `no case type` |
|---|---|
| **Trigger** | Module needs a case type (has case-requiring forms or registration forms) but `module.case_type` is empty |
| **Message** | (type only) |
| **Forge Check** | PARTIAL — checks `case_type` field exists when forms require cases |

### B2. No case detail (short columns)
| Error Type | `no case detail` |
|---|---|
| **Trigger** | Module needs case details but `case_details.short.columns` is empty |
| **Message** | (type only) |
| **Forge Check** | YES — "Module requires cases but has no case detail columns" |

### B3. No product detail
| Error Type | `no product detail` |
|---|---|
| **Trigger** | CommTrack enabled, form shows product stock, but product_details.short.columns empty |
| **Message** | (type only) |
| **Forge Check** | NO (CommTrack not supported) |

### B4. No ref detail
| Error Type | `no ref detail` |
|---|---|
| **Trigger** | Form requires referral but `ref_details.short.columns` is empty |
| **Message** | (type only) |
| **Forge Check** | NO (referrals not supported) |

### B5. No forms or case list
| Error Type | `no forms or case list` |
|---|---|
| **Trigger** | Module (basic or advanced) has no forms AND `case_list.show` is false |
| **Message** | (type only) |
| **Forge Check** | NO |

### B6. Case list form missing
| Error Type | `case list form missing` |
|---|---|
| **Trigger** | `module.case_list_form.form_id` set but form not found in app |
| **Message** | (type only) |
| **Forge Check** | NO |

### B7. Case list form not registration
| Error Type | `case list form not registration` |
|---|---|
| **Trigger** | Case list form is set but the form doesn't register the module's case type |
| **Message** | (type only) |
| **Forge Check** | NO |

### B8. Invalid case list followup form
| Error Type | `invalid case list followup form` |
|---|---|
| **Trigger** | FF `FOLLOWUP_FORMS_AS_CASE_LIST_FORM` enabled but form not in valid list |
| **Message** | (type only) |
| **Forge Check** | NO |

### B9. Module filter xpath error
| Error Type | `module filter has xpath error` |
|---|---|
| **Trigger** | `module.module_filter` contains invalid XPath |
| **Message** | Includes xpath_error details |
| **Forge Check** | NO |

### B10. Invalid parent select ID
| Error Type | `invalid parent select id` |
|---|---|
| **Trigger** | `parent_select.module_id` references a module that's not valid for parent selection |
| **Message** | (type only) |
| **Forge Check** | NO |

### B11. Non-unique instance name with parent select
| Error Type | `non-unique instance name with parent select module` |
|---|---|
| **Trigger** | Module and its parent select module use inline search with same instance name |
| **Message** | `The instance "..." is not unique` |
| **Forge Check** | NO |

### B12. Non-unique instance name with parent module
| Error Type | `non-unique instance name with parent module` |
|---|---|
| **Trigger** | Module and its root (child) module both use inline search with same instance name |
| **Message** | `The instance "..." is not unique` |
| **Forge Check** | NO |

### B13. Endpoint to display-only forms
| Error Type | `endpoint to display only forms` |
|---|---|
| **Trigger** | Module has `session_endpoint_id` but `put_in_root` is true |
| **Message** | (type only) |
| **Forge Check** | NO |

### B14. Inline search to display-only forms
| Error Type | `inline search to display only forms` |
|---|---|
| **Trigger** | Module uses inline search but `put_in_root` is true |
| **Message** | (type only) |
| **Forge Check** | NO |

### B15. Smart links missing endpoint
| Error Type | `smart links missing endpoint` |
|---|---|
| **Trigger** | Module uses smart links but has no `session_endpoint_id` |
| **Message** | (type only) |
| **Forge Check** | NO |

### B16. Smart links + select parent first
| Error Type | `smart links select parent first` |
|---|---|
| **Trigger** | Module uses smart links AND `parent_select.active` |
| **Message** | (type only) |
| **Forge Check** | NO |

### B17. Smart links + multi select
| Error Type | `smart links multi select` |
|---|---|
| **Trigger** | Module uses smart links AND multi-select |
| **Message** | (type only) |
| **Forge Check** | NO |

### B18. Smart links + inline search
| Error Type | `smart links inline search` |
|---|---|
| **Trigger** | Module uses smart links AND inline search |
| **Message** | (type only) |
| **Forge Check** | NO |

### B19. Data registry + multi select
| Error Type | `data registry multi select` |
|---|---|
| **Trigger** | Module loads registry case AND is multi-select |
| **Message** | (type only) |
| **Forge Check** | NO |

### B20. Invalid sort field
| Error Type | `invalid sort field` |
|---|---|
| **Trigger** | Sort element field doesn't match regex `^([a-zA-Z][\w_-]*:)*([a-zA-Z][\w_-]*/)*#?[a-zA-Z][\w_-]*$` |
| **Message** | (type only) |
| **Forge Check** | NO |

### B21. Invalid filter xpath
| Error Type | `invalid filter xpath` |
|---|---|
| **Trigger** | `case_list_filter` produces invalid XPath |
| **Message** | (type only) |
| **Forge Check** | NO |

### B22. Invalid tile configuration (multiple types)
| Error Type | `invalid tile configuration` |
|---|---|
| **Trigger** | Various case tile config errors: non-custom template on case detail, row spans multiple tabs, missing tile field assignment, persistent tile + report context tile conflict |
| **Message** | Varies by sub-type |
| **Forge Check** | NO |

### B23. Invalid clickable icon configuration
| Error Type | `invalid clickable icon configuration` |
|---|---|
| **Trigger** | Column format is `clickable-icon` but `endpoint_action_id` is empty |
| **Message** | "Clickable Icons require a form to be configured" |
| **Forge Check** | NO |

### B24. Deprecated popup configuration
| Error Type | `deprecated popup configuration` |
|---|---|
| **Trigger** | `address-popup` format used in case list (short) instead of case detail (long) |
| **Message** | "should be used in the Case Detail not Case List" |
| **Forge Check** | NO |

### B25. Circular case hierarchy
| Error Type | `circular case hierarchy` |
|---|---|
| **Trigger** | `module_case_hierarchy_has_circular_reference(module)` returns true |
| **Message** | (type only) |
| **Forge Check** | NO |

### B26. Training module as parent
| Error Type | `training module parent` |
|---|---|
| **Trigger** | Module's `root_module` is a training module |
| **Message** | (type only) |
| **Forge Check** | NO |

### B27. Training module as child
| Error Type | `training module child` |
|---|---|
| **Trigger** | Module is a training module AND has a `root_module` |
| **Message** | (type only) |
| **Forge Check** | NO |

### B28. Missing module (caught wrapper)
| Error Type | `missing module` |
|---|---|
| **Trigger** | Any `ModuleNotFoundException` during module validation (parent module, source module, etc.) |
| **Message** | str(exception) |
| **Forge Check** | NO |

### B29. Invalid location xpath
| Error Type | `invalid location xpath` |
|---|---|
| **Trigger** | Detail column of type `FIELD_TYPE_LOCATION` with invalid location xpath |
| **Message** | Includes error details |
| **Forge Check** | NO |

### B30. Case search instance in non-search details
| Error Type | `case search instance used in casedb case details` |
|---|---|
| **Trigger** | Detail column uses xpath with `results:` or `search-input:` instances in a non-search detail without auto-launch |
| **Message** | Includes instance names |
| **Forge Check** | NO |

### B31. Case search nodeset invalid
| Error Type | `case search nodeset invalid` |
|---|---|
| **Trigger** | Search property itemset references something other than lookup table or mobile report |
| **Message** | "It must reference a lookup table or mobile report" |
| **Forge Check** | NO |

### B32. Invalid grouping from ungrouped search property
| Error Type | `invalid grouping from ungrouped search property` |
|---|---|
| **Trigger** | Search config has grouped properties but some properties lack a `group_key` |
| **Message** | (type only) |
| **Forge Check** | NO |

### B33. Search on clear with auto select
| Error Type | `search on clear with auto select` |
|---|---|
| **Trigger** | `search_config.search_on_clear` is true AND module is auto-select |
| **Message** | (type only) |
| **Forge Check** | NO |

### B34. Case list field action endpoint missing
| Error Type | `case list field action endpoint missing` |
|---|---|
| **Trigger** | Detail column has `endpoint_action_id` but no form with that `session_endpoint_id` exists |
| **Message** | (type only) |
| **Forge Check** | NO |

### B35. No source module (Shadow)
| Error Type | `no source module id` |
|---|---|
| **Trigger** | Shadow module has no `source_module` (resolved) |
| **Message** | (type only) |
| **Forge Check** | NO (shadow modules not generated) |

### B36. Report config ref invalid
| Error Type | `report config ref invalid` |
|---|---|
| **Trigger** | Report module's report config references are invalid |
| **Message** | (type only) |
| **Forge Check** | NO (report modules not generated) |

### B37. Report config ID duplicated
| Error Type | `report config id duplicated` |
|---|---|
| **Trigger** | Report module has duplicate instance IDs |
| **Message** | (type only) |
| **Forge Check** | NO |

### B38. No reports
| Error Type | `no reports` |
|---|---|
| **Trigger** | Report module has no reports configured |
| **Message** | (type only) |
| **Forge Check** | NO |

### B39. All forms in case list module must load the same cases
| Error Type | `all forms in case list module must load the same cases` |
|---|---|
| **Trigger** | Advanced module with case_list_form, forms load different case types |
| **Message** | (type only) |
| **Forge Check** | NO |

### B40. Case list module form must require case
| Error Type | `case list module form must require case` |
|---|---|
| **Trigger** | Advanced module form has no non-auto-select load/update actions |
| **Message** | (type only) |
| **Forge Check** | NO |

### B41. Case list module form must match module case type
| Error Type | `case list module form must match module case type` |
|---|---|
| **Trigger** | Form's case action case_type != module.case_type |
| **Message** | (type only) |
| **Forge Check** | NO |

---

## SECTION C: Form-Level Validators
**File**: `helpers/validators.py` → `FormBaseValidator`, `FormValidator`, `AdvancedFormValidator`, `ShadowFormValidator`

### C1. Blank form
| Error Type | `blank form` |
|---|---|
| **Trigger** | Form source is empty OR has no non-group questions |
| **Message** | (type only) |
| **Forge Check** | NO |

### C2. Invalid XML
| Error Type | `invalid xml` |
|---|---|
| **Trigger** | `_parse_xml(form.source)` raises `XFormException` |
| **Message** | Includes parse error |
| **Forge Check** | PARTIAL — checks XML structure via bind/instance checks |

### C3. Validation error (XForm)
| Error Type | `validation error` |
|---|---|
| **Trigger** | `form.validate_form()` raises `XFormValidationError` (JavaRosa validation) |
| **Message** | Includes validation_message |
| **Forge Check** | NO (requires JavaRosa service) |

### C4. Form filter xpath error
| Error Type | `form filter has xpath error` |
|---|---|
| **Trigger** | `form.form_filter` contains invalid XPath |
| **Message** | Includes xpath_error |
| **Forge Check** | NO |

### C5. No form links
| Error Type | `no form links` |
|---|---|
| **Trigger** | `post_form_workflow == 'form'` but `form.form_links` is empty |
| **Message** | (type only) |
| **Forge Check** | NO |

### C6. Bad form link
| Error Type | `bad form link` |
|---|---|
| **Trigger** | Form link references a form or module that doesn't exist, or module mismatch |
| **Message** | (type only) |
| **Forge Check** | NO |

### C7. Form link to display-only forms
| Error Type | `form link to display only forms` |
|---|---|
| **Trigger** | `post_form_workflow == 'module'` but module has `put_in_root`, OR `post_form_workflow == 'parent_module'` but root_module has `put_in_root` |
| **Message** | (type only) |
| **Forge Check** | NO |

### C8. Form link to missing root
| Error Type | `form link to missing root` |
|---|---|
| **Trigger** | `post_form_workflow == 'parent_module'` but module has no `root_module` |
| **Message** | (type only) |
| **Forge Check** | NO |

### C9. Mismatch multi-select form links
| Error Type | `mismatch multi select form links` |
|---|---|
| **Trigger** | `post_form_workflow == 'previous'` and module vs root_module multi-select mismatch |
| **Message** | (type only) |
| **Forge Check** | NO |

### C10. Workflow previous + inline search
| Error Type | `workflow previous inline search` |
|---|---|
| **Trigger** | `post_form_workflow == 'previous'`, form requires case, module uses inline search |
| **Message** | (type only) |
| **Forge Check** | NO |

### C11. Subcase has no case type
| Error Type | `subcase has no case type` |
|---|---|
| **Trigger** | A subcase action has empty `case_type` |
| **Message** | (type only) |
| **Forge Check** | PARTIAL — checks `case_type` required on subcases |

### C12. Case name required
| Error Type | `case_name required` |
|---|---|
| **Trigger** | Open case action (basic or advanced) with no `name_update.question_path` |
| **Message** | (type only) |
| **Forge Check** | YES — checks case_name in create blocks |

### C13. Update case uses reserved word
| Error Type | `update_case uses reserved word` |
|---|---|
| **Trigger** | Case property name is in the reserved words list (case-reserved-words.json) |
| **Message** | Includes the word |
| **Forge Check** | YES — checks against `RESERVED_CASE_PROPERTIES` |

### C14. Update case word illegal
| Error Type | `update_case word illegal` |
|---|---|
| **Trigger** | Case property name doesn't match `^[a-zA-Z][\w_-]*(/[a-zA-Z][\w_-]*)*$` |
| **Message** | Includes the word |
| **Forge Check** | YES — validates via `CASE_PROPERTY` regex |

### C15. Path error
| Error Type | `path error` |
|---|---|
| **Trigger** | A case action references a question path that doesn't exist in the XForm |
| **Message** | Includes the path |
| **Forge Check** | YES — `checkCasePathConsistency()` validates calculate paths |

### C16. Multimedia case property not supported
| Error Type | `multimedia case property not supported` |
|---|---|
| **Trigger** | Form references an upload question for case property but `enable_multimedia_case_property` is off |
| **Message** | Includes the path |
| **Forge Check** | NO |

### C17. No case type in action (Advanced)
| Error Type | `no case type in action` |
|---|---|
| **Trigger** | Advanced form action has no `case_type` and no `auto_select` |
| **Message** | Includes case_tag |
| **Forge Check** | NO (advanced modules not commonly generated) |

### C18. Missing parent tag (Advanced)
| Error Type | `missing parent tag` |
|---|---|
| **Trigger** | Subcase action references a `case_index.tag` not in the form's case tags |
| **Message** | Includes case_tag |
| **Forge Check** | NO |

### C19. Missing relationship question
| Error Type | `missing relationship question` |
|---|---|
| **Trigger** | Case index has `relationship == 'question'` but no `relationship_question` |
| **Message** | Includes case_tag |
| **Forge Check** | NO |

### C20. Subcase repeat context
| Error Type | `subcase repeat context` |
|---|---|
| **Trigger** | Subcase in repeat group doesn't share parent's repeat context |
| **Message** | Includes case_tag and parent_tag |
| **Forge Check** | NO |

### C21. Auto select key/source
| Error Type | `auto select key` / `auto select source` |
|---|---|
| **Trigger** | Auto-select action missing `value_key` or `value_source` |
| **Message** | Includes key_name or source_name |
| **Forge Check** | NO |

### C22. Auto select case ref
| Error Type | `auto select case ref` |
|---|---|
| **Trigger** | Auto-select `value_source` references a case tag not in the form |
| **Message** | Includes case_tag |
| **Forge Check** | NO |

### C23. Filtering without case (Advanced)
| Error Type | `filtering without case` |
|---|---|
| **Trigger** | Form filter references case but no non-auto-select load/update action |
| **Message** | (type only) |
| **Forge Check** | NO |

### C24. Conflicting questions
| Error Type | `conflicting questions` |
|---|---|
| **Trigger** | Multiple questions mapped to the same case property (name_update_multi or update_multi) |
| **Message** | Includes property name |
| **Forge Check** | NO |

### C25. Missing shadow parent
| Error Type | `missing shadow parent` |
|---|---|
| **Trigger** | Shadow form has no `shadow_parent_form_id` |
| **Message** | (type only) |
| **Forge Check** | NO (shadow forms not generated) |

### C26. Shadow parent does not exist
| Error Type | `shadow parent does not exist` |
|---|---|
| **Trigger** | Shadow form's parent form ID doesn't resolve |
| **Message** | (type only) |
| **Forge Check** | NO |

### C27. Missing shadow parent tag
| Error Type | `missing shadow parent tag` |
|---|---|
| **Trigger** | Shadow form is missing case tags that exist in parent form |
| **Message** | Includes case_tags list |
| **Forge Check** | NO |

---

## SECTION D: Suite Generation Exceptions (CRITICAL)
These are exceptions raised during `create_all_files()` → `SuiteGenerator.generate_suite()`. They are caught by `ApplicationBaseValidator.validate_app()` and turned into `{'type': 'error', 'message': str(e)}`.

### D1. CaseXPathValidationError
**File**: `suite_xml/sections/menus.py` line 263
| **Exception** | `CaseXPathValidationError` |
|---|---|
| **Trigger** | Form filter (`form.form_filter`) references case properties but module doesn't require a case (no case actions, or module uses `put_in_root` without same case) |
| **Caught as** | `{'type': 'invalid case xpath reference', 'module': ..., 'form': ...}` |
| **Forge Check** | NO |

### D2. UsercaseXPathValidationError
**File**: `suite_xml/sections/menus.py` line 266
| **Exception** | `UsercaseXPathValidationError` |
|---|---|
| **Trigger** | Form filter references usercase but usercase not in use for domain |
| **Caught as** | `{'type': 'invalid user property xpath reference', ...}` |
| **Forge Check** | NO |

### D3. SuiteValidationError — Unexpected form type
**File**: `suite_xml/sections/entries.py` line 172
| **Exception** | `SuiteValidationError` |
|---|---|
| **Trigger** | `form.form_type` is not `module_form`, `advanced_form`, or `shadow_form` |
| **Message** | `"Unexpected form type '...' with a case list form: ..."` |
| **Forge Check** | YES — validates form_type enum |

### D4. SuiteValidationError — Custom XML detail ID mismatch
**File**: `suite_xml/sections/details.py` line 484
| **Exception** | `SuiteValidationError` |
|---|---|
| **Trigger** | Module uses custom case list XML and the detail ID in the XML doesn't match expected ID |
| **Message** | `"Menu N, "name", uses custom case list xml. The specified detail ID is '...', expected '...'"` |
| **Forge Check** | NO |

### D5. SuiteValidationError — Circular case hierarchy in select chain
**File**: `suite_xml/utils.py` line 43
| **Exception** | `SuiteValidationError` |
|---|---|
| **Trigger** | `get_select_chain_with_sessions()` detects circular reference in parent_select module chain |
| **Message** | `"Circular reference in case hierarchy"` |
| **Forge Check** | NO |

### D6. SuiteValidationError — Suite field sort order not unique
**File**: `suite_xml/utils.py` line 94
| **Exception** | `SuiteValidationError` |
|---|---|
| **Trigger** | Detail fields have duplicate `sort/@order` values |
| **Message** | `"field/sort/@order must be unique per detail"` |
| **Forge Check** | NO |

### D7. ParentModuleReferenceError — Module case type mismatch
**File**: `suite_xml/sections/entries.py` line 880
| **Exception** | `ParentModuleReferenceError` |
|---|---|
| **Trigger** | Advanced form's load/update action references a module (`details_module`) whose `case_type` doesn't match the action's `case_type` |
| **Message** | `"Form '...' in module '...' references a module with an incorrect case type: module '...' expected '...', found '...'"` |
| **Forge Check** | NO |

### D8. ParentModuleReferenceError — Target module not found
**File**: `suite_xml/sections/entries.py` line 878, 900
| **Exception** | `ParentModuleReferenceError` |
|---|---|
| **Trigger** | Advanced form's action references a `details_module` ID that doesn't exist |
| **Message** | `"Could not find target module used by form '...'"` |
| **Forge Check** | NO |

### D9. ParentModuleReferenceError — Module with case type not found
**File**: `suite_xml/sections/entries.py` line 912
| **Exception** | `ParentModuleReferenceError` |
|---|---|
| **Trigger** | No module in the app has the case type needed by an advanced form action (and no explicit `details_module` set) |
| **Message** | `"Module with case type ... in app ... not found"` |
| **Forge Check** | NO — THIS IS THE "Case type X does not exist" ERROR WE KEEP HITTING |

### D10. MediaResourceError
**File**: `suite_xml/generator.py` line 146
| **Exception** | `MediaResourceError` |
|---|---|
| **Trigger** | Media path doesn't start with `jr://file/` |
| **Message** | `"... does not start with jr://file/"` |
| **Forge Check** | NO |

### D11. UnknownInstanceError
**File**: `suite_xml/post_process/instances.py` line 444
| **Exception** | `UnknownInstanceError` |
|---|---|
| **Trigger** | XPath in suite references an instance ID that HQ doesn't recognize (not in factory map) |
| **Message** | `"Instance reference not recognized: ... in XPath \"...\""` |
| **Forge Check** | NO |

### D12. DuplicateInstanceIdError
**File**: `suite_xml/post_process/instances.py` line 222
| **Exception** | `DuplicateInstanceIdError` |
|---|---|
| **Trigger** | Custom instance declaration conflicts with a known instance (different `src` for same `id`) |
| **Message** | `"Conflicting instance declarations in ... for ...: ... != ..."` |
| **Forge Check** | NO |

### D13. ResourceOverrideError — Duplicate resource IDs
**File**: `suite_xml/post_process/resources.py` line 112
| **Exception** | `ResourceOverrideError` |
|---|---|
| **Trigger** | After applying resource overrides, duplicate resource IDs exist |
| **Message** | `"Duplicate resource ids found: ..."` |
| **Forge Check** | NO |

### D14. SuiteValidationError — Form linking missing variable
**File**: `suite_xml/post_process/workflow.py` line 280
| **Exception** | `SuiteValidationError` |
|---|---|
| **Trigger** | Form linking: target form requires a datum that can't be matched and wasn't manually provided |
| **Message** | `"Unable to link form '...', missing variable '...'"` |
| **Forge Check** | NO |

### D15. SuiteError — Unexpected child type in stack frame
**File**: `suite_xml/post_process/workflow.py` line 672
| **Exception** | `SuiteError` |
|---|---|
| **Trigger** | Stack frame contains unexpected child type (programming error) |
| **Message** | `"Unexpected child type: ..."` |
| **Forge Check** | NO |

### D16. SuiteError — Datum already has a case type
**File**: `suite_xml/post_process/workflow.py` line 781, 830
| **Exception** | `SuiteError` |
|---|---|
| **Trigger** | Attempt to set case type on a datum that already has a different case type |
| **Message** | `"Datum already has a case type"` |
| **Forge Check** | NO |

### D17. ScheduleError
**File**: `suite_xml/sections/menus.py` line 210
| **Trigger** | Form schedule configuration errors (caught silently in menu generation) |
| **Forge Check** | NO |

---

## SECTION E: XForm Rendering Exceptions
These are raised during `create_all_files()` → `_get_form_files()` → `form.render_xform()`.

### E1. CaseError — Case type does not exist
**File**: `xform.py` lines 1751, 1939
| **Exception** | `CaseError` (subclass of `XFormException`) |
|---|---|
| **Trigger** | `form.get_app().case_type_exists(subcase.case_type)` returns False — the case type used by a subcase action or advanced form action doesn't match any module's case type in the app |
| **Message** | `"Case type (...) for form (...) does not exist"` |
| **Caught as** | `XFormException` → `{'type': 'error', 'message': 'Error in form "...": Case type (...) for form (...) does not exist'}` |
| **Forge Check** | NO — THIS IS THE EXACT ERROR MESSAGE WE'VE BEEN HITTING |

**How `case_type_exists()` works**: It checks if ANY module in the app has the given case type. If a subcase opens `child_case` but no module has `case_type: "child_case"`, this error fires.

### E2. XFormException — Error in form rendering
**File**: `models.py` line 5205
| **Exception** | `XFormException` |
|---|---|
| **Trigger** | Any XForm processing error during `render_xform()` |
| **Message** | `'Error in form "...": ...'` |
| **Forge Check** | PARTIAL — XForm structure checks |

---

## SECTION F: Model-Level Errors (Not in validate_app but in data access)

### F1. ModuleNotFoundException
**File**: `models.py` lines 5265, 5276
| **Trigger** | `get_module(i)` or `get_module_by_unique_id(uid)` can't find the module |
| **Message** | `"Could not find module with index ..."` or `"Could not find module with ID='...' in app '...'"` |

### F2. FormNotFoundException
**File**: `models.py` line 5306
| **Trigger** | `get_form(unique_id)` can't find the form |
| **Message** | `"Form in app '...' with unique id '...' not found"` |

### F3. Case list used by parent child selection not found
**File**: `suite_xml/utils.py` line 31
| **Trigger** | `get_select_chain_with_sessions()` — parent_select.module_id references non-existent module |
| **Message** | `"Case list used by parent child selection in '...' not found"` |

---

## FORGE COVERAGE SUMMARY

### Currently Checked (YES): 13/60+
1. Empty langs / non-empty array
2. No modules
3. Module unique_id required
4. Duplicate xmlns
5. No case detail columns when module requires cases
6. case_type required on subcases
7. case_name required in create blocks
8. Reserved case property names
9. Invalid case property name format
10. Case path consistency (calculate references)
11. Form type enum validation
12. Suite cross-file consistency (xmlns, commands, locales, details)
13. XForm itext/localization requirements

### CRITICAL GAPS (Most Likely to Cause Build Failures):

#### GAP 1: Case Type Existence (E1, D9)
**Priority: HIGHEST**
When a subcase opens a case type (e.g., `visit`), HQ checks that SOME module in the app has `case_type == "visit"`. If not: `"Case type (visit) for form (Register) does not exist"`.

**Fix**: Forge must validate that every `case_type` referenced in any form action (open_case, subcases, load_update_cases) matches at least one module's `case_type`.

#### GAP 2: Root Module References (A5, A6)
**Priority: HIGH**
If `root_module_id` references a non-existent unique_id, build fails with "unknown root". If there's a cycle, build fails with "root cycle".

**Fix**: Validate all `root_module_id` values point to existing module `unique_id`s. Check for cycles.

#### GAP 3: Parent Select References (A4, B10, D5)
**Priority: HIGH**
If `parent_select.module_id` is set to a non-existent or invalid module, build fails.

**Fix**: Validate `parent_select.module_id` references when `parent_select.active` is true.

#### GAP 4: Form Link References (C5, C6)
**Priority: MEDIUM**
If `post_form_workflow == 'form'` and form links reference non-existent forms/modules.

**Fix**: Validate `form_links[].form_id` and `form_links[].form_module_id` reference existing entities.

#### GAP 5: No Forms or Case List (B5)
**Priority: MEDIUM**
Module must have at least one form OR `case_list.show == true`.

#### GAP 6: Advanced Form Module References (D7, D8)
**Priority: MEDIUM**
Advanced form actions reference `details_module` that must exist and have matching case type.

#### GAP 7: Case List Form Registration (B6, B7)
**Priority: LOW-MEDIUM**
If `case_list_form.form_id` is set, the referenced form must exist and be a registration form for the module's case type.
