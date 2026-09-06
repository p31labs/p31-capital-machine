-- NFT Royalties Indexing and Collection
-- ============================================================
-- 11. NFT ROYALTY TRACKER
-- ============================================================

CREATE TABLE IF NOT EXISTS nft_collections (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  name TEXT,
  symbol TEXT,
  platform TEXT NOT NULL,
  royalty_percentage REAL DEFAULT 0,
  royalty_recipient TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nft_sales (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  seller TEXT NOT NULL,
  buyer TEXT NOT NULL,
  sale_price TEXT NOT NULL,
  currency TEXT NOT NULL,
  royalty_amount TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  tx_hash TEXT,
  block_number INTEGER,
  marketplace TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  collected_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_nft_collections_chain ON nft_collections(chain);
CREATE INDEX IF NOT EXISTS idx_nft_collections_platform ON nft_collections(platform);
CREATE INDEX IF NOT EXISTS idx_nft_sales_status ON nft_sales(status);
CREATE INDEX IF NOT EXISTS idx_nft_sales_collection ON nft_sales(collection_id);
CREATE INDEX IF NOT EXISTS idx_nft_sales_created ON nft_sales(created_at);
