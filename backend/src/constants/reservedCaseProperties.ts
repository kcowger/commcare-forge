/**
 * Reserved CommCare case property names.
 * Source: commcare-hq/corehq/apps/app_manager/static/app_manager/json/case-reserved-words.json
 *
 * These cannot be used as keys in case_properties (update_case) or child_case case_properties.
 * They CAN be used as preload VALUES (reading FROM the case, e.g. preloading case_name).
 */
export const RESERVED_CASE_PROPERTIES = new Set([
  'actions',
  'case_id',
  'case_name',
  'case_type',
  'case_type_id',
  'closed',
  'closed_by',
  'closed_on',
  'commtrack',
  'computed_',
  'computed_modified_on_',
  'create',
  'date',
  'date_modified',
  'date-opened',
  'date_opened',
  'doc_type',
  'domain',
  'external-id',
  'external_id',
  'index',
  'indices',
  'initial_processing_complete',
  'last_modified',
  'modified_by',
  'modified_on',
  'name',
  'opened_by',
  'opened_on',
  'owner_id',
  'parent',
  'referrals',
  'server_modified_on',
  'server_opened_on',
  'status',
  'type',
  'user_id',
  'userid',
  'version',
  'xform_id',
  'xform_ids',
])

/**
 * Automatic rename map for ALL 41 reserved words.
 * Every reserved case property gets a unique, collision-free safe name.
 * Used by hqJsonExpander's buildSafeUpdateMap() and child case property expansion.
 */
export const RESERVED_RENAME_MAP: Record<string, string> = {
  actions: 'case_actions',
  case_id: 'case_identifier',
  case_name: 'display_name',
  case_type: 'case_category',
  case_type_id: 'case_type_identifier',
  closed: 'is_closed',
  closed_by: 'closed_by_user',
  closed_on: 'closed_on_date',
  commtrack: 'commtrack_flag',
  computed_: 'computed_field',
  computed_modified_on_: 'computed_modified_date',
  create: 'create_info',
  date: 'visit_date',
  date_modified: 'date_last_modified',
  'date-opened': 'date_first_opened',
  date_opened: 'date_case_opened',
  doc_type: 'document_type',
  domain: 'case_domain',
  'external-id': 'ext_identifier',
  external_id: 'external_identifier',
  index: 'case_index',
  indices: 'case_indices',
  initial_processing_complete: 'processing_done',
  last_modified: 'last_modified_date',
  modified_by: 'modified_by_user',
  modified_on: 'modified_on_date',
  name: 'full_name',
  opened_by: 'opened_by_user',
  opened_on: 'opened_on_date',
  owner_id: 'assigned_owner_id',
  parent: 'parent_case',
  referrals: 'case_referrals',
  server_modified_on: 'server_modified_date',
  server_opened_on: 'server_opened_date',
  status: 'case_status',
  type: 'item_type',
  user_id: 'assigned_user_id',
  userid: 'assigned_userid',
  version: 'form_version',
  xform_id: 'xform_identifier',
  xform_ids: 'xform_identifiers',
}

/** Media/binary question types — cannot be saved as case properties */
export const MEDIA_QUESTION_TYPES = new Set(['image', 'audio', 'video', 'signature'])

/**
 * The full reserved word list as a comma-separated string, for use in prompts.
 */
export const RESERVED_WORDS_CSV = [...RESERVED_CASE_PROPERTIES].sort().join(', ')
