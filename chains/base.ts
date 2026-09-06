import { ethers } from 'ethers';
import { ChainConfig } from './ethereum';

export const BASE_CONFIG: ChainConfig = {
  name: 'base',
  chainId: 8453,
  rpcUrl: '',
  nativeToken: 'ETH',
  stablecoins: ['USDC', 'DAI'],
  explorer: 'https://basescan.org',
};

export class BaseAdapter {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  getProvider() { return this.provider; }
  getWallet() { return this.wallet; }
  getSigner() { return this.wallet; }

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
    return this.provider.estimateGas(tx);
  }

  async getGasPrice(): Promise<bigint> {
    const fee = await this.provider.getFeeData();
    return fee.gasPrice || ethers.parseUnits('0.1', 'gwei');
  }

  async sendTransaction(to: string, data: string, value?: bigint) {
    const tx: ethers.TransactionRequest = { to, data };
    if (value) tx.value = value;
    return this.wallet.sendTransaction(tx);
  }

  async waitForTransaction(hash: string) {
    return this.provider.waitForTransaction(hash, 1, 30000);
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }
}
