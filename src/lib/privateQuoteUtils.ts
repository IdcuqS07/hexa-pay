import { ethers } from "ethers";
import { QuoteStatus, QUOTE_STATUS_LABEL } from "./privateQuoteTypes";
import { DEBUG_FIXED_QUOTE_ID, DEBUG_SHORT_EXPIRY } from "./privateQuoteDebug";

export function generateQuoteId(): string {
  if (DEBUG_FIXED_QUOTE_ID) {
    return "0x1111111111111111111111111111111111111111111111111111111111111111";
  }
  return ethers.keccak256(ethers.toUtf8Bytes(Date.now().toString()));
}

export function encryptAmount(amount: number): string {
  return ethers.keccak256(ethers.toUtf8Bytes(amount.toString()));
}

export function calculateExpiry(): number {
  const now = Math.floor(Date.now() / 1000);
  return DEBUG_SHORT_EXPIRY ? now + 10 : now + 3600;
}

export function isQuoteExpired(expiresAt: number): boolean {
  return expiresAt < Math.floor(Date.now() / 1000);
}

export function canPayQuote(status: QuoteStatus, expiresAt: number): boolean {
  return status === QuoteStatus.Pending && !isQuoteExpired(expiresAt);
}

export function getStatusLabel(status: number): string {
  return QUOTE_STATUS_LABEL[status] || "Unknown";
}

export function formatAddress(address: string): string {
  if (address === ethers.ZeroAddress) return "Anyone";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}
