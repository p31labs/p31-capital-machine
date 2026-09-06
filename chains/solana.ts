import { Connection, PublicKey, Transaction, VersionedTransaction, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export const SOL_CONFIG = {
  name: 'solana',
  chainId: 101,
  rpcUrl: '',
  nativeToken: 'SOL',
  stablecoins: ['USDC', 'USDT'],
  explorer: 'https://solscan.io',
  jitoBlockEngine: 'https://mainnet.block-engine.jito.wtf',
};

export class SolanaAdapter {
  private connection: Connection;
  private wallet: Keypair;

  constructor(rpcUrl: string, privateKeyBase58: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    const decoded = Buffer.from(privateKeyBase58 as any, 'base64' as any);
    this.wallet = Keypair.fromSecretKey(decoded);
  }

  getConnection() { return this.connection; }
  getWallet() { return this.wallet; }
  getPublicKey() { return this.wallet.publicKey; }

  async getBalance(address: PublicKey): Promise<number> {
    return this.connection.getBalance(address);
  }

  async getTokenBalance(mint: PublicKey, owner: PublicKey): Promise<bigint> {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await this.connection.getTokenAccountBalance(ata);
    return BigInt(account.value.amount);
  }

  async sendTransaction(tx: any): Promise<string> {
    const signature = await this.connection.sendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await this.connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  async sendBundle(txs: VersionedTransaction[]): Promise<string[]> {
    const signatures: string[] = [];
    for (const tx of txs) {
      const sig = await this.sendTransaction(tx);
      signatures.push(sig);
    }
    return signatures;
  }

  async getBlockHeight(): Promise<number> {
    return this.connection.getBlockHeight();
  }

  async getRecentBlockhash(): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    return blockhash;
  }
}
