import { SigningStargateClient, Coin, StargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

export const COSMOS_CONFIG = {
  name: 'cosmos',
  chainId: 'cosmoshub-4',
  rpcUrl: '',
  nativeToken: 'ATOM',
  stablecoins: ['USDC'],
  explorer: 'https://mintscan.io/cosmos',
  prefix: 'cosmos',
};

export class CosmosAdapter {
  private rpcUrl: string;
  private client: StargateClient | null = null;
  private signingClient: SigningStargateClient | null = null;
  private wallet: DirectSecp256k1HdWallet | null = null;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async connect(mnemonic: string) {
    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: COSMOS_CONFIG.prefix,
    });
    this.client = await StargateClient.connect(this.rpcUrl);
    this.signingClient = await SigningStargateClient.connectWithSigner(
      this.rpcUrl,
      this.wallet
    );
  }

  async getBalance(address: string): Promise<Coin | null> {
    if (!this.client) throw new Error('Not connected');
    const balances = await this.client.getAllBalances(address);
    return balances.find(b => b.denom === 'uatom') || null;
  }

  async delegate(validatorAddress: string, amount: Coin): Promise<string> {
    if (!this.signingClient || !this.wallet) throw new Error('Not connected');
    const [account] = await this.wallet.getAccounts();
    const result = await this.signingClient.delegateTokens(
      account.address,
      validatorAddress,
      amount,
      'auto'
    );
    return result.transactionHash;
  }

  async withdrawRewards(validatorAddress: string): Promise<string> {
    if (!this.signingClient || !this.wallet) throw new Error('Not connected');
    const [account] = await this.wallet.getAccounts();
    const result = await this.signingClient.withdrawRewards(
      account.address,
      validatorAddress,
      'auto'
    );
    return result.transactionHash;
  }

  async getDelegations(address: string): Promise<any[]> {
    if (!this.client) throw new Error('Not connected');
    return this.client.getDelegation(address, '').then(r => r ? [r] : []);
  }

  async getBlockHeight(): Promise<number> {
    if (!this.client) throw new Error('Not connected');
    const height = await this.client.getHeight();
    return height;
  }
}
