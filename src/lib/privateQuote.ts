import { ethers } from "ethers";
import { QuoteView, QuoteStatus } from "./privateQuoteTypes";

const CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const CONTRACT_ABI = [
  "function createQuote(bytes32 quoteId, address payer, bytes32 amountCt, uint256 expiresAt) external",
  "function grantAccess(bytes32 quoteId, address payer) external",
  "function settleQuote(bytes32 quoteId, bool skipPreview) external",
  "function getQuote(bytes32 quoteId) external view returns (address merchant, address payer, uint256 expiresAt, uint8 status, bool accessGranted)",
  "function getEncryptedAmount(bytes32 quoteId) external view returns (bytes32)"
];

export function getPrivateQuoteContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signerOrProvider);
}

export async function ensureCorrectNetwork(provider: ethers.Provider): Promise<void> {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  
  if (chainId !== 31337) {
    throw new Error(`Wrong network. Expected Anvil (31337), got ${chainId}`);
  }
}

export async function createPrivateQuote(
  signer: ethers.Signer,
  quoteId: string,
  payer: string,
  amountCt: string,
  expiresAt: number
): Promise<ethers.ContractTransactionResponse> {
  const contract = getPrivateQuoteContract(signer);
  return await contract.createQuote(quoteId, payer, amountCt, expiresAt);
}

export async function grantPrivateQuoteAccess(
  signer: ethers.Signer,
  quoteId: string,
  payer: string
): Promise<ethers.ContractTransactionResponse> {
  const contract = getPrivateQuoteContract(signer);
  return await contract.grantAccess(quoteId, payer);
}

export async function settlePrivateQuote(
  signer: ethers.Signer,
  quoteId: string,
  skipPreview: boolean
): Promise<ethers.ContractTransactionResponse> {
  const contract = getPrivateQuoteContract(signer);
  return await contract.settleQuote(quoteId, skipPreview);
}

export async function getPrivateQuote(
  provider: ethers.Provider,
  quoteId: string
): Promise<QuoteView> {
  const contract = getPrivateQuoteContract(provider);
  const data = await contract.getQuote(quoteId);
  
  return {
    merchant: data[0],
    payer: data[1],
    expiresAt: Number(data[2]),
    status: Number(data[3]) as QuoteStatus,
    accessGranted: data[4]
  };
}

export async function getEncryptedAmount(
  provider: ethers.Provider,
  quoteId: string
): Promise<string> {
  const contract = getPrivateQuoteContract(provider);
  return await contract.getEncryptedAmount(quoteId);
}
