# Production App Pattern Catalog

These compact JSON excerpts were extracted from 3 production CommCare applications to serve as few-shot examples in the CommCare Forge generation prompt. Each excerpt demonstrates specific patterns that Claude should learn to produce.

## Source Apps

| App | Domain | Country | Modules (full) | Excerpt File |
|-----|--------|---------|----------------|--------------|
| Kenya NAWIRI Meal | Nutrition / Livelihoods | Kenya | 213 | `kenya-nawiri-compact-excerpt.json` |
| Hipertensión y Diabetes Integrado | Clinical HTN/DM | Guatemala | 55 | `guatemala-hypertension-compact-excerpt.json` |
| CAUCA Algo Nuevo 2025-2030 | Agricultural Development | Colombia | 17 | `mc-colombia-compact-excerpt.json` |

---

## Kenya NAWIRI: Savings Group Management

**Excerpt:** 3 modules, 4 forms, 109 questions, 49KB

### Patterns Demonstrated

1. **Cascading Lookup Tables (5-level geographic hierarchy)**
   - `ke_county` -> `ke_subcounty` -> `ke_ward` -> `ke_chu` -> `ke_village`
   - Each level filters by the parent selection using `[county_id = /data/Info/county]` filter syntax
   - Shows how to chain `data_source` with `nodeset` filters

2. **Group Registration with Auto-Generated Case Name**
   - Hidden field `group_code` with `calculate: "concat('SILC-', uuid(10))"` generates a unique group identifier
   - Registration form creates `silc_group` case type

3. **Heavy Case Preload for Financial Tracking (14 fields)**
   - SILC Data Collection form preloads 14 financial case properties:
     `cycle_number`, `savings_date`, `group_status_cycle_start`, `members_registered_start`, `cycle_savings_value`, `no_of_loans_outstanding`, `written_off_loans_value`, `bank_balance_socialother`, `value_of_external_debts`, `meeting_frequency`, `meeting_day`, `target_savings_member`, etc.
   - Pattern: `calculate: "instance('casedb')/casedb/case[@case_id = instance('commcaresession')/session/data/case_id]/PROPERTY"`

4. **Member-Level Attendance Tracking**
   - `service_mapping_members` case type represents individual group members
   - Tracks session type (Messaging, Experiential Learning, Training, Session)
   - Multi-select for specific health/nutrition/livelihoods topics received

5. **Multi-Select Health Messaging Categories**
   - Nested conditional sections: "Did you receive Health & Nutrition messaging?" -> if yes, which topics?
   - Repeated for WASH, Livelihoods, and GYSD categories
   - Shows `relevant` conditions controlling form flow

---

## Guatemala Hypertension & Diabetes: Clinical Management

**Excerpt:** 2 modules, 3 forms, 279 questions, 194KB (trimmed from thousands)

### Patterns Demonstrated

1. **Bilingual Spanish/English Clinical App**
   - `labels_by_language` on every question with `es` and `en` translations
   - Language-switching trigger at form start

2. **Patient Registration with Screening Protocol**
   - 357-question registration form (trimmed to ~100 in excerpt)
   - Progressive consent: permission to ask questions -> age verification -> sex -> community
   - Conditional branches based on screening results (possible hypertension, diabetes)
   - Diagnosis confirmation with prior history

3. **Massive Monthly Checkup with Hidden Calculations (1761 questions)**
   - 923 hidden `DataBindOnly` fields for automated clinical calculations
   - 6 case preloads from `patient_htn_dm` case (diagnosis status, medication, phone, reproductive health)
   - Repeat groups for lab history with nested panels (lipid, kidney, liver, HbA1c)
   - Clinical decision labels that conditionally display based on `instance('casedb')` lookups
   - Multi-part form: Part 1 (Promoter) -> Part 2 (Doctor) -> Part 3 (Review)
   - Comment in excerpt: "TRIMMED from 1761 questions... The real form has 923 hidden calc fields and 205 groups"

4. **Lab Ordering Form**
   - Creates lab request records (child case pattern in production)
   - Standard 6-month labs vs. additional non-standard
   - Fasting verification before ordering
   - Hidden calculations for patient identity, dates, and eligibility

5. **Case List Columns for Clinical Triage**
   - Columns: `case_name` (Nombre), `patient_community_final` (Comunidad), `current_htn_assessment` (HTN), `current_dm_assessment` (DM), `check_recent_date` (Ultimo Chequeo)

---

## Colombia CAUCA: Multi-Level Agricultural Characterization

**Excerpt:** 3 modules, 4 forms, 418 questions, 201KB (household form trimmed from 416)

### Patterns Demonstrated

1. **6-Level Case Hierarchy**
   - `CasosPreinscripcionCAR` (pre-registration)
   - `CasosHogarCAR` (household)
   - `CasosIndividuosCAR` (individual family members)
   - `CasosCaracterizaPredioCAR` (land plot characterization)
   - `CasosPrediosCAR` (crops)
   - `CasosLotesCAR` (lots/parcels)
   - Each level links to parent via case relationship

2. **Cascading Lookup Tables for Colombian Admin Units**
   - `departamentos` -> `municipios` -> `corregimientos` -> `veredas`
   - Includes "Other" option with free-text fallback when selection not in list
   - Pattern: `relevant: "/data/.../CorResidencia = 'Otro'"` shows the text input

3. **Heavy casedb Preload (17 fields from pre-registration)**
   - Household characterization preloads: `CedulaPreinscripcion`, `TipoDoc`, `PriNombre_Dri`, `SegNombre_Dri`, `PriApellido_Dri`, `SegApellido_Dri`, `Sexo`, `FechaNac`, `Celular`, `Email`, `NomSecContacto`, `CelSecContacto`, `Parentesco`, `DepartamentoResidencia`, `MunResidencia`, `CorResidencia`, `VerResidencia`
   - All using `instance('casedb')/casedb/case[@case_id = instance('commcaresession')/session/data/case_id]/PROPERTY`

4. **Repeat Groups for Household Member Enumeration**
   - `CaracterizacionIntegrantesHogar` repeat group captures:
     - Personal data (names with proper case enforcement, DOB, ID number, sex)
     - Document photos (front and back)
     - Consent per family member (adult vs. minor vs. third-party)
     - Sociodemographic info (nationality, education, occupation)
     - Women's economic independence questions
   - Each repeat iteration creates a child `CasosIndividuosCAR` case

5. **Regex Validation for Names and IDs**
   - Names: `regex(., '^[A-Za-z...]{3,30}$') and . = concat(upper-case(substr(., 0, 1)), lower-case(substr(., 1)))` enforces proper case
   - Colombian IDs: `regex(., '^[0-9]{6,10}$')`
   - Phone numbers: `regex(., '^((3[0-9]{9})|(60[0-9]{8}))$')` validates Colombian mobile format
   - Email: full RFC-style regex pattern

6. **Document Photo Capture**
   - `upload` type questions for front and back of identification documents
   - Both for primary participant and for each family member in repeat

7. **Novedades (Change Tracking) Pattern**
   - Dedicated form for recording case changes/updates
   - Common pattern in Latin American programs for audit trail

---

## Cross-Cutting Patterns

These patterns appear across multiple apps and should be well-represented in generation output:

| Pattern | Kenya | Guatemala | Colombia |
|---------|-------|-----------|----------|
| Cascading lookup tables | 5-level geo | Community select | 4-level geo |
| Case preload from casedb | 14 fields | 6 fields | 17 fields |
| Hidden calculated fields | UUID generation | 923 clinical calcs | Case data carry-forward |
| Constraint validation | Date ranges, counts | n/a (in hidden calcs) | Regex names, IDs, phones |
| Relevant (skip logic) | Conditional sections | casedb-based branching | Activity-dependent fields |
| Multi-language | English only | Spanish + English | Spanish only |
| Repeat groups | n/a | Lab history | Household members |
| Multi-select questions | Messaging topics | Lab selection | Activities, services |
| Group/member hierarchy | silc_group -> members | patient -> check -> lab | hogar -> individuos -> predio |
