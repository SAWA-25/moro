const EXACT_BACKUP_KEYS = new Set([
  'os_active_persona_id',
  'os_default_persona_id',
  'os_last_active_char_id',
  'worldbook_group_toggles',
  'worldbook_group_scopes',
  'worldbook_group_settings',
  'os_preset_enabled',
  'os_preset_active_id',
  'os_preset_apply_sampling',
  'os_preset_global_scopes',
  'os_preset_default_disabled_v1',
  'moro_global_regex_scripts',
  'moro_takeout_custom_dishes_v1',
  'moro_takeout_custom_stores_v1',
  'moro_takeout_search_history_v1',
  'moro_takeout_address_cards_v1',
  'moro_takeout_addresses_v1',
  'moro_takeout_address',
  'moro_takeout_taste_profiles_v1',
  'moro_takeout_pinned_v1',
  'moro_takeout_stores_v1',
  'moro_takeout_member_v1',
  'moro_takeout_footprints_v1',
  'moro_takeout_saved_carts_v1',
  'moro_shop_dynamic_items_v1',
  'moro_shop_catalog_v1',
  'study_api_config',
  'study_tutor_presets',
  'chat_translate_source_lang',
  'chat_translate_lang',
  'chat_archive_prompts',
  'chat_active_archive_prompt_id',
  'character_refine_prompts',
  'character_active_refine_prompt_id',
  'almanac_promise_theme',
  'handbook_lifestream_depth',
  'groupchat_context_limit',
  'browser_brave_key',
  'browser_use_real_search',
  'bm25_mode',
]);

const BACKUP_PREFIXES = [
  'mp_lastMsgId_',
  'mp_personality_tried_',
  'mp_first_archive_notice_',
  'chat_translate_enabled_',
  'chat_translate_source_lang_',
  'chat_translate_lang_',
  'worldbook_',
  'os_preset_',
  'moro_takeout_custom_',
  'moro_takeout_search_',
  'moro_takeout_address',
  'moro_takeout_taste_',
  'moro_takeout_pinned_',
  'moro_takeout_stores_',
  'moro_takeout_member_',
  'moro_takeout_footprints_',
  'moro_takeout_saved_carts_',
  'moro_shop_',
];

const EXACT_TEMP_KEYS = new Set([
  'moro_import_in_progress_v1',
  'moro_takeout_intent_v1',
  'instant_push_trace_log_v1',
  'autonomous_life_catchup_busy',
]);

const TEMP_KEY_PARTS = [
  '_intent_',
  '_trace_',
  '_busy',
  '_busy_',
  '_progress_',
  '_lock_',
];

export function isTemporaryLocalStorageKey(key: string): boolean {
  if (!key) return false;
  if (EXACT_TEMP_KEYS.has(key)) return true;
  return TEMP_KEY_PARTS.some(part => key.includes(part));
}

export function shouldBackupLocalStorageKey(key: string): boolean {
  if (!key || isTemporaryLocalStorageKey(key)) return false;
  return EXACT_BACKUP_KEYS.has(key) || BACKUP_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function collectLocalStorageSnapshot(storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): Record<string, string> | undefined {
  if (!storage) return undefined;
  const snapshot: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !shouldBackupLocalStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (typeof value === 'string') snapshot[key] = value;
  }
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export function restoreLocalStorageSnapshot(snapshot: Record<string, string> | undefined, storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): void {
  if (!storage || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value !== 'string' || !shouldBackupLocalStorageKey(key)) continue;
    storage.setItem(key, value);
  }
}
