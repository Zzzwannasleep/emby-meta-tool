export type Env = {
  META_KV: KVNamespace;
  META_BUCKET: R2Bucket;

  TMDB_API_KEY: string;

  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;

  BANGUMI_API_BASE?: string;

  ANIDB_TITLE_INDEX_R2_KEY?: string;

  FETCH_CONCURRENCY?: string;
  FETCH_DELAY_MS?: string;

  // Upload targets
  OPENLIST_ENABLED?: string;
  OPENLIST_BASE?: string;
  OPENLIST_TOKEN?: string;
  OPENLIST_USERNAME?: string;
  OPENLIST_PASSWORD?: string;

  RCLONE_ENABLED?: string;
  RCLONE_RC_URL?: string;
  RCLONE_RC_USER?: string;
  RCLONE_RC_PASS?: string;
  RCLONE_FS?: string;
  RCLONE_BASE_DIR?: string;
};
