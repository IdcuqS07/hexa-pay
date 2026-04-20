import { ethers } from "ethers";
import QuoteABI from "./abi/PrivateMerchantQuote.json";

// Deployed contract address from Anvil
const CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

export interface Quote {
  merchant: string;
  payer: string;
  expiresAt: bigint;
  status: number;
  accessGranted: boolean;
}

export enum QuoteStatus {
  None = 0,
  Pending = 1,
  Settled = 2,
  Cancelled = 3,
  Expired = 4
}

export function getContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS, QuoteABI, signerOrProvider);
}

export async function createQuote(
  signer: ethers.Signer,
  quoteId: string,
  payer: string,
  amountCt: string,
  expiresAt: number
): Promise<ethers.ContractTransactionResponse> {
  const contract = getContract(signer);
  return await contract.createQuote(quoteId, payer, amountCt, expiresAt);
}

export async function grantAccess(
  signer: ethers.Signer,
  quoteId: string,
  payer: string
): Promise<ethers.ContractTransactionResponse> {
  const contract = getContract(signer);
  return await contract.grantAccess(quoteId, payer);
}

export async function settleQuote(
  signer: ethers.Signer,
  quoteId: string,
  skipPreview: boolean
): Promise<ethers.ContractTransactionResponse> {
  const contract = getContract(signer);
  return await contract.settleQuote(quoteId, skipPreview);
}

export async function getQuote(
  provider: ethers.Provider,
  quoteId: string
): Promise<Quote> {
  const contract = getContract(provider);
  const data = await contract.getQuote(quoteId);
  
  return {
    merchant: data[0],
    payer: data[1],
    expiresAt: data[2],
    status: Number(data[3]),
    accessGranted: data[4]
  };
}

export async function getEncryptedAmount(
  provider: ethers.Provider,
  quoteId: string
): Promise<string> {
  const contract = getContract(provider);
  return await contract.getEncryptedAmount(quoteId);
}

export function getStatusLabel(status: number): string {
  const labels = ["None", "Pending", "Settled", "Cancelled", "Expired"];
  return labels[status] || "Unknown";
}
