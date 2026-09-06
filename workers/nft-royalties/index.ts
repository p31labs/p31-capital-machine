import { ethers } from 'ethers';
import { withRetry, withRetryAndFallback, sleep } from '../../shared/retry';
import { respond } from '../../shared/response';
import { createLogger } from '../../shared/logger';
import { CapitalMachineError } from '../../shared/errors';

type D1Database = any;
type KVNamespace = any;
type ScheduledEvent = { cron: string };

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  PRIVATE_KEY_ETH: string;
  OPENSEA_API_KEY: string;
  DISCORD_WEBHOOK: string;
}

// ============================================================
// Types
// ============================================================

interface CollectionRecord {
  id: string;
  chain: string;
  address: string;
  name: string | null;
  symbol: string | null;
  platform: string;
  royalty_percentage: number;
  royalty_recipient: string | null;
  status: string;
  created_at: number;
}

interface SaleRecord {
  id: string;
  collection_id: string;
  token_id: string;
  seller: string;
  buyer: string;
  sale_price: string;
  currency: string;
  royalty_amount: string;
  status: string;
  tx_hash: string | null;
  block_number: number | null;
  marketplace: string;
  created_at: number;
  collected_at: number | null;
}

interface ClaimResult {
  saleId: string;
  txHash: string | null;
  status: 'success' | 'failed' | 'already_collected';
  error?: string;
  gasUsed?: string;
}

interface CollectionInput {
  address: string;
  chain: string;
  platform: string;
  royalty_percentage: number;
  royalty_recipient: string;
  name?: string;
  symbol?: string;
}

interface MarketSale {
  collectionId: string;
  tokenId: string;
  seller: string;
  buyer: string;
  salePrice: bigint;
  currency: string;
  txHash: string;
  blockNumber: number;
  marketplace: string;
  occurredAt: number;
}

// ============================================================
// Logger
// ============================================================

const logger = createLogger('nft-royalties');

// ============================================================
// Marketplace Configurations
// ============================================================

interface MarketplaceConfig {
  name: string;
  exchangeAddress: string;
  abi: readonly string[];
  claimFunction: string;
  royaltyEnforced: boolean;
}

const MARKETPLACES: Record<string, MarketplaceConfig> = {
  opensea: {
    name: 'OpenSea',
    exchangeAddress: '0x00000000006c3852cbEf3e08E8dF289169EdE581',
    abi: [
      'function fulfillAdvancedOrder((bytes32 orderType, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, bytes32 product, bytes32 data, bytes32 orderHash) order, (bytes32[] counterparty, bytes executor, bytes proof) consideration, bytes signature) external payable returns (bytes32 orderId, bytes32 orderHash)',
      'event OrderFulfilled(bytes32 orderHash, address offerer, address zone, address recipient, address offerToken, uint256 offerIdentifier, uint256 offerAmount, address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount)',
    ],
    claimFunction: 'fulfillAdvancedOrder',
    royaltyEnforced: true,
  },
  blur: {
    name: 'Blur',
    exchangeAddress: '0x000000000000Ad818c1cC5aa5786484C0a4F18D1',
    abi: [
      'function execute((address collection, uint256 tokenId, uint256 amount, address payer, bool unwrapNative) sell) external payable',
      'event OrderFulfilled(bytes32 orderHash, address maker, address taker, address collection, uint256 tokenId, uint256 amount)',
    ],
    claimFunction: 'execute',
    royaltyEnforced: true,
  },
  rarible: {
    name: 'Rarible',
    exchangeAddress: '0x9757F3b501362BDe53C7a9bFF3C2E86A807eF653',
    abi: [
      'function exchangeV2((address maker, bytes makerAsset, uint256 makerAmount, bytes takerAsset, uint256 takerAmount, bytes makerAssetData, bytes takerAssetData, uint64 salt, uint256 makingAmount, uint256 takingAmount, bytes orderHash, bytes makerFeeAssetData, bytes takerFeeAssetData) order, address buy, bytes buyAssetData) external',
      'event SellAssetEvent(address maker, address taker, uint256 assetId, bytes assetData, uint256 value)',
    ],
    claimFunction: 'exchangeV2',
    royaltyEnforced: true,
  },
  foundation: {
    name: 'Foundation',
    exchangeAddress: '0x00000000bAFE52A8455E27B09E8fE211208A9E7E',
    abi: [
      'function fulfillPublicSale(bytes32[] calldata proof, uint256 tokenId) external payable',
      'event BidFinalized(uint256 auctionId, address bidder, uint256 amount, uint256 timestamp)',
    ],
    claimFunction: 'fulfillPublicSale',
    royaltyEnforced: true,
  },
};

const MARKETPLACE_EVENT_TOPICS: Record<string, readonly string[]> = {
  opensea: [ethers.id('OrderFulfilled(bytes32,address,address,address,address,uint256,address,uint256,uint256)')],
  blur: [ethers.id('OrderFulfilled(bytes32,address,address,address,uint256,uint256)')],
  rarible: [ethers.id('SellAssetEvent(address,address,uint256,bytes,uint256)')],
  foundation: [ethers.id('BidFinalized(uint256,address,uint256,uint256)')],
};

// ============================================================
// Database Layer
// ============================================================

class RoyaltyDatabase {
  private db: D1Database;
  private kv: KVNamespace;

  constructor(db: D1Database, kv: KVNamespace) {
    this.db = db;
    this.kv = kv;
  }

  async listCollections(params?: {
    chain?: string;
    platform?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<CollectionRecord[]> {
    const { chain, platform, status = 'active', limit = 50, offset = 0 } = params || {};
    let sql = 'SELECT * FROM nft_collections WHERE status = ?';
    const values: any[] = [status];
    if (chain) { sql += ' AND chain = ?'; values.push(chain); }
    if (platform) { sql += ' AND platform = ?'; values.push(platform); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    values.push(limit, offset);
    const result = await this.db.prepare(sql).bind(...values).all();
    return result.results as CollectionRecord[];
  }

  async getCollection(id: string): Promise<CollectionRecord | null> {
    const result = await this.db.prepare(
      'SELECT * FROM nft_collections WHERE id = ?'
    ).bind(id).first();
    return result as CollectionRecord | null;
  }

  async getCollectionByAddress(address: string, chain: string): Promise<CollectionRecord | null> {
    const result = await this.db.prepare(
      'SELECT * FROM nft_collections WHERE address = ? AND chain = ?'
    ).bind(address.toLowerCase(), chain).first();
    return result as CollectionRecord | null;
  }

  async createCollection(collection: CollectionInput): Promise<CollectionRecord> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.db.prepare(
      `INSERT INTO nft_collections (id, chain, address, name, symbol, platform, royalty_percentage, royalty_recipient, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).bind(
      id,
      collection.chain,
      collection.address.toLowerCase(),
      collection.name || null,
      collection.symbol || null,
      collection.platform.toLowerCase(),
      collection.royalty_percentage,
      collection.royalty_recipient.toLowerCase(),
      now
    ).run();
    return this.getCollection(id) as Promise<CollectionRecord>;
  }

  async listSales(params?: {
    collectionId?: string;
    status?: string;
    marketplace?: string;
    limit?: number;
    offset?: number;
  }): Promise<SaleRecord[]> {
    const { collectionId, status, marketplace, limit = 50, offset = 0 } = params || {};
    let sql = 'SELECT * FROM nft_sales WHERE 1=1';
    const values: any[] = [];
    if (collectionId) { sql += ' AND collection_id = ?'; values.push(collectionId); }
    if (status) { sql += ' AND status = ?'; values.push(status); }
    if (marketplace) { sql += ' AND marketplace = ?'; values.push(marketplace); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    values.push(limit, offset);
    const result = await this.db.prepare(sql).bind(...values).all();
    return result.results as SaleRecord[];
  }

  async getPendingSales(collectionId?: string): Promise<SaleRecord[]> {
    let sql = 'SELECT * FROM nft_sales WHERE status = ?';
    const values: any[] = ['pending'];
    if (collectionId) { sql += ' AND collection_id = ?'; values.push(collectionId); }
    sql += ' ORDER BY created_at ASC';
    const result = await this.db.prepare(sql).bind(...values).all();
    return result.results as SaleRecord[];
  }

  async insertSale(sale: MarketSale): Promise<SaleRecord> {
    const id = crypto.randomUUID();
    const royaltyAmount = await calculateRoyalty(sale.salePrice, sale.marketplace, sale.collectionId, this);
    await this.db.prepare(
      `INSERT INTO nft_sales (id, collection_id, token_id, seller, buyer, sale_price, currency, royalty_amount, status, tx_hash, block_number, marketplace, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).bind(
      id,
      sale.collectionId,
      sale.tokenId,
      sale.seller.toLowerCase(),
      sale.buyer.toLowerCase(),
      sale.salePrice.toString(),
      sale.currency,
      royaltyAmount.toString(),
      sale.txHash || null,
      sale.blockNumber,
      sale.marketplace,
      sale.occurredAt
    ).run();
    const result = await this.db.prepare('SELECT * FROM nft_sales WHERE id = ?').bind(id).first();
    return result as SaleRecord;
  }

  async updateSaleStatus(id: string, status: string, collectedAt?: number, txHash?: string): Promise<void> {
    let sql = 'UPDATE nft_sales SET status = ?';
    const values: any[] = [status];
    if (collectedAt) { sql += ', collected_at = ?'; values.push(collectedAt); }
    if (txHash) { sql += ', tx_hash = ?'; values.push(txHash); }
    sql += ' WHERE id = ?';
    values.push(id);
    await this.db.prepare(sql).bind(...values).run();
  }

  async markSalesCollected(ids: string[], txHash: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    await this.db.prepare(
      `UPDATE nft_sales SET status = 'collected', collected_at = ?, tx_hash = ? WHERE id IN (${placeholders})`
    ).bind(now, txHash, ...ids).run();
  }

  async markSalesFailed(ids: string[], reason: string): Promise<void> {
    const placeholders = ids.map(() => '?').join(',');
    await this.db.prepare(
      `UPDATE nft_sales SET status = 'failed' WHERE id IN (${placeholders})`
    ).bind(...ids).run();
  }

  async getStats(): Promise<{
    totalCollected: string;
    totalPending: string;
    totalFailed: string;
    byCollection: Record<string, { collected: string; pending: string; failed: string; count: number }>;
    byPlatform: Record<string, { collected: string; pending: string; failed: string; count: number }>;
    totalSales: number;
    processedToday: number;
  }> {
    const [collectedSum, pendingSum, failedSum, totalRows, todayRows] = await Promise.all([
      this.db.prepare("SELECT COALESCE(SUM(royalty_amount), '0') as total FROM nft_sales WHERE status = 'collected'").first() as Promise<any>,
      this.db.prepare("SELECT COALESCE(SUM(royalty_amount), '0') as total FROM nft_sales WHERE status = 'pending'").first() as Promise<any>,
      this.db.prepare("SELECT COALESCE(SUM(royalty_amount), '0') as total FROM nft_sales WHERE status = 'failed'").first() as Promise<any>,
      this.db.prepare('SELECT COUNT(*) as total FROM nft_sales').first() as Promise<any>,
      this.db.prepare('SELECT COUNT(*) as total FROM nft_sales WHERE created_at > ?').bind(Math.floor(Date.now() / 1000) - 86400).first() as Promise<any>,
    ]);

    const byCollection = await this.db.prepare(
      `SELECT collection_id, status, COALESCE(SUM(royalty_amount), '0') as total, COUNT(*) as count
       FROM nft_sales GROUP BY collection_id, status`
    ).all();

    const collections: Record<string, Record<string, string | number>> = {};
    for (const row of byCollection.results as any[]) {
      if (!collections[row.collection_id]) {
        collections[row.collection_id] = { collected: '0', pending: '0', failed: '0', count: 0 };
      }
      collections[row.collection_id][row.status as string] = row.total;
      (collections[row.collection_id] as any).count += row.count;
    }

    const byPlatform = await this.db.prepare(
      `SELECT marketplace, status, COALESCE(SUM(royalty_amount), '0') as total, COUNT(*) as count
       FROM nft_sales GROUP BY marketplace, status`
    ).all();

    const platforms: Record<string, Record<string, string | number>> = {};
    for (const row of byPlatform.results as any[]) {
      if (!platforms[row.marketplace]) {
        platforms[row.marketplace] = { collected: '0', pending: '0', failed: '0', count: 0 };
      }
      platforms[row.marketplace][row.status as string] = row.total;
      (platforms[row.marketplace] as any).count += row.count;
    }

    return {
      totalCollected: collectedSum.total,
      totalPending: pendingSum.total,
      totalFailed: failedSum.total,
      byCollection: collections as Record<string, { collected: string; pending: string; failed: string; count: number }>,
      byPlatform: platforms as Record<string, { collected: string; pending: string; failed: string; count: number }>,
      totalSales: (totalRows as any).total,
      processedToday: (todayRows as any).total,
    };
  }

  async setKV(key: string, value: any): Promise<void> {
    await this.kv.put(`nft-royalties:${key}`, JSON.stringify(value));
  }

  async getKV(key: string): Promise<any> {
    const raw = await this.kv.get(`nft-royalties:${key}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
}

// ============================================================
// On-chain Indexer
// ============================================================

class RoyaltyIndexer {
  private provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getLastProcessedBlock(collectionId: string, db: RoyaltyDatabase): Promise<number> {
    const key = `lastBlock:${collectionId}`;
    const stored = await db.getKV(key);
    if (stored && typeof stored.blockNumber === 'number') return stored.blockNumber;
    return 0;
  }

  async setLastProcessedBlock(collectionId: string, blockNumber: number, db: RoyaltyDatabase): Promise<void> {
    await db.setKV(`lastBlock:${collectionId}`, { blockNumber });
  }

  async fetchTransferEvents(
    collection: CollectionRecord,
    fromBlock: number,
    toBlock: number
  ): Promise<ethers.Log[]> {
    try {
      const contract = new ethers.Contract(
        collection.address,
        ['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'],
        this.provider
      );

      const filter = contract.filters.Transfer();
      return await withRetry(
        () => this.provider.getLogs({
          ...filter as any,
          fromBlock,
          toBlock,
        }),
        { maxAttempts: 3, baseDelayMs: 500 }
      );
    } catch (error: any) {
      logger.warn('Failed to fetch transfer events', {
        collectionId: collection.id,
        fromBlock,
        toBlock,
        error: error.message,
      });
      return [];
    }
  }

  async fetchMarketplaceSales(
    collection: CollectionRecord,
    fromBlock: number,
    toBlock: number
  ): Promise<MarketSale[]> {
    const marketplaceConfig = MARKETPLACES[collection.platform];
    if (!marketplaceConfig || !marketplaceConfig.royaltyEnforced) return [];

    try {
      const topics = MARKETPLACE_EVENT_TOPICS[collection.platform];
      if (!topics || topics.length === 0) return [];

      const logs = await withRetry(
        () => this.provider.getLogs({
          address: marketplaceConfig.exchangeAddress,
          topics: [topics[0]],
          fromBlock,
          toBlock,
        }),
        { maxAttempts: 3, baseDelayMs: 500 }
      );

      const sales: MarketSale[] = [];
      const now = Math.floor(Date.now() / 1000);

      for (const log of logs) {
        try {
          const sale = this.parseMarketplaceEvent(collection, log);
          if (sale) sales.push(sale);
        } catch {
          continue;
        }
      }

      return sales;
    } catch (error: any) {
      logger.warn('Failed to fetch marketplace sales', {
        collectionId: collection.id,
        error: error.message,
      });
      return [];
    }
  }

  private parseMarketplaceEvent(
    collection: CollectionRecord,
    log: ethers.Log
  ): MarketSale | null {
    const iface = new ethers.Interface(MARKETPLACES[collection.platform].abi);

    try {
      const parsed = iface.parseLog({
        topics: (log as any).topics,
        data: (log as any).data,
      });

      if (!parsed) return null;

      const platform = collection.platform;

      if (platform === 'opensea') {
        const maker = ethers.getAddress(parsed.args[1]);
        const recipient = ethers.getAddress(parsed.args[3]);
        const offerToken = ethers.getAddress(parsed.args[4]);
        const offerAmount = BigInt(parsed.args[6]?.toString?.() || '0');
        const considerationToken = ethers.getAddress(parsed.args[7]);
        const considerationAmount = BigInt(parsed.args[9]?.toString?.() || '0');

        if (offerToken.toLowerCase() !== collection.address.toLowerCase() &&
            considerationToken.toLowerCase() !== collection.address.toLowerCase()) {
          return null;
        }

        const tokenId = offerToken.toLowerCase() === collection.address.toLowerCase()
          ? parsed.args[5].toString()
          : parsed.args[8].toString();

        const salePrice = offerToken.toLowerCase() === collection.address.toLowerCase()
          ? offerAmount
          : considerationAmount;

        return {
          collectionId: collection.id,
          tokenId,
          seller: maker,
          buyer: recipient,
          salePrice,
          currency: 'ETH',
          txHash: (log as any).transactionHash || '',
          blockNumber: (log as any).blockNumber || 0,
          marketplace: platform,
          occurredAt: Math.floor(Date.now() / 1000),
        };
      }

      if (platform === 'blur') {
        const maker = ethers.getAddress(parsed.args[1]);
        const taker = ethers.getAddress(parsed.args[2]);
        const nftAddress = ethers.getAddress(parsed.args[3]);
        const tokenId = parsed.args[4].toString();
        const amount = BigInt(parsed.args[5]?.toString?.() || '0');

        if (nftAddress.toLowerCase() !== collection.address.toLowerCase()) return null;

        return {
          collectionId: collection.id,
          tokenId,
          seller: maker,
          buyer: taker,
          salePrice: amount,
          currency: 'ETH',
          txHash: (log as any).transactionHash || '',
          blockNumber: (log as any).blockNumber || 0,
          marketplace: platform,
          occurredAt: Math.floor(Date.now() / 1000),
        };
      }

      if (platform === 'rarible') {
        const maker = ethers.getAddress(parsed.args[0]);
        const taker = ethers.getAddress(parsed.args[1]);
        const value = BigInt(parsed.args[4]?.toString?.() || '0');
        return {
          collectionId: collection.id,
          tokenId: '0',
          seller: maker,
          buyer: taker,
          salePrice: value,
          currency: 'ETH',
          txHash: (log as any).transactionHash || '',
          blockNumber: (log as any).blockNumber || 0,
          marketplace: platform,
          occurredAt: Math.floor(Date.now() / 1000),
        };
      }

      if (platform === 'foundation') {
        const bidder = ethers.getAddress(parsed.args[1]);
        const amount = BigInt(parsed.args[2]?.toString?.() || '0');
        return {
          collectionId: collection.id,
          tokenId: '0',
          seller: '0x0000000000000000000000000000000000000000',
          buyer: bidder,
          salePrice: amount,
          currency: 'ETH',
          txHash: (log as any).transactionHash || '',
          blockNumber: (log as any).blockNumber || 0,
          marketplace: platform,
          occurredAt: Math.floor(Date.now() / 1000),
        };
      }

      return null;
    } catch (error: any) {
      logger.warn('Failed to parse marketplace event', {
        platform: collection.platform,
        error: error.message,
      });
      return null;
    }
  }

  async indexSalesForCollection(collection: CollectionRecord, db: RoyaltyDatabase): Promise<number> {
    const lastBlock = await this.getLastProcessedBlock(collection.id, db);
    const currentBlock = await this.getCurrentBlock();

    if (lastBlock >= currentBlock) return 0;

    const batchSize = 1000;
    let batchStart = lastBlock;
    let totalIndexed = 0;

    while (batchStart < currentBlock) {
      const batchEnd = Math.min(batchStart + batchSize, currentBlock);

      const [transferEvents, marketplaceSales] = await Promise.all([
        this.fetchTransferEvents(collection, batchStart, batchEnd),
        this.fetchMarketplaceSales(collection, batchStart, batchEnd),
      ]);

      const makerSales = new Map<string, MarketSale>();
      for (const sale of marketplaceSales) {
        const key = `${sale.seller}-${sale.buyer}-${sale.tokenId}`;
        makerSales.set(key, sale);
      }

      const existingSales = await db.listSales({ collectionId: collection.id, limit: 10000 });
      const existingTxHashes = new Set(existingSales.map(s => s.tx_hash).filter(Boolean));

      for (const [, sale] of makerSales) {
        if (existingTxHashes.has(sale.txHash)) continue;

        try {
          await db.insertSale(sale);
          totalIndexed++;
          existingTxHashes.add(sale.txHash);
        } catch (error: any) {
          if (error.message?.includes('UNIQUE constraint')) continue;
          logger.error('Failed to insert sale', error, { sale });
        }
      }

      const newEnd = Math.max(batchStart, batchEnd - 100);
      if (batchEnd >= currentBlock) {
        await this.setLastProcessedBlock(collection.id, currentBlock, db);
      } else {
        await this.setLastProcessedBlock(collection.id, newEnd, db);
      }

      batchStart = batchEnd;

      if (batchStart < currentBlock) {
        await sleep(200);
      }
    }

    return totalIndexed;
  }
}

// ============================================================
// Royalty Collector
// ============================================================

interface CollectGroup {
  marketplace: string;
  collection: CollectionRecord;
  sales: SaleRecord[];
  totalAmount: bigint;
  claims: any[];
}

class RoyaltyCollector {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  async collectForMarketplace(db: RoyaltyDatabase, group: CollectGroup, env: Env): Promise<ClaimResult[]> {
    const results: ClaimResult[] = [];
    const config = MARKETPLACES[group.marketplace];

    if (!config) {
      return group.sales.map(sale => ({
        saleId: sale.id,
        txHash: null,
        status: 'failed' as const,
        error: `Unknown marketplace: ${group.marketplace}`,
      }));
    }

    for (const sale of group.sales) {
      try {
        const result = await withRetry(
          () => this.collectRoyalty(db, sale, group.collection, config, env),
          { maxAttempts: 3, baseDelayMs: 2000 }
        );
        results.push(result);
      } catch (error: any) {
        logger.error('Royalty collection failed', error, {
          saleId: sale.id,
          marketplace: group.marketplace,
          collector: group.collection.royalty_recipient,
        });
        results.push({
          saleId: sale.id,
          txHash: null,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return results;
  }

  private async collectRoyalty(
    db: RoyaltyDatabase,
    sale: SaleRecord,
    collection: CollectionRecord,
    config: MarketplaceConfig,
    env: Env
  ): Promise<ClaimResult> {
    const checkTxKey = `collected:${sale.id}`;
    const existingCheck = await db.getKV(checkTxKey);
    if (existingCheck === sale.tx_hash || existingCheck === 'collected') {
      return {
        saleId: sale.id,
        txHash: sale.tx_hash,
        status: 'already_collected',
      };
    }

    if (!collection.royalty_recipient) {
      return {
        saleId: sale.id,
        txHash: null,
        status: 'failed',
        error: 'No royalty recipient configured',
      };
    }

    const contract = new ethers.Contract(
      config.exchangeAddress,
      config.abi,
      this.wallet
    );

    const salePrice = BigInt(sale.sale_price);
    const royaltyPercentage = collection.royalty_percentage / 100;
    const royaltyWei = (salePrice * BigInt(Math.round(royaltyPercentage * 10000))) / 10000n;

    let txHash: string;
    let anyTxHash: string | null = null;

    let tx: ethers.TransactionResponse;

    try {
      if (config.claimFunction === 'fulfillAdvancedOrder') {
        const order: any = {
          orderType: 0,
          offerer: sale.seller,
          zone: ethers.ZeroAddress,
          offerToken: collection.address.toLowerCase(),
          offerIdentifier: BigInt(sale.token_id),
          offerAmount: BigInt(Math.max(1, parseInt(sale.token_id) || 1)),
          considerationToken: ethers.ZeroAddress,
          considerationIdentifier: 0,
          considerationAmount: royaltyWei,
          product: ethers.id(''),
          data: '0x',
          orderHash: ethers.id(`order:${sale.id}`),
        };
        const consideration: any = {
          counterparty: [],
          executor: ethers.ZeroAddress,
          proof: [],
        };
        const signature = '0x';

        tx = await contract.fulfillAdvancedOrder(order, consideration, signature, {
          value: royaltyWei,
          gasLimit: 300000,
        });
        txHash = tx.hash;
        anyTxHash = tx.hash;
      } else if (config.claimFunction === 'execute') {
        const sellStruct: any = {
          collection: collection.address.toLowerCase(),
          tokenId: BigInt(sale.token_id),
          amount: 1,
          payer: sale.seller,
          unwrapNative: false,
        };
        tx = await contract.execute(sellStruct, {
          value: royaltyWei,
          gasLimit: 300000,
        });
        txHash = tx.hash;
        anyTxHash = tx.hash;
      } else if (config.claimFunction === 'exchangeV2') {
        const order: any = {
          maker: sale.seller,
          makerAsset: '0x',
          makerAmount: royaltyWei,
          takerAsset: '0x',
          takerAmount: 0,
          makerAssetData: '0x',
          takerAssetData: '0x',
          salt: BigInt(Math.floor(Date.now() / 1000)),
          makingAmount: royaltyWei,
          takingAmount: 0,
          orderHash: ethers.id(`order:${sale.id}`),
          makerFeeAssetData: '0x',
          takerFeeAssetData: '0x',
        };
        tx = await contract.exchangeV2(order, sale.buyer, '0x', {
          value: royaltyWei,
          gasLimit: 300000,
        });
        txHash = tx.hash;
        anyTxHash = tx.hash;
      } else if (config.claimFunction === 'fulfillPublicSale') {
        const proof: string[] = [];
        const tokenId = BigInt(sale.token_id);
        tx = await contract.fulfillPublicSale(proof, tokenId, {
          value: royaltyWei,
          gasLimit: 300000,
        });
        txHash = tx.hash;
        anyTxHash = tx.hash;
      } else {
        return {
          saleId: sale.id,
          txHash: null,
          status: 'failed',
          error: `Unsupported claim function: ${config.claimFunction}`,
        };
      }

      const receipt = await tx.wait();
      if (!receipt) {
        return {
          saleId: sale.id,
          txHash,
          status: 'failed',
          error: 'Transaction receipt not found',
        };
      }
      const gasUsed = receipt.gasUsed.toString();

      await db.setKV(checkTxKey, 'collected');

      logger.info('Royalty collected successfully', {
        saleId: sale.id,
        txHash,
        marketplace: config.name,
        gasUsed,
      });

      if (!receipt) {
  return {
    saleId: sale.id,
    txHash,
    status: 'failed',
    error: 'Transaction receipt not found',
  };
}

      await notifyDiscord(env, sale, collection, txHash, receipt.blockNumber);

      return {
        saleId: sale.id,
        txHash,
        status: 'success',
        gasUsed,
      };
    } catch (error: any) {
      logger.error('Royalty claim transaction failed', error, {
        saleId: sale.id,
        marketplace: config.name,
      });
      return {
        saleId: sale.id,
        txHash: anyTxHash,
        status: 'failed',
        error: error.message,
      };
    }
  }
}

// ============================================================
// Stats
// ============================================================

async function getRoyaltyStats(db: RoyaltyDatabase): Promise<any> {
  return db.getStats();
}

// ============================================================
// Helpers
// ============================================================

async function calculateRoyalty(
  salePrice: bigint,
  marketplace: string,
  collectionId: string,
  db: RoyaltyDatabase
): Promise<bigint> {
  const collection = await db.getCollection(collectionId);
  const royaltyPct = collection ? collection.royalty_percentage : 5;
  const royalty = (salePrice * BigInt(Math.round(royaltyPct * 100))) / 10000n;
  return royalty;
}

async function notifyDiscord(
  env: Env,
  sale: SaleRecord,
  collection: CollectionRecord,
  txHash: string,
  blockNumber: number
): Promise<void> {
  if (!env.DISCORD_WEBHOOK) return;

  const message = {
    embeds: [{
      title: 'Royalty Collected',
      description: `Collected royalty for ${collection.name || collection.address}`,
      color: 0x10b981,
      fields: [
        { name: 'Sale ID', value: sale.id, inline: true },
        { name: 'Token ID', value: sale.token_id, inline: true },
        { name: 'Amount', value: `${sale.royalty_amount} ${sale.currency}`, inline: true },
        { name: 'Marketplace', value: collection.platform, inline: true },
        { name: 'Tx', value: `https://etherscan.io/tx/${txHash}`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    await fetch(env.DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch {
    // silent
  }
}

async function notifyError(env: Env, error: Error, context: Record<string, any> = {}): Promise<void> {
  if (!env.DISCORD_WEBHOOK) return;

  const message = {
    embeds: [{
      title: 'NFT Royalty Worker Error',
      description: error.message,
      color: 0xef4444,
      fields: Object.entries(context).map(([k, v]) => ({
        name: k,
        value: String(v),
        inline: true,
      })),
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    await fetch(env.DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch {
    // silent
  }
}

// ============================================================
// Worker
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const loggerCtx = createLogger('nft-royalties-fetch');
    const db = new RoyaltyDatabase(env.CAPITAL_DB, env.CAPITAL_KV);

    try {
      // GET /collections
      if (path === '/collections' && method === 'GET') {
        const chain = url.searchParams.get('chain') || undefined;
        const platform = url.searchParams.get('platform') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        const collections = await db.listCollections({ chain, platform, limit, offset });

        const platforms = Object.keys(MARKETPLACES);
        return new Response(JSON.stringify({
          success: true,
          data: collections,
          meta: { count: collections.length, platforms },
          timestamp: Date.now(),
          requestId: crypto.randomUUID().slice(0, 12),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // POST /collection
      if (path === '/collection' && method === 'POST') {
        const body = (await request.json()) as CollectionInput;
        const required = ['address', 'chain', 'platform', 'royalty_percentage', 'royalty_recipient'];
        const missing = required.filter(f => !(f in body));
        if (missing.length > 0) {
          return respond.badRequest(`Missing required fields: ${missing.join(', ')}`);
        }

        if (!MARKETPLACES[body.platform.toLowerCase()]) {
          return respond.badRequest(`Unsupported platform: ${body.platform}. Supported: ${Object.keys(MARKETPLACES).join(', ')}`);
        }

        const existing = await db.getCollectionByAddress(body.address, body.chain);
        if (existing) {
          return respond.badRequest('Collection already tracked');
        }

        const collection = await db.createCollection(body);
        if (collection) {
          return respond.created({
            id: collection.id,
            address: collection.address,
            chain: collection.chain,
            platform: collection.platform,
            royalty_percentage: collection.royalty_percentage,
            royalty_recipient: collection.royalty_recipient,
          });
        }

        return respond.error('Failed to create collection', 500, 'DB_ERROR');
      }

      // GET /sales
      if (path === '/sales' && method === 'GET') {
        const collectionId = url.searchParams.get('collection') || undefined;
        const status = url.searchParams.get('status') || undefined;
        const marketplace = url.searchParams.get('marketplace') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        const sales = await db.listSales({ collectionId, status, marketplace, limit, offset });
        return new Response(JSON.stringify({
          success: true,
          data: sales,
          meta: { count: sales.length, filters: { collectionId, status, marketplace } },
          timestamp: Date.now(),
          requestId: crypto.randomUUID().slice(0, 12),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // POST /collect
      if (path === '/collect' && method === 'POST') {
        const body = (await request.json()) as Partial<{ collectionId?: string; limit?: number }>;
        const limit = body.limit || 50;

        const pendingSales = await db.getPendingSales(body.collectionId);
        if (pendingSales.length === 0) {
          return respond.ok({ message: 'No pending royalties to collect', collected: 0 });
        }

        if (pendingSales.length > limit) {
          return respond.badRequest(`Too many pending sales: ${pendingSales.length}. Use limit=${limit} or process in batches.`);
        }

        const groups = groupByMarketplace(pendingSales, db);
        const collector = new RoyaltyCollector(env.RPC_URL_ETH, env.PRIVATE_KEY_ETH);
        const allResults: ClaimResult[] = [];

        for (const group of groups) {
          const results = await collector.collectForMarketplace(db, group, env);
          allResults.push(...results);

          const successIds: string[] = [];
          const failedIds: string[] = [];
          for (const result of results) {
            if (result.status === 'success') {
              successIds.push(result.saleId);
            } else if (result.status === 'failed') {
              failedIds.push(result.saleId);
            }
          }

          if (successIds.length > 0) {
            const anySuccess = results.find((r) => r.status === 'success');
            await db.markSalesCollected(successIds, anySuccess?.txHash || '');
          }
          if (failedIds.length > 0) {
            const anyFailed = results.find((r) => r.status === 'failed');
            await db.markSalesFailed(failedIds, anyFailed?.error || 'Collection failed');
          }
        }

        const successCount = allResults.filter((r) => r.status === 'success').length;
        const failedCount = allResults.filter((r) => r.status === 'failed').length;
        const alreadyCount = allResults.filter((r) => r.status === 'already_collected').length;

        return new Response(JSON.stringify({
          success: true,
          data: {
            collected: successCount,
            failed: failedCount,
            alreadyCollected: alreadyCount,
            totalProcessed: allResults.length,
            results: allResults,
          },
          timestamp: Date.now(),
          requestId: crypto.randomUUID().slice(0, 12),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // GET /stats
      if (path === '/stats' && method === 'GET') {
        const stats = await getRoyaltyStats(db);
        return new Response(JSON.stringify({
          success: true,
          data: stats,
          timestamp: Date.now(),
          requestId: crypto.randomUUID().slice(0, 12),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // POST /webhook/opensea
      if (path === '/webhook/opensea' && method === 'POST') {
        const body = (await request.json()) as Record<string, any>;
        const collectionId = body.collection_id;
        const tokenId = body.token_id;
        const seller = body.seller;
        const buyer = body.buyer;
        const salePrice = body.sale_price;
        const txHash = body.tx_hash;

        if (!collectionId || !tokenId || !salePrice || !buyer) {
          return respond.badRequest('Missing required fields');
        }

        const collection = await db.getCollection(collectionId);
        if (!collection) {
          return respond.notFound('Collection not found');
        }

        const sale: MarketSale = {
          collectionId,
          tokenId: String(tokenId),
          seller: seller || '0x0000000000000000000000000000000000000000',
          buyer,
          salePrice: BigInt(salePrice.toString()),
          currency: body.currency || 'ETH',
          txHash: txHash || '',
          blockNumber: body.block_number || 0,
          marketplace: 'opensea',
          occurredAt: Math.floor(Date.now() / 1000),
        };

        await db.insertSale(sale);
        return respond.created({ message: 'Sale recorded', saleId: sale.collectionId });
      }

      return respond.notFound('Endpoint not found');
    } catch (error: any) {
      loggerCtx.error('Fetch handler failed', error);

      await notifyError(env, error, { path, method });

      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        code: 'HANDLER_ERROR',
        timestamp: Date.now(),
        requestId: crypto.randomUUID().slice(0, 12),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: { cron: string }, env: Env): Promise<void> {
    const loggerCtx = createLogger('nft-royalties-scheduled');

    try {
      switch (event.cron) {
        case '*/5 * * * *':
          await loggerCtx.timed('index_sales', async () => {
            const db = new RoyaltyDatabase(env.CAPITAL_DB, env.CAPITAL_KV);
            const indexer = new RoyaltyIndexer(env.RPC_URL_ETH);
            const collections = await db.listCollections({ status: 'active', limit: 100 });

            let totalIndexed = 0;
            for (const collection of collections) {
              try {
                const count = await indexer.indexSalesForCollection(collection, db);
                totalIndexed += count;
              } catch (error: any) {
                loggerCtx.warn('Indexing failed for collection', {
                  collectionId: collection.id,
                  error: error.message,
                });
              }
            }

            if (totalIndexed > 0) {
              loggerCtx.info('Indexing complete', { totalIndexed });
            }
          });
          break;

        case '0 * * * *':
          await loggerCtx.timed('hourly_health', async () => {
            const db = new RoyaltyDatabase(env.CAPITAL_DB, env.CAPITAL_KV);
            const pendingRevenue = await db.getStats();
            const pendingCount = (await db.listSales({ status: 'pending', limit: 1000 })).length;

            const envInfo = {
              pendingRevenueWei: pendingRevenue.totalPending,
              pendingCount,
              totalSales: pendingRevenue.totalSales,
            };

            loggerCtx.info('Hourly health check', envInfo);

            if (pendingCount > 200) {
              await notifyError(env, new Error(`High pending royalty backlog: ${pendingCount}`), {
                totalPending: pendingRevenue.totalPending,
              });
            }
          });
          break;
      }
    } catch (error: any) {
      loggerCtx.error('Scheduled task failed', error, { cron: event.cron });
      await notifyError(env, error, { cron: event.cron });
    }
  },
};

// ============================================================
// Helpers
// ============================================================

function groupByMarketplace(sales: SaleRecord[], db: RoyaltyDatabase): CollectGroup[] {
  const groups = new Map<string, CollectGroup>();

  for (const sale of sales) {
    const key = sale.marketplace;
    if (!groups.has(key)) {
      const placeholderCollection: CollectionRecord = {
        id: sale.collection_id,
        chain: 'ethereum',
        address: '0x0000000000000000000000000000000000000000',
        name: null,
        symbol: null,
        platform: sale.marketplace,
        royalty_percentage: 5,
        royalty_recipient: null,
        status: 'active',
        created_at: Math.floor(Date.now() / 1000),
      };
      groups.set(key, {
        marketplace: sale.marketplace,
        collection: placeholderCollection,
        sales: [],
        totalAmount: BigInt(0),
        claims: [],
      });
    }
    const group = groups.get(key)!;
    group.sales.push(sale);
    group.totalAmount += BigInt(sale.royalty_amount);
  }

  return Array.from(groups.values());
}
