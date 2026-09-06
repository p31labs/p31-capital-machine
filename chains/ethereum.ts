import { ethers } from 'ethers';

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  nativeToken: string;
  stablecoins: string[];
  explorer: string;
  flashbotsRelay?: string;
  loveToken?: string;  // ERC-5192 soulbound token address
  loveMetadata?: string;  // Soulbound token metadata description
}

export const ETH_CONFIG: ChainConfig = {
  name: 'ethereum',
  chainId: 1,
  rpcUrl: '', // Set via env.RPC_URL_ETH
  nativeToken: 'ETH',
  stablecoins: ['USDC', 'USDT', 'DAI', 'LOVE'],
  explorer: 'https://etherscan.io',
  loveToken: '0xLOVE soulbound ERC-5192 contract address',
  loveMetadata: 'LOVE soulbound token for community access',
  flashbotsRelay: 'https://relay.flashbots.net',
};

export class EthereumAdapter {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  getSigner(): ethers.Signer {
    return this.wallet;
  }

  async getBalance(address: string): Promise<bigint> {
    return this.provider.getBalance(address);
  }

  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<bigint> {
    const erc20 = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      this.provider
    );
    return erc20.balanceOf(walletAddress);
  }

  async estimateGas(tx: ethers.TransactionRequest): Promise<bigint> {
    const gas = await this.provider.estimateGas(tx);
    return gas;
  }

  async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice || ethers.parseUnits('10', 'gwei');
  }

  async sendTransaction(to: string, data: string, value?: bigint): Promise<ethers.TransactionResponse> {
    const tx: ethers.TransactionRequest = { to, data };
    if (value) tx.value = value;
    return this.wallet.sendTransaction(tx);
  }

  // sendBundle removed — FlashbotsBundleProvider is not available in ethers v6

  async waitForTransaction(hash: string): Promise<ethers.TransactionReceipt | null> {
    return this.provider.waitForTransaction(hash, 1, 30000);
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }
}
