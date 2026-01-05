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
};
