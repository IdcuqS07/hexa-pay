# HexaPay Frontend — Bootstrap Version

## Overview

React frontend for Private Merchant Quote system. Currently in **bootstrap mode** with simplified encryption, ready for CoFHE SDK upgrade.

## Features

### Merchant Flow
1. Input payment amount
2. Specify payer address
3. Create encrypted quote on-chain
4. Share payment link with payer

### Payer Flow
1. Receive payment link (NFC/QR/URL)
2. View quote details
3. Approve payment (blind mode in bootstrap)
4. Settlement on-chain

## Quick Start

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Configure Contract Address
```bash
cp .env.example .env
# Edit .env and set REACT_APP_CONTRACT_ADDRESS
```

### 3. Run Development Server
```bash
npm run dev
```

Open http://localhost:3000

### 4. Build for Production
```bash
npm run build
npm run preview
```

## Project Structure

```
frontend/
├── src/
│   ├── lib/
│   │   ├── contract.ts       # Contract interaction
│   │   └── crypto.ts         # Encryption (bootstrap)
│   ├── pages/
│   │   ├── MerchantCreateQuote.tsx
│   │   └── PayerPayQuote.tsx
│   ├── App.tsx               # Main app with routing
│   └── main.tsx              # Entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Current State: Bootstrap Mode

### Encryption (lib/crypto.ts)
```typescript
// Current: Simple hash-based mock
export function encryptAmount(amount: number): string {
  return keccak256(toUtf8Bytes(`enc_amount${amount}`));
}
```

### Contract Interface (lib/contract.ts)
```typescript
// Uses bytes32 for encrypted amounts
function createQuote(
  bytes32 id,
  address payer,
  bytes32 amountCt,  // ← bytes32 handle
  uint64 expiresAt
)
```

### Payment Flow
- ✅ Merchant creates quote with encrypted amount
- ✅ Payer receives payment link
- ✅ Payer settles with `skipPreview=true` (blind payment)
- ❌ Preview not available (no decryption yet)

## Migration to CoFHE SDK

### Phase 1 → Phase 2: Add CoFHE SDK

**1. Install CoFHE SDK**
```bash
npm install @cofhe/sdk
```

**2. Update lib/crypto.ts**
```typescript
import { CofheClient } from "@cofhe/sdk";

let cofheClient: CofheClient | null = null;

export async function initCofhe(provider: ethers.Provider) {
  cofheClient = new CofheClient({ provider });
  await cofheClient.init();
}

export async function encryptAmount(amount: number): Promise<string> {
  if (!cofheClient) throw new Error("CoFHE not initialized");
  return await cofheClient.encryptUint64(amount);
}

export async function decryptAmount(
  contractAddress: string,
  encryptedHandle: string
): Promise<number> {
  if (!cofheClient) throw new Error("CoFHE not initialized");
  
  const permit = await cofheClient.generatePermit(contractAddress);
  const decrypted = await cofheClient.unseal(contractAddress, encryptedHandle);
  
  return Number(decrypted);
}
```

**3. Update MerchantCreateQuote.tsx**
```typescript
// Add initialization
useEffect(() => {
  async function init() {
    const provider = new ethers.BrowserProvider(window.ethereum);
    await initCofhe(provider);
  }
  init();
}, []);

// Encryption now async
const amountCt = await encryptAmount(Number(amount));
```

**4. Update PayerPayQuote.tsx**
```typescript
// Add preview functionality
const [previewAmount, setPreviewAmount] = useState<number | null>(null);

async function handlePreview() {
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const encryptedHandle = await getEncryptedAmount(provider, quoteId);
    const amount = await decryptAmount(CONTRACT_ADDRESS, encryptedHandle);
    setPreviewAmount(amount);
  } catch (err) {
    console.error("Preview failed:", err);
  }
}

// Change skipPreview to false
const tx = await settleQuote(signer, quoteId, false);
```

**Effort:** 2-3 hours

---

### Phase 2 → Phase 3: Native FHE Types

**Contract changes required:**
- `bytes32 amountCt` → `euint64 amountCt`
- Add `FHE.allow()` calls

**Frontend changes:**
- Update ABI in `lib/contract.ts`
- Encryption stays same (CoFHE SDK handles it)

**Effort:** 1-2 hours

---

## Environment Variables

```bash
# .env
REACT_APP_CONTRACT_ADDRESS=0xYourDeployedAddress
REACT_APP_NETWORK_NAME=localhost
REACT_APP_CHAIN_ID=31337
```

## Payment Link Format

```
https://yourapp.com/pay/<quoteId>
```

Example:
```
https://hexapay.app/pay/0x1234567890abcdef...
```

## NFC/QR Integration

### Generate QR Code
```bash
npm install qrcode
```

```typescript
import QRCode from 'qrcode';

async function generateQR(quoteId: string) {
  const url = `${window.location.origin}/pay/${quoteId}`;
  const qrDataUrl = await QRCode.toDataURL(url);
  return qrDataUrl;
}
```

### NFC (Web NFC API)
```typescript
async function writeNFC(quoteId: string) {
  if ('NDEFReader' in window) {
    const ndef = new NDEFReader();
    await ndef.write({
      records: [{
        recordType: "url",
        data: `${window.location.origin}/pay/${quoteId}`
      }]
    });
  }
}
```

## Testing

### Local Testing with Anvil
```bash
# Terminal 1: Start Anvil
anvil

# Terminal 2: Deploy contract
cd ..
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast

# Terminal 3: Run frontend
cd frontend
# Update .env with deployed address
npm run dev
```

### MetaMask Setup
1. Add Localhost network (Chain ID: 31337)
2. Import Anvil test account
3. Connect to app

## Deployment

### Build
```bash
npm run build
```

### Deploy to Vercel
```bash
npm install -g vercel
vercel
```

### Deploy to Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod
```

## Troubleshooting

### MetaMask Not Detected
```typescript
if (!window.ethereum) {
  alert("Please install MetaMask");
  return;
}
```

### Wrong Network
```typescript
const chainId = await provider.send("eth_chainId", []);
if (chainId !== "0x7a69") { // 31337 in hex
  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x7a69" }]
  });
}
```

### Transaction Failed
- Check contract address is correct
- Verify account has funds
- Check console for error details

## Next Steps

1. ✅ Run `npm install && npm run dev`
2. Deploy contract and update `.env`
3. Test merchant flow
4. Test payer flow
5. Upgrade to CoFHE SDK (Phase 2)
6. Add preview functionality
7. Deploy to production

## Resources

- [Ethers.js Docs](https://docs.ethers.org/v6/)
- [React Router Docs](https://reactrouter.com/)
- [Vite Docs](https://vitejs.dev/)
- [CoFHE SDK Docs](https://docs.fhenix.zone/)

## License

MIT
