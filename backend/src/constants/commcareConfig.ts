/**
 * Centralized CommCare configuration constants.
 * Single source of truth for all hardcoded CommCare values — doc_types, version numbers,
 * XML namespaces, type maps, regex patterns, and default app flags.
 *
 * Any value that appears in HQ import JSON, suite.xml, profile.ccpr, or XForm XML
 * should be defined here, not inline in service files.
 */

// =====================================================================
// Doc Types
// =====================================================================

export const DOC_TYPES = {
  Application: 'Application',
  Module: 'Module',
  Form: 'Form',
  FormActions: 'FormActions',
  OpenCaseAction: 'OpenCaseAction',
  UpdateCaseAction: 'UpdateCaseAction',
  FormAction: 'FormAction',
  PreloadAction: 'PreloadAction',
  OpenSubCaseAction: 'OpenSubCaseAction',
  FormActionCondition: 'FormActionCondition',
  DetailPair: 'DetailPair',
  Detail: 'Detail',
  DetailColumn: 'DetailColumn',
  CaseList: 'CaseList',
  CaseListForm: 'CaseListForm',
  CaseSearch: 'CaseSearch',
  CaseReferences: 'CaseReferences',
  BuildSpec: 'BuildSpec',
  Profile: 'Profile',
} as const

// =====================================================================
// Build & Version
// =====================================================================

/** CommCare mobile platform version */
export const BUILD_SPEC_VERSION = '2.53.0'

/** HQ application schema version */
export const APPLICATION_VERSION = '2.0'

// =====================================================================
// XForm XML Namespaces
// =====================================================================

export const XFORM_NAMESPACES = {
  h: 'http://www.w3.org/1999/xhtml',
  xforms: 'http://www.w3.org/2002/xforms',
  xsd: 'http://www.w3.org/2001/XMLSchema',
  jr: 'http://openrosa.org/javarosa',
  jrm: 'http://dev.commcarehq.org/jr/xforms',
} as const

/** OpenRosa form designer xmlns prefix */
export const XMLNS_PREFIX = 'http://openrosa.org/formdesigner/'

// =====================================================================
// Question Type → XSD Type Map
// =====================================================================

export const XSD_TYPE_MAP: Record<string, string | null> = {
  text: 'xsd:string',
  phone: 'xsd:string',
  int: 'xsd:int',
  long: 'xsd:long',
  decimal: 'xsd:decimal',
  date: 'xsd:date',
  time: 'xsd:time',
  datetime: 'xsd:dateTime',
  geopoint: 'xsd:string',
  barcode: 'xsd:string',
  image: 'xsd:string',
  audio: 'xsd:string',
  video: 'xsd:string',
  signature: 'xsd:string',
  hidden: 'xsd:string',
  secret: 'xsd:string',
  trigger: null,
  group: null,
  repeat: null,
  select1: 'xsd:string',
  select: 'xsd:string',
}

// =====================================================================
// Question Type → Appearance Attribute
// =====================================================================

export const APPEARANCE_MAP: Record<string, string> = {
  phone: 'numeric',
}

// =====================================================================
// Upload/Media Question Type → mediatype Attribute
// =====================================================================

export const MEDIA_TYPE_MAP: Record<string, string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
  signature: 'image/*',
}

/** Appearance override for signature uploads */
export const SIGNATURE_APPEARANCE = 'signature'

// =====================================================================
// Form Action Condition Factories
// =====================================================================

export function makeCondition(type: 'always' | 'never' | 'if', opts?: { question?: string; answer?: string; operator?: string }) {
  return {
    type,
    question: opts?.question ?? null,
    answer: opts?.answer ?? null,
    operator: opts?.operator ?? null,
    doc_type: DOC_TYPES.FormActionCondition,
  }
}

// =====================================================================
// Validation Regex Patterns
// =====================================================================

export const VALIDATION_PATTERNS = {
  /** HQ regex for valid case property names */
  CASE_PROPERTY: /^[a-zA-Z][\w_-]*$/,
  /** HQ regex for valid case type names */
  CASE_TYPE: /^[\w-]+$/,
  /** HQ regex for valid detail column fields (supports namespaced/nested/hash-prefixed) */
  DETAIL_FIELD: /^([a-zA-Z][\w_-]*:)*([a-zA-Z][\w_-]*\/)*#?[a-zA-Z][\w_-]*$/,
  /** Valid XForm data path */
  XFORM_PATH: /^\/data\/[a-zA-Z0-9_/]+$/,
  /** Valid case type identifier (stricter — must start with letter) */
  CASE_TYPE_STRICT: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
  /** Valid XML element / case property name */
  XML_ELEMENT_NAME: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
} as const

/** Standard create block properties — not user-defined case properties */
export const STANDARD_CREATE_PROPS = new Set(['case_type', 'case_name', 'owner_id'])

// =====================================================================
// Default Application Flags
// =====================================================================

export const DEFAULT_APP_FLAGS = {
  vellum_case_management: true,
  cloudcare_enabled: false,
  case_sharing: false,
  secure_submissions: false,
} as const

// =====================================================================
// Default Module Settings
// =====================================================================

export const DEFAULT_MODULE_TYPE = 'basic' as const

export const MODULE_TYPES = ['basic', 'advanced', 'shadow', 'report'] as const
export const FORM_TYPES = ['module_form', 'advanced_form', 'shadow_form'] as const
export const REQUIRES_VALUES = ['none', 'case'] as const

// =====================================================================
// Profile Constants (profile.ccpr)
// =====================================================================

export const PROFILE = {
  XMLNS: 'http://cihi.commcarehq.org/jad',
  UPDATE_URL: 'http://localhost/update',
  VERSION: '1',
  PROPERTIES: {
    APP_NAME: 'CommCare App Name',
    CONTENT_VERSION: 'cc-content-version',
    APP_VERSION: 'cc-app-version',
  },
} as const

// =====================================================================
// Suite Constants (suite.xml)
// =====================================================================

export const SUITE = {
  VERSION: '1',
  CASEDB_INSTANCE_ID: 'casedb',
  CASEDB_INSTANCE_SRC: 'jr://instance/casedb',
  SESSION_INSTANCE_ID: 'commcaresession',
  SESSION_INSTANCE_SRC: 'jr://instance/session',
} as const

// =====================================================================
// Detail Defaults
// =====================================================================

export const DETAIL_DEFAULTS = {
  model: 'case',
  format: 'plain',
  calc_xpath: '.',
  filter_xpath: '',
  advanced: '',
  late_flag: 30,
  time_ago_interval: 365.25,
  persistent_case_context_xml: 'case_name',
} as const
