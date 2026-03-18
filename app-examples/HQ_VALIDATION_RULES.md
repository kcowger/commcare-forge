# CommCare HQ Validation Rules: Complete Extraction

> Source: `commcare-hq/corehq/apps/app_manager/helpers/validators.py` (1388 lines),
> `models.py`, `xform.py`, `suite_xml/utils.py`, `suite_xml/sections/entries.py`,
> `suite_xml/sections/details.py`, `suite_xml/post_process/workflow.py`
>
> Entry point: `Application.validate_app()` -> `ApplicationValidator.validate_app()` -> `make_build()`
>
> Forge validation entry points: `validateHqJson()` in `appGenerator.ts`,
> `validateCompact()` in `hqJsonExpander.ts`, and CLI validation via `cliValidator.ts`

---

## How "Make New Version" Works

1. User clicks "Make New Version" in HQ
2. View `save_copy()` in `views/releases.py` calls `app.make_build()`
3. `make_build()` calls `copy.validate_app()` -> raises `AppValidationError` if errors
4. If validation passes, `copy.create_build_files()` generates suite.xml, profile.xml, XForms
5. `create_all_files()` can also raise `SuiteValidationError`, `CaseXPathValidationError`, etc.

---

## SECTION 1: Application-Level Validation

### 1.1 Empty Language Code
- **Source**: `ApplicationValidator.validate_app()` line 173
- **Error type**: `'empty lang'`
- **Trigger**: Any language in `app.langs` is an empty string
- **Forge implements**: NO
- **Fix needed**: Check that all language codes in `langs` array are non-empty strings

### 1.2 No Modules
- **Source**: `ApplicationValidator._check_modules()` line 201
- **Error type**: `'no modules'`
- **Trigger**: `app.modules` is empty (zero modules)
- **Forge implements**: NO (Zod schema may catch this, but no explicit HQ JSON check)
- **Fix needed**: Error if `json.modules` is empty or missing

### 1.3 Duplicate XMLNS
- **Source**: `ApplicationValidator._check_forms()` lines 216-221
- **Error type**: `'duplicate xmlns'`
- **Trigger**: Two or more non-shadow forms share the same `xmlns` value
- **Forge implements**: NO
- **Fix needed**: Collect all form xmlns values; error if any xmlns appears more than once

### 1.4 Module Unique ID Missing
- **Source**: `ApplicationValidator.validate_app()` lines 179-180
- **Error type**: Raises `ModuleIdMissingException` (caught in `Application.validate_app()` line 5571)
- **Trigger**: Any module has no `unique_id`
- **Forge implements**: NO (expander generates them, but no post-expansion check)
- **Fix needed**: Verify every module has a non-empty `unique_id` after expansion

### 1.5 Parent Select Cycle
- **Source**: `ApplicationValidator.validate_app()` lines 187-188
- **Error type**: `'parent cycle'`
- **Trigger**: Circular dependency in `parent_select.module_id` references across modules
- **Forge implements**: NO
- **Fix needed**: Not critical for Forge (Forge does not generate parent_select), but should guard against it

### 1.6 Child Module (Root Module) Cycle
- **Source**: `ApplicationValidator._child_module_errors()` lines 258-259
- **Error type**: `'root cycle'`
- **Trigger**: Circular dependency in `root_module_id` references
- **Forge implements**: NO
- **Fix needed**: Not critical (Forge doesn't generate child modules yet)

### 1.7 Unknown Root Module
- **Source**: `ApplicationValidator._child_module_errors()` lines 263-264
- **Error type**: `'unknown root'`
- **Trigger**: A module's `root_module_id` doesn't match any existing module's `unique_id`
- **Forge implements**: NO
- **Fix needed**: Not critical (Forge doesn't generate root_module_id)

### 1.8 Usercase Subscription Check
- **Source**: `ApplicationValidator._check_subscription()` lines 273-279
- **Error type**: `'subscription'`
- **Trigger**: App uses usercase but domain lacks `USERCASE` privilege
- **Forge implements**: NO (N/A -- subscription checks are server-side only)
- **Fix needed**: None. This is a server-side privilege check, not applicable to offline generation.

---

## SECTION 2: Application Base Validation (runs during create_all_files)

### 2.1 Lookup Table Privilege
- **Source**: `ApplicationBaseValidator._validate_fixtures()` lines 100-113
- **Error type**: `'error'` with message about lookup table subscription
- **Trigger**: Form uses lookup tables but domain lacks `LOOKUP_TABLES` privilege
- **Forge implements**: NO (N/A -- subscription check)
- **Fix needed**: None. Server-side privilege check.

### 2.2 Custom Intents Privilege
- **Source**: `ApplicationBaseValidator._validate_intents()` lines 117-144
- **Error type**: `'error'` with message about integration subscription
- **Trigger**: Form uses ODK intents but domain lacks privilege
- **Forge implements**: NO (N/A -- subscription check, Forge doesn't generate intents)
- **Fix needed**: None.

### 2.3 Practice User Config Error
- **Source**: `ApplicationBaseValidator._validate_practice_users()` lines 148-164
- **Error type**: `'practice user config error'`
- **Trigger**: Practice users enabled but misconfigured
- **Forge implements**: NO (N/A -- Forge doesn't configure practice users)
- **Fix needed**: None.

### 2.4 Invalid Case XPath Reference (during create_all_files)
- **Source**: `ApplicationBaseValidator.validate_app()` lines 81-86
- **Error type**: `'invalid case xpath reference'`
- **Trigger**: XPath in case config references invalid case property during suite generation
- **Forge implements**: NO
- **Fix needed**: Validate XPath expressions in case list filter and detail columns reference valid paths

### 2.5 Invalid User Property XPath Reference (during create_all_files)
- **Source**: `ApplicationBaseValidator.validate_app()` lines 87-91
- **Error type**: `'invalid user property xpath reference'`
- **Trigger**: XPath references usercase property incorrectly during suite generation
- **Forge implements**: NO (N/A -- Forge doesn't generate usercase references)
- **Fix needed**: None for now.

### 2.6 Generic Error During File Creation
- **Source**: `ApplicationBaseValidator.validate_app()` lines 93-95
- **Error type**: `'error'` with exception message
- **Trigger**: `AppEditingError`, `XFormValidationError`, `XFormException`, `ParentModuleReferenceError`, `PermissionDenied`, or `SuiteValidationError` during `create_all_files()`
- **Forge implements**: PARTIAL (CLI validation catches some of these)
- **Fix needed**: The CLI validator is the Forge equivalent of this catch-all

---

## SECTION 3: Module-Level Validation (ModuleBaseValidator)

### 3.1 No Case Type
- **Source**: `ModuleBaseValidator.validate_with_raise()` -> `get_case_errors()` lines 706-710
- **Error type**: `'no case type'`
- **Trigger**: Module needs a case type (has forms requiring cases or registration forms) but `module.case_type` is empty
- **Forge implements**: YES (in `validateHqJson`: "uses cases but doesn't have a case_type")
- **Fix needed**: None.

### 3.2 No Case Detail (Short Columns)
- **Source**: `get_case_errors()` lines 712-717
- **Error type**: `'no case detail'`
- **Trigger**: Module needs case details but `case_details.short.columns` is empty
- **Forge implements**: NO
- **Fix needed**: Check that modules with case_type and case-requiring forms have at least one column in `case_details.short.columns`

### 3.3 Invalid Location XPath in Detail Column
- **Source**: `validate_detail_columns()` lines 475-493
- **Error type**: `'invalid location xpath'`
- **Trigger**: Detail column uses `FIELD_TYPE_LOCATION` format with invalid location xpath
- **Forge implements**: NO (N/A -- Forge doesn't generate location-type columns)
- **Fix needed**: None for now.

### 3.4 Case Search Instance in Non-Search Detail
- **Source**: `validate_detail_columns()` lines 494-505
- **Error type**: `'case search instance used in casedb case details'`
- **Trigger**: Detail column uses XPath referencing `results` or `search-input` instance in non-search detail
- **Forge implements**: NO (N/A -- Forge doesn't generate case search)
- **Fix needed**: None for now.

### 3.5 Missing Module (Parent/Source Not Found)
- **Source**: `ModuleBaseValidator.validate_for_build()` lines 302-309
- **Error type**: `'missing module'`
- **Trigger**: `ModuleNotFoundException` raised when accessing parent/source module
- **Forge implements**: NO
- **Fix needed**: Not critical (Forge doesn't generate inter-module references)

### 3.6 Module Filter XPath Error
- **Source**: `ModuleBaseValidator.validate_with_raise()` lines 327-334
- **Error type**: `'module filter has xpath error'`
- **Trigger**: `module.module_filter` is set but is not valid XPath
- **Forge implements**: NO (Forge doesn't generate module_filter)
- **Fix needed**: If Forge adds module filtering, validate XPath

### 3.7 Case List Form Missing
- **Source**: `validate_case_list_form()` lines 358-362
- **Error type**: `'case list form missing'`
- **Trigger**: `module.case_list_form.form_id` references a form that doesn't exist
- **Forge implements**: NO (Forge doesn't generate case_list_form references)
- **Fix needed**: None for now.

### 3.8 Case List Form Not Registration
- **Source**: `validate_case_list_form()` lines 373-378
- **Error type**: `'case list form not registration'`
- **Trigger**: The form referenced by `case_list_form.form_id` is not a registration form for the module's case type
- **Forge implements**: NO
- **Fix needed**: None for now.

### 3.9 Invalid Case List Followup Form
- **Source**: `validate_case_list_form()` lines 367-372
- **Error type**: `'invalid case list followup form'`
- **Trigger**: Form referenced is not valid for case list followup (toggle-gated)
- **Forge implements**: NO
- **Fix needed**: None.

### 3.10 Endpoint to Display Only Forms
- **Source**: `validate_display_only_forms()` lines 384-389
- **Error type**: `'endpoint to display only forms'`
- **Trigger**: Module has `put_in_root=True` and `session_endpoint_id` set
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate session_endpoint_id)

### 3.11 Inline Search to Display Only Forms
- **Source**: `validate_display_only_forms()` lines 390-394
- **Error type**: `'inline search to display only forms'`
- **Trigger**: Module has `put_in_root=True` and uses inline search
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate inline search)

### 3.12 Invalid Parent Select ID
- **Source**: `validate_parent_select()` lines 411-415
- **Error type**: `'invalid parent select id'`
- **Trigger**: `parent_select.module_id` doesn't match any valid module
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate parent_select)

### 3.13 Non-Unique Instance Name with Parent Select Module
- **Source**: `validate_parent_select()` lines 418-428
- **Error type**: `'non-unique instance name with parent select module'`
- **Trigger**: Module and parent select module use same search config instance name
- **Forge implements**: NO
- **Fix needed**: None.

### 3.14 Smart Links Missing Endpoint
- **Source**: `validate_smart_links()` lines 433-438
- **Error type**: `'smart links missing endpoint'`
- **Trigger**: Module uses smart links but no `session_endpoint_id`
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate smart links)

### 3.15 Smart Links with Select Parent First
- **Source**: `validate_smart_links()` lines 439-443
- **Error type**: `'smart links select parent first'`
- **Trigger**: Module uses smart links and has `parent_select.active`
- **Forge implements**: NO
- **Fix needed**: None.

### 3.16 Smart Links with Multi Select
- **Source**: `validate_smart_links()` line 444-448
- **Error type**: `'smart links multi select'`
- **Trigger**: Module uses smart links and is multi-select
- **Forge implements**: NO
- **Fix needed**: None.

### 3.17 Smart Links with Inline Search
- **Source**: `validate_smart_links()` lines 449-453
- **Error type**: `'smart links inline search'`
- **Trigger**: Module uses smart links and inline search
- **Forge implements**: NO
- **Fix needed**: None.

### 3.18 Data Registry Multi Select
- **Source**: `validate_smart_links()` lines 455-460
- **Error type**: `'data registry multi select'`
- **Trigger**: Module loads registry case and is multi-select
- **Forge implements**: NO
- **Fix needed**: None.

### 3.19 Case Search Nodeset Invalid
- **Source**: `validate_search_config()` lines 511-528
- **Error type**: `'case search nodeset invalid'`
- **Trigger**: Search property itemset doesn't reference lookup table or mobile report; or uses mobile UCR v1
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate search config)

### 3.20 Non-Unique Instance Name with Parent Module
- **Source**: `validate_search_config()` lines 529-539
- **Error type**: `'non-unique instance name with parent module'`
- **Trigger**: Search config instance name conflicts with root module's search config
- **Forge implements**: NO
- **Fix needed**: None.

### 3.21 Invalid Grouping from Ungrouped Search Property
- **Source**: `validate_search_config()` lines 540-548
- **Error type**: `'invalid grouping from ungrouped search property'`
- **Trigger**: Search properties contain groups but some properties are ungrouped
- **Forge implements**: NO
- **Fix needed**: None.

### 3.22 Search on Clear with Auto Select
- **Source**: `validate_search_config()` lines 549-553
- **Error type**: `'search on clear with auto select'`
- **Trigger**: `search_on_clear` enabled but module is auto-select
- **Forge implements**: NO
- **Fix needed**: None.

### 3.23 Case List Field Action Endpoint Missing
- **Source**: `validate_case_list_field_actions()` lines 555-568
- **Error type**: `'case list field action endpoint missing'`
- **Trigger**: Detail column has `endpoint_action_id` not matching any form's `session_endpoint_id`
- **Forge implements**: NO
- **Fix needed**: None.

---

## SECTION 4: Module Type-Specific Validation

### 4.1 No Forms or Case List (Basic Module)
- **Source**: `ModuleValidator.validate_with_raise()` lines 745-749
- **Error type**: `'no forms or case list'`
- **Trigger**: Module has zero forms AND `case_list.show` is false
- **Forge implements**: YES (in `validateHqJson`: "has no forms and case list is not enabled")
- **Fix needed**: None.

### 4.2 Circular Case Hierarchy
- **Source**: `ModuleValidator.validate_with_raise()` lines 751-755
- **Error type**: `'circular case hierarchy'`
- **Trigger**: `parent_select` chain creates a circular reference detected by `get_select_chain()`
- **Forge implements**: NO
- **Fix needed**: Not critical (Forge doesn't generate parent_select chains)

### 4.3 Training Module as Parent
- **Source**: `ModuleValidator.validate_with_raise()` lines 757-761
- **Error type**: `'training module parent'`
- **Trigger**: Module's root_module is a training module
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate training modules)

### 4.4 Training Module as Child
- **Source**: `ModuleValidator.validate_with_raise()` lines 763-767
- **Error type**: `'training module child'`
- **Trigger**: Module is a training module and has a root_module
- **Forge implements**: NO
- **Fix needed**: None.

### 4.5 No Forms or Case List (Advanced Module)
- **Source**: `AdvancedModuleValidator.validate_with_raise()` lines 775-779
- **Error type**: `'no forms or case list'`
- **Trigger**: Same as 4.1 but for advanced modules
- **Forge implements**: YES (same check applies)
- **Fix needed**: None.

### 4.6 Advanced Module Case List Form Validations
- **Source**: `AdvancedModuleValidator.validate_with_raise()` lines 780-843
- **Error types**:
  - `'all forms in case list module must load the same cases'`
  - `'case list module form must require case'`
  - `'case list module form can only load parent cases'`
  - `'case list module form must match module case type'`
  - `'all forms in case list module must have same case management'`
  - `'forms in case list module must use modules details'`
- **Trigger**: Various misconfigurations of case list forms in advanced modules
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate advanced modules)

### 4.7 No Product Detail (CommTrack)
- **Source**: `AdvancedModuleValidator.get_case_errors()` lines 861-869
- **Error type**: `'no product detail'`
- **Trigger**: CommTrack-enabled app with missing product detail columns
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate CommTrack apps)

### 4.8 Report Config Ref Invalid
- **Source**: `ReportModuleValidator.validate_with_raise()` lines 883-887
- **Error type**: `'report config ref invalid'`
- **Trigger**: Report module's report references are invalid
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate report modules)

### 4.9 No Reports
- **Source**: `ReportModuleValidator.validate_with_raise()` lines 888-892
- **Error type**: `'no reports'`
- **Trigger**: Report module has no report configs
- **Forge implements**: NO
- **Fix needed**: None.

### 4.10 Report Config ID Duplicated
- **Source**: `ReportModuleValidator.validate_with_raise()` lines 893-897
- **Error type**: `'report config id duplicated'`
- **Trigger**: Duplicate instance IDs across report configs
- **Forge implements**: NO
- **Fix needed**: None.

### 4.11 Shadow Module No Source Module
- **Source**: `ShadowModuleValidator.validate_with_raise()` lines 915-919
- **Error type**: `'no source module id'`
- **Trigger**: Shadow module has no `source_module` reference
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate shadow modules)

---

## SECTION 5: Detail/Tile Validation (ModuleDetailValidatorMixin)

### 5.1 Invalid Sort Field
- **Source**: `validate_details_for_build()` lines 628-636
- **Error type**: `'invalid sort field'`
- **Trigger**: Sort element field doesn't match the valid field regex `^([a-zA-Z][\w_-]*:)*([a-zA-Z][\w_-]*/)*#?[a-zA-Z][\w_-]*$`
- **Forge implements**: NO
- **Fix needed**: If Forge generates sort elements, validate field name format

### 5.2 Invalid Filter XPath
- **Source**: `validate_details_for_build()` lines 637-647
- **Error type**: `'invalid filter xpath'`
- **Trigger**: `module.case_list_filter` is not valid XPath syntax
- **Forge implements**: NO
- **Fix needed**: If Forge generates case_list_filter, validate XPath

### 5.3 Invalid Tile Configuration (Various)
- **Source**: `validate_details_for_build()` lines 650-701
- **Error type**: `'invalid tile configuration'`
- **Trigger**: Multiple causes:
  - Case tile on long detail but not custom template
  - Tile rows contain fields from multiple tabs
  - Missing required tile field mappings
  - Persistent tile + report context tile conflict
  - Duplicate address format
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate case tiles)

### 5.4 Invalid Clickable Icon Configuration
- **Source**: `_validate_clickable_icons()` lines 611-621
- **Error type**: `'invalid clickable icon configuration'`
- **Trigger**: Clickable icon column has no endpoint_action_id
- **Forge implements**: NO
- **Fix needed**: None.

### 5.5 Deprecated Popup Configuration
- **Source**: `_validate_address_popup_in_long()` lines 597-609
- **Error type**: `'deprecated popup configuration'`
- **Trigger**: Address popup format used in short detail instead of long detail
- **Forge implements**: NO
- **Fix needed**: None.

### 5.6 No Referral Detail
- **Source**: `get_case_errors()` lines 724-728
- **Error type**: `'no ref detail'`
- **Trigger**: Module requires referral detail but `ref_details.short.columns` is empty
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate referral details)

---

## SECTION 6: Form-Level Validation (FormBaseValidator)

### 6.1 Blank Form
- **Source**: `FormBaseValidator.validate_for_build()` lines 979-980
- **Error type**: `'blank form'`
- **Trigger**: `form.source` is empty (no XForm XML) and form_type is not shadow_form
- **Forge implements**: PARTIAL (checked implicitly -- missing attachment check)
- **Fix needed**: Explicitly check that each form has non-empty XForm source

### 6.2 Invalid XML
- **Source**: `FormBaseValidator.validate_for_build()` lines 982-993
- **Error type**: `'invalid xml'`
- **Trigger**: `parse_xml()` raises `XFormException` when parsing form source
- **Forge implements**: YES (in `validateHqJson`: `parseXml(xform)`)
- **Fix needed**: None.

### 6.3 Dangerous XML (Entities)
- **Source**: `xform.py parse_xml()` lines 61-62
- **Error type**: Raises `DangerousXmlException` -> "Entities are not allowed"
- **Trigger**: XML contains entity references
- **Forge implements**: NO
- **Fix needed**: Check XForm XML for entity references (e.g., `&xxe;`)

### 6.4 Validation Error (XForm Questions)
- **Source**: `FormBaseValidator.validate_for_build()` lines 996-1000
- **Error type**: `'validation error'`
- **Trigger**: `form.cached_get_questions()` raises `XFormException`
- **Forge implements**: NO (requires form question parsing)
- **Fix needed**: CLI validation catches some of these

### 6.5 Blank Form (No Questions)
- **Source**: `FormBaseValidator.validate_for_build()` lines 1003-1005
- **Error type**: `'blank form'`
- **Trigger**: Form has valid XML but no non-group questions
- **Forge implements**: PARTIAL (compact validation checks `form.questions.length === 0`)
- **Fix needed**: Also check in HQ JSON that forms have actual data-entry questions

### 6.6 XForm Validation Error (Formplayer)
- **Source**: `FormBaseValidator.validate_for_build()` lines 1007-1014, `xform.py validate_xform()` lines 633-650
- **Error type**: `'validation error'`
- **Trigger**: Formplayer API rejects the XForm (structural/semantic XForm errors)
- **Forge implements**: NO (requires Formplayer API)
- **Fix needed**: CLI validation is the Forge equivalent

### 6.7 Form Filter XPath Error
- **Source**: `FormBaseValidator.validate_for_build()` lines 1017-1026
- **Error type**: `'form filter has xpath error'`
- **Trigger**: `form.form_filter` contains invalid XPath
- **Forge implements**: NO (Forge doesn't generate form_filter)
- **Fix needed**: If Forge adds form filtering, validate XPath

---

## SECTION 7: Form Workflow Validation (validate_for_module)

### 7.1 No Form Links
- **Source**: `FormBaseValidator.validate_for_module()` lines 1049-1051
- **Error type**: `'no form links'`
- **Trigger**: `post_form_workflow` is `WORKFLOW_FORM` but `form_links` is empty
- **Forge implements**: NO
- **Fix needed**: If `post_form_workflow === 'form'`, verify `form_links` is non-empty

### 7.2 Bad Form Link
- **Source**: `FormBaseValidator.validate_for_module()` lines 1053-1073
- **Error type**: `'bad form link'`
- **Trigger**: Multiple causes:
  - Referenced form_id doesn't exist
  - Referenced form_module_id doesn't exist
  - Linked module doesn't match the linked form's module
- **Forge implements**: NO
- **Fix needed**: Validate form link references resolve to actual forms

### 7.3 Form Link to Display Only Forms
- **Source**: `FormBaseValidator.validate_for_module()` lines 1074-1076
- **Error type**: `'form link to display only forms'`
- **Trigger**: `post_form_workflow` is `WORKFLOW_MODULE` but module has `put_in_root=True`
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate put_in_root)

### 7.4 Form Link to Missing Root
- **Source**: `FormBaseValidator.validate_for_module()` lines 1077-1079
- **Error type**: `'form link to missing root'`
- **Trigger**: `post_form_workflow` is `WORKFLOW_PARENT_MODULE` but no root_module exists
- **Forge implements**: NO
- **Fix needed**: None.

### 7.5 Mismatch Multi Select Form Links
- **Source**: `FormBaseValidator.validate_for_module()` lines 1082-1085
- **Error type**: `'mismatch multi select form links'`
- **Trigger**: Module and root module have XOR multi-select (one is, one isn't)
- **Forge implements**: NO
- **Fix needed**: None.

### 7.6 Workflow Previous with Inline Search
- **Source**: `FormBaseValidator.validate_for_module()` lines 1086-1087
- **Error type**: `'workflow previous inline search'`
- **Trigger**: Form requires case, uses `WORKFLOW_PREVIOUS`, and module uses inline search
- **Forge implements**: NO
- **Fix needed**: None.

---

## SECTION 8: Case Property Validation (IndexedFormBaseValidator)

### 8.1 Invalid Property Name (Illegal Characters)
- **Source**: `check_case_properties()` lines 1103-1107
- **Error type**: `'update_case word illegal'`
- **Trigger**: Property name fails regex `^[a-zA-Z][\w_-]*(/[a-zA-Z][\w_-]*)*$` (with parents) or `^[a-zA-Z][\w_-]*$` (subcase, no parents)
- **Forge implements**: YES (in `validateHqJson`: regex `^[a-zA-Z][\w_-]*$`)
- **Fix needed**: None. Forge's regex is correct for the no-parents case.

### 8.2 Reserved Word in Case Property
- **Source**: `check_case_properties()` lines 1108-1110
- **Error type**: `'update_case uses reserved word'`
- **Trigger**: Property name (after splitting parent path) is in `case-reserved-words.json`
- **Forge implements**: YES (in `validateHqJson`: checks `RESERVED_CASE_PROPERTIES.has(prop)`)
- **Fix needed**: None. Reserved word list matches.

### 8.3 Invalid Question Path
- **Source**: `check_paths()` lines 1119-1134
- **Error type**: `'path error'`
- **Trigger**: A question path referenced in case actions doesn't exist in the form's questions
- **Forge implements**: PARTIAL (compact validation checks `case_properties` map to valid question IDs)
- **Fix needed**: The compact-level check is equivalent for Forge's purposes

### 8.4 Multimedia Case Property Not Supported
- **Source**: `check_paths()` lines 1131-1132
- **Error type**: `'multimedia case property not supported'`
- **Trigger**: Case property maps to an `upload` question but `enable_multimedia_case_property` is false
- **Forge implements**: YES (compact validation checks `MEDIA_QUESTION_TYPES`)
- **Fix needed**: None.

---

## SECTION 9: Basic Form Actions Validation (FormValidator)

### 9.1 Subcase Has No Case Type
- **Source**: `FormValidator.check_actions()` lines 1143-1144
- **Error type**: `'subcase has no case type'`
- **Trigger**: Subcase action has empty `case_type`
- **Forge implements**: YES (in `validateHqJson`: "subcase has no case type")
- **Fix needed**: None.

### 9.2 Case Name Required (Open Case)
- **Source**: `FormValidator.check_actions()` lines 1148-1150
- **Error type**: `'case_name required'`
- **Trigger**: Form requires no case (registration form), open_case is active, but `name_update.question_path` is empty
- **Forge implements**: YES (in `validateHqJson`: "opens a case but has no case name question path")
- **Fix needed**: None.

### 9.3 Conflicting Questions (Multiple Questions for Same Property)
- **Source**: `FormValidator.check_for_conflicting_questions()` lines 1174-1191
- **Error type**: `'conflicting questions'`
- **Trigger**: `open_case.name_update_multi` has entries, or `update_case.update_multi` has entries (multiple questions mapped to same property)
- **Forge implements**: PARTIAL (compact validation checks duplicate question->property mappings)
- **Fix needed**: The compact check covers the same concept

---

## SECTION 10: Advanced Form Actions Validation (AdvancedFormValidator)

### 10.1 Missing Parent Tag
- **Source**: `AdvancedFormValidator.check_actions()` lines 1244-1246
- **Error type**: `'missing parent tag'`
- **Trigger**: Subcase action references a `case_index.tag` not in the form's case tags
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate advanced forms)

### 10.2 Missing Relationship Question
- **Source**: `AdvancedFormValidator.check_actions()` lines 1247-1248
- **Error type**: `'missing relationship question'`
- **Trigger**: Case index has `relationship='question'` but no `relationship_question`
- **Forge implements**: NO
- **Fix needed**: None.

### 10.3 Case Name Required (Advanced Open Case)
- **Source**: `AdvancedFormValidator.check_actions()` lines 1250-1252
- **Error type**: `'case_name required'`
- **Trigger**: `AdvancedOpenCaseAction` with empty `name_update.question_path`
- **Forge implements**: NO (N/A for advanced forms)
- **Fix needed**: None.

### 10.4 Subcase Repeat Context Mismatch
- **Source**: `AdvancedFormValidator.check_actions()` lines 1254-1263
- **Error type**: `'subcase repeat context'`
- **Trigger**: Parent case is in a repeat but child case is not, or child's repeat doesn't start with parent's repeat
- **Forge implements**: NO
- **Fix needed**: None.

### 10.5 No Case Type in Action
- **Source**: `AdvancedFormValidator.check_actions()` lines 1270-1272
- **Error type**: `'no case type in action'`
- **Trigger**: Action has no `case_type` and is not an auto-select LoadUpdateAction
- **Forge implements**: NO
- **Fix needed**: None.

### 10.6 Auto Select Key Missing
- **Source**: `AdvancedFormValidator.check_actions()` lines 1274-1284
- **Error type**: `'auto select key'`
- **Trigger**: Auto-select action has no `value_key`
- **Forge implements**: NO
- **Fix needed**: None.

### 10.7 Auto Select Source Missing
- **Source**: `AdvancedFormValidator.check_actions()` lines 1286-1292
- **Error type**: `'auto select source'`
- **Trigger**: Auto-select action has no `value_source` for modes that require it
- **Forge implements**: NO
- **Fix needed**: None.

### 10.8 Auto Select Case Ref Invalid
- **Source**: `AdvancedFormValidator.check_actions()` lines 1293-1296
- **Error type**: `'auto select case ref'`
- **Trigger**: Auto-select `value_source` references a case tag that doesn't exist
- **Forge implements**: NO
- **Fix needed**: None.

### 10.9 Filtering Without Case
- **Source**: `AdvancedFormValidator.check_actions()` lines 1303-1316
- **Error type**: `'filtering without case'`
- **Trigger**: Form filter references case/usercase XPath but form doesn't load any cases
- **Forge implements**: NO
- **Fix needed**: None.

---

## SECTION 11: Shadow Form Validation (ShadowFormValidator)

### 11.1 Missing Shadow Parent
- **Source**: `ShadowFormValidator.extended_build_validation()` lines 1361-1366
- **Error type**: `'missing shadow parent'`
- **Trigger**: Shadow form has no `shadow_parent_form_id`
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate shadow forms)

### 11.2 Shadow Parent Does Not Exist
- **Source**: `ShadowFormValidator.extended_build_validation()` lines 1367-1372
- **Error type**: `'shadow parent does not exist'`
- **Trigger**: Shadow form's `shadow_parent_form_id` doesn't resolve to a real form
- **Forge implements**: NO
- **Fix needed**: None.

### 11.3 Missing Shadow Parent Tag
- **Source**: `ShadowFormValidator.check_actions()` lines 1380-1386
- **Error type**: `'missing shadow parent tag'`
- **Trigger**: Shadow form doesn't mirror all case tags from parent form
- **Forge implements**: NO
- **Fix needed**: None.

---

## SECTION 12: Suite XML Generation Validation (caught as errors during create_all_files)

### 12.1 Circular Reference in Case Hierarchy
- **Source**: `suite_xml/utils.py` line 43
- **Error type**: `SuiteValidationError("Circular reference in case hierarchy")`
- **Trigger**: `get_select_chain()` detects circular parent_select references
- **Forge implements**: NO
- **Fix needed**: None (Forge doesn't generate parent_select)

### 12.2 Non-Unique Sort Order in Detail
- **Source**: `suite_xml/utils.py` line 94
- **Error type**: `SuiteValidationError('field/sort/@order must be unique per detail')`
- **Trigger**: Duplicate sort order values in detail fields
- **Forge implements**: NO
- **Fix needed**: If Forge generates sort elements, ensure unique sort orders

### 12.3 Unexpected Form Type with Case List Form
- **Source**: `suite_xml/sections/entries.py` lines 172-174
- **Error type**: `SuiteValidationError("Unexpected form type '{}' with a case list form")`
- **Trigger**: Non-basic/advanced form used as case list form
- **Forge implements**: NO
- **Fix needed**: None.

### 12.4 Custom Detail ID Mismatch
- **Source**: `suite_xml/sections/details.py` lines 484-487
- **Error type**: `SuiteValidationError("Menu {}, ..., uses custom case list xml")`
- **Trigger**: Custom case list XML has detail ID that doesn't match expected ID
- **Forge implements**: NO
- **Fix needed**: None.

### 12.5 Unable to Link Form (Missing Variable)
- **Source**: `suite_xml/post_process/workflow.py` lines 280-282
- **Error type**: `SuiteValidationError("Unable to link form '{}', missing variable '{}'")`
- **Trigger**: Form link stack can't find required session variable
- **Forge implements**: NO
- **Fix needed**: If Forge generates form links, this could occur. CLI validation should catch it.

---

## SECTION 13: XForm-Level Validation (in xform.py parse_xml)

### 13.1 XML Parse Error
- **Source**: `xform.py parse_xml()` lines 56-59
- **Error**: `XFormException("Error parsing XML: {}")`
- **Trigger**: `lxml.etree.ParseError` when parsing XForm source
- **Forge implements**: YES (`parseXml(xform)` in `validateHqJson`)
- **Fix needed**: None.

### 13.2 Entity References Not Allowed
- **Source**: `xform.py parse_xml()` lines 61-62
- **Error**: `DangerousXmlException("Entities are not allowed")`
- **Trigger**: XML contains entity references (XXE protection)
- **Forge implements**: NO
- **Fix needed**: Check for entity references in generated XML

---

## SECTION 14: Forge-Specific Checks (in validateHqJson, NOT from HQ)

These are additional checks Forge does that go beyond HQ's validators.py. They are still valuable.

| Forge Check | In HQ? | Notes |
|-------------|--------|-------|
| `doc_type === 'Application'` | Implicit (model type) | Good sanity check |
| Missing `_attachment` for form `unique_id` | HQ stores source differently | Good structural check |
| Duplicate XML declaration | Not in validators.py | Good -- HQ parser would fail |
| Missing `<itext>` block | Not in validators.py | Good -- HQ/formplayer requires it |
| Inline labels (not itext refs) | Not in validators.py | Good -- HQ/formplayer requires itext refs |
| Unescaped `<>` in attributes | Not in validators.py | Good -- would break XML |
| Missing `xmlns` on form | Caught by duplicate xmlns check | Good |
| `case_preload` value remapping | Not exactly in validators.py | Forge-specific safety |

---

## PRIORITY SUMMARY: Rules Forge Must Add

### HIGH PRIORITY (will cause "Make New Version" failures)

| # | Rule | Error Type | What to Add |
|---|------|-----------|-------------|
| 1 | **No modules** | `'no modules'` | Reject apps with empty `modules` array |
| 2 | **Duplicate XMLNS** | `'duplicate xmlns'` | Check all form xmlns values are unique |
| 3 | **No case detail columns** | `'no case detail'` | Modules with case-requiring forms need `case_details.short.columns` to be non-empty |
| 4 | **Empty language code** | `'empty lang'` | Check all entries in `langs` array are non-empty |
| 5 | **Entity references in XML** | `DangerousXmlException` | Check generated XForm XML has no `&entity;` references |
| 6 | **Module unique_id missing** | `ModuleIdMissingException` | Verify every module has `unique_id` after expansion |

### MEDIUM PRIORITY (edge cases Forge could hit)

| # | Rule | Error Type | What to Add |
|---|------|-----------|-------------|
| 7 | **No form links when workflow=form** | `'no form links'` | If `post_form_workflow === 'form'`, verify `form_links` array is non-empty |
| 8 | **Bad form link references** | `'bad form link'` | Validate form_link form_id references resolve to real forms |
| 9 | **Blank form (no questions)** | `'blank form'` | Verify XForm has at least one non-group question/data node |
| 10 | **Sort order uniqueness** | `SuiteValidationError` | If generating sort elements, ensure unique `@order` values |

### LOW PRIORITY (features Forge doesn't generate yet)

| Feature Area | Error Types | Status |
|-------------|-------------|--------|
| Advanced modules | 10+ error types | Forge doesn't generate these |
| Shadow modules/forms | 4 error types | Forge doesn't generate these |
| Report modules | 3 error types | Forge doesn't generate these |
| Case search/inline search | 6 error types | Forge doesn't generate these |
| Smart links | 4 error types | Forge doesn't generate these |
| Parent select | 3 error types | Forge doesn't generate these |
| Training modules | 2 error types | Forge doesn't generate these |
| Case tiles/custom detail | 5+ error types | Forge doesn't generate these |
| Practice users | 1 error type | Forge doesn't configure these |
| Subscription/privilege checks | 3 error types | Server-side only |
| CommTrack/product detail | 1 error type | Forge doesn't generate these |
| Session endpoints | 2 error types | Forge doesn't generate these |

---

## APPENDIX A: Complete Error Type Reference

Every distinct error `type` string that HQ can return:

```
# Application level
empty lang
no modules
duplicate xmlns
parent cycle
root cycle
unknown root
subscription

# Module level (base)
no case type
no case detail
no ref detail
missing module
module filter has xpath error
case list form missing
case list form not registration
invalid case list followup form
endpoint to display only forms
inline search to display only forms
invalid parent select id
non-unique instance name with parent select module
smart links missing endpoint
smart links select parent first
smart links multi select
smart links inline search
data registry multi select
case search nodeset invalid
non-unique instance name with parent module
invalid grouping from ungrouped search property
search on clear with auto select
case list field action endpoint missing
invalid location xpath
case search instance used in casedb case details

# Module level (type-specific)
no forms or case list
circular case hierarchy
training module parent
training module child
all forms in case list module must load the same cases
case list module form must require case
case list module form can only load parent cases
case list module form must match module case type
all forms in case list module must have same case management
forms in case list module must use modules details
no product detail
report config ref invalid
no reports
report config id duplicated
no source module id

# Detail/tile validation
invalid sort field
invalid filter xpath
invalid tile configuration
invalid clickable icon configuration
deprecated popup configuration

# Form level
blank form
invalid xml
validation error
form filter has xpath error
no form links
bad form link
form link to display only forms
form link to missing root
mismatch multi select form links
workflow previous inline search

# Case property validation
update_case word illegal
update_case uses reserved word
path error
multimedia case property not supported
subcase has no case type
case_name required
conflicting questions

# Advanced form specific
missing parent tag
missing relationship question
subcase repeat context
no case type in action
auto select key
auto select source
auto select case ref
filtering without case

# Shadow form specific
missing shadow parent
shadow parent does not exist
missing shadow parent tag

# Suite generation (raised as exceptions, caught as generic 'error')
Circular reference in case hierarchy
field/sort/@order must be unique per detail
Unexpected form type with a case list form
Custom detail ID mismatch
Unable to link form, missing variable

# XForm parsing
Error parsing XML: {details}
Entities are not allowed

# Server-side only (not applicable to Forge)
invalid case xpath reference
invalid user property xpath reference
practice user config error
error (generic -- privilege/subscription)
```

## APPENDIX B: Reserved Case Property Words

Source: `corehq/apps/app_manager/static/app_manager/json/case-reserved-words.json`

```json
["actions", "case_id", "case_name", "case_type", "case_type_id", "create",
 "closed", "closed_by", "closed_on", "commtrack", "computed_",
 "computed_modified_on_", "date", "date_modified", "date-opened",
 "date_opened", "doc_type", "domain", "external-id", "index", "indices",
 "initial_processing_complete", "last_modified", "modified_on", "modified_by",
 "opened_by", "opened_on", "parent", "referrals", "server_modified_on",
 "server_opened_on", "status", "type", "user_id", "version", "xform_id",
 "xform_ids", "userid"]
```

Note: Forge's `RESERVED_CASE_PROPERTIES` set also includes `name`, `owner_id`, `external_id`, and `date_opened` which are not in HQ's JSON file but are effectively reserved by the case model. This is CORRECT and conservative.

## APPENDIX C: Property Name Validation Regex

HQ's `validate_property()` function uses two patterns:
- **With parent paths**: `^[a-zA-Z][\w_-]*(/[a-zA-Z][\w_-]*)*$`
- **Without parent paths** (subcases): `^[a-zA-Z][\w_-]*$`

Forge's regex: `^[a-zA-Z][\w_-]*$` -- matches the without-parents variant. This is correct for Forge's use case since Forge doesn't generate parent path properties.
