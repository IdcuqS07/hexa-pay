/**
 * Private Merchant Quote — Frontend Integration
 * 
 * Flow:
 * 1. Merchant encrypts amount → createQuote
 * 2. NFC/QR carries only quoteId
 * 3. Payer optionally previews via permit
 * 4. Payer settles (blind or verified)
 */

import { FhenixClient } from 'fhenixjs';
import { ethers } from 'ethers';

const QUOTE_ABI = [
  'function createQuote(bytes32 id, address payer, bytes calldata amountCt, uint64 expiresAt)',
  'function grantAccess(bytes32 id, address payer)',
  'function settleQuote(bytes32 id, bool skipPreview)',
  'function getQuote(bytes32 id) view returns (address, address, uint64, uint8, bool)',
  'event QuoteCreated(bytes32 indexed id, address indexed merchant, address indexed payer)',
  'event QuoteSettled(bytes32 indexed id, address indexed payer)'
];

export class PrivateMerchantQuoteClient {
  constructor(provider, contractAddress) {
    this.provider = provider;
    this.contract = new ethers.Contract(contractAddress, QUOTE_ABI, provider);
    this.fhenix = new FhenixClient({ provider });
  }

  /**
   * Merchant: Create encrypted quote
   * @param {string} quoteId - Unique identifier (bytes32)
   * @param {string} payerAddress - Authorized payer
   * @param {number} amount - Amount in base units
   * @param {number} expiresAt - Unix timestamp
   */
  async createQuote(quoteId, payerAddress, amount, expiresAt) {
    const signer = this.provider.getSigner();
    const contractWithSigner = this.contract.connect(signer);

    // Encrypt amount
    const amountCt = await this.fhenix.encrypt_uint64(amount);

    // Create quote
    const tx = await contractWithSigner.createQuote(
      quoteId,
      payerAddress,
      amountCt,
      expiresAt
    );

    await tx.wait();
    return { quoteId, txHash: tx.hash };
  }

  /**
   * Merchant: Grant payer access for preview
   * @param {string} quoteId
   * @param {string} payerAddress
   */
  async grantAccess(quoteId, payerAddress) {
    const signer = this.provider.getSigner();
    const contractWithSigner = this.contract.connect(signer);

    const tx = await contractWithSigner.grantAccess(quoteId, payerAddress);
    await tx.wait();
    return tx.hash;
  }

  /**
   * Payer: Preview amount (requires access granted)
   * @param {string} quoteId
   * @returns {number} Decrypted amount
   */
  async previewAmount(quoteId) {
    const signer = this.provider.getSigner();
    const signerAddress = await signer.getAddress();

    // Get quote details
    const quote = await this.contract.getQuote(quoteId);
    if (!quote[4]) { // accessGranted
      throw new Error('Access not granted. Merchant must call grantAccess first.');
    }

    // Create permit
    const permit = await this.fhenix.generatePermit(
      this.contract.address,
      this.provider,
      signerAddress
    );

    // Decrypt amount (via view function or off-chain)
    // Note: Actual implementation depends on CoFHE decrypt pattern
    const amountCt = quote.amountCt; // This would come from contract storage
    const amount = await this.fhenix.unseal(this.contract.address, amountCt);

    return amount;
  }

  /**
   * Payer: Settle quote
   * @param {string} quoteId
   * @param {boolean} skipPreview - If true, blind payment (no preview)
   */
  async settleQuote(quoteId, skipPreview = false) {
    const signer = this.provider.getSigner();
    const contractWithSigner = this.contract.connect(signer);

    const tx = await contractWithSigner.settleQuote(quoteId, skipPreview);
    await tx.wait();
    return tx.hash;
  }

  /**
   * Get quote details (amounts remain encrypted)
   * @param {string} quoteId
   */
  async getQuote(quoteId) {
    const [merchant, payer, expiresAt, status, accessGranted] = 
      await this.contract.getQuote(quoteId);

    return {
      merchant,
      payer,
      expiresAt: Number(expiresAt),
      status: ['None', 'Pending', 'Settled', 'Cancelled', 'Expired'][status],
      accessGranted
    };
  }

  /**
   * Generate NFC/QR payload
   * @param {string} quoteId
   */
  static generatePaymentLink(quoteId) {
    return `hexa://pay?quoteId=${quoteId}`;
  }

  /**
   * Parse NFC/QR payload
   * @param {string} url
   */
  static parsePaymentLink(url) {
    const params = new URL(url).searchParams;
    return params.get('quoteId');
  }
}

// Example usage:
// const client = new PrivateMerchantQuoteClient(provider, contractAddress);
// 
// // Merchant flow:
// const quoteId = ethers.utils.id('invoice-123');
// await client.createQuote(quoteId, payerAddr, 1000000, Date.now() + 3600);
// await client.grantAccess(quoteId, payerAddr);
// 
// // Payer flow:
// const amount = await client.previewAmount(quoteId); // optional
// await client.settleQuote(quoteId, false);
