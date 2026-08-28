export const DEFAULT_EMBEDDING_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

export const LOCAL_EMBEDDING_MODEL =
  process.env["EMBEDDING_MODEL"]?.trim() || DEFAULT_EMBEDDING_MODEL;
