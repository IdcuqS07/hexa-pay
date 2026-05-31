import { ethers } from "ethers";
import type { ContractRunner } from "ethers";
import QuoteABI from "./abi/PrivateMerchantQuote.json";

const DEFAULT_ARB_SEPOLIA_CHAIN_ID = 421614;

let contractConfigPromise: Promise<{ address: string; chainId: number }> | null = null;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

async function loadContractConfig() {
  if (!contractConfigPromise) {
    contractConfigPromise = (async () => {
      const envAddress = String(import.meta.env.VITE_PRIVATE_QUOTE_CONTRACT || "").trim();
      const envChainId = normalizePositiveInteger(
        import.meta.env.VITE_PRIVATE_QUOTE_CHAIN_ID,
        DEFAULT_ARB_SEPOLIA_CHAIN_ID,
      );

      try {
        const response = await fetch(`/deployment-private-quote.json?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (response.ok) {
          const payload = await response.json();
          const rawAddress = String(
            payload?.contracts?.PrivateMerchantQuote ||
              payload?.ui?.addresses?.privateQuote ||
              payload?.privateQuote ||
              payload?.address ||
              envAddress,
          ).trim();

          if (rawAddress) {
            return {
              address: ethers.getAddress(rawAddress),
              chainId: normalizePositiveInteger(payload?.chainId, envChainId),
            };
          }
        }
      } catch (error) {
        error;
      }

      if (envAddress) {
        return {
          address: ethers.getAddress(envAddress),
          chainId: envChainId,
        };
      }

      throw new Error(
        "Private quote deployment is not configured. Publish deployment-private-quote.json or set VITE_PRIVATE_QUOTE_CONTRACT.",
      );
    })();
  }

  return contractConfigPromise;
}

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
  Expired = 4,
}

export async function getContract(signerOrProvider: ethers.Signer | ethers.Provider | ContractRunner) {
  const config = await loadContractConfig();
  return new ethers.Contract(config.address, QuoteABI, signerOrProvider);
}

export async function createQuote(
  signer: ethers.Signer,
  quoteId: string,
  payer: string,
  amountCt: string,
  expiresAt: number,
): Promise<ethers.ContractTransactionResponse> {
  const contract = await getContract(signer);
  return await contract.createQuote(quoteId, payer, amountCt, expiresAt);
}

export async function grantAccess(
  signer: ethers.Signer,
  quoteId: string,
  payer: string,
): Promise<ethers.ContractTransactionResponse> {
  const contract = await getContract(signer);
  return await contract.grantAccess(quoteId, payer);
}

export async function settleQuote(
  signer: ethers.Signer,
  quoteId: string,
  skipPreview: boolean,
): Promise<ethers.ContractTransactionResponse> {
  const contract = await getContract(signer);
  return await contract.settleQuote(quoteId, skipPreview);
}

export async function getQuote(provider: ethers.Provider, quoteId: string): Promise<Quote> {
  const contract = await getContract(provider);
  const data = await contract.getQuote(quoteId);

  return {
    merchant: data[0],
    payer: data[1],
    expiresAt: data[2],
    status: Number(data[3]),
    accessGranted: data[4],
  };
}

export async function getEncryptedAmount(provider: ethers.Provider, quoteId: string): Promise<string> {
  const contract = await getContract(provider);
  return await contract.getEncryptedAmount(quoteId);
}

export function getStatusLabel(status: number): string {
  const labels = ["None", "Pending", "Settled", "Cancelled", "Expired"];
  return labels[status] || "Unknown";
}
