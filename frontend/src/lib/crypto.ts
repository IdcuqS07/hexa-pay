import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Bootstrap encryption (fake)
 * 
 * This uses simple keccak256 hashing to simulate encryption.
 * 
 * TODO: Replace with CoFHE SDK:
 * import { CofheClient } from "@cofhe/sdk";
 * const client = new CofheClient({ provider });
 * const encrypted = await client.encryptUint64(amount);
 */

export function encryptAmount(amount: number): string {
  // Simple hash-based mock encryption
  // Matches test pattern: keccak256(abi.encodePacked("enc_amount", value))
  return keccak256(toUtf8Bytes(`enc_amount${amount}`));
}

/**
 * Generate unique quote ID
 */
export function generateQuoteId(): string {
  const timestamp = Date.now();
  const random = Math.random();
  return keccak256(toUtf8Bytes(`quote_${timestamp}_${random}`));
}

/**
 * Decrypt amount (bootstrap version - not implemented)
 * 
 * In bootstrap phase, we don't decrypt.
 * 
 * TODO: Replace with CoFHE SDK:
 * const permit = await client.generatePermit(contractAddress);
 * const decrypted = await client.unseal(contractAddress, encryptedHandle);
 */
export async function decryptAmount(_encryptedHandle: string): Promise<number> {
  // Not implemented in bootstrap phase
  throw new Error("Decryption not available in bootstrap mode. Use skipPreview=true.");
}

/**
 * Migration notes:
 * 
 * Phase 1 (Current - Bootstrap):
 * - encryptAmount() → keccak256 hash
 * - decryptAmount() → not implemented
 * 
 * Phase 2 (CoFHE SDK):
 * - encryptAmount() → cofhe.encryptUint64()
 * - decryptAmount() → cofhe.unseal() with permit
 * 
 * Phase 3 (Native FHE):
 * - Contract uses euint64 instead of bytes32
 * - Add FHE.allow() calls in contract
 * - Frontend encryption stays same as Phase 2
 */
