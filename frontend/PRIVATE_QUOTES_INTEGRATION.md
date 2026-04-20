# Private Quotes Integration Guide

## Files Created

### 1. `src/lib/privateQuoteTypes.ts`
Type definitions untuk Private Quotes:
- `QuoteStatus` enum (None, Pending, Settled, Cancelled, Expired)
- `QuoteView` type
- `QUOTE_STATUS_LABEL` mapping

### 2. `src/lib/privateQuote.ts`
Library functions untuk interaksi dengan smart contract:
- `ensureCorrectNetwork()` - Switch ke Anvil local network
- `createPrivateQuote()` - Create quote dengan encrypted amount
- `getPrivateQuote()` - Fetch quote details
- `settlePrivateQuote()` - Settle payment
- `grantPrivateQuoteAccess()` - Grant access ke payer
- `encryptAmountBootstrap()` - Bootstrap encryption (hash-based)
- Helper functions untuk error handling dan formatting

### 3. `src/pages/PrivateQuotesPage.tsx`
UI page untuk merchant create private quotes:
- Form input amount dan payer address
- Debug toggles (short expiry, fixed quote ID)
- Success state dengan payment link
- Error handling dengan readable messages
- Copy link functionality

### 4. Router Integration (`src/App.tsx`)
- Added route: `/private-quotes` → `PrivateQuotesPage`
- Added navigation link di navbar

## Configuration

### Contract Address
Default: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

Update di `src/lib/privateQuote.ts` jika berbeda:
```typescript
const CONTRACT_ADDRESS = "0xYourContractAddress";
```

### Network
Default: Anvil Local (Chain ID: `0x7a69`)

## Usage

### Merchant Flow
1. Navigate to `/private-quotes`
2. Enter amount dan payer address
3. (Optional) Toggle debug flags untuk testing
4. Click "Create Quote"
5. Copy payment link dan share ke payer

### Debug Features
- **Short Expiry**: Quote expires dalam 10 detik (untuk testing expired state)
- **Fixed Quote ID**: Gunakan fixed ID untuk testing duplicate prevention

## Bootstrap Mode Notes

Current implementation menggunakan **hash-based mock encryption**:
```typescript
encryptAmountBootstrap(amount) {
  return ethers.keccak256(ethers.toUtf8Bytes(`enc_amount_${amount}`));
}
```

### Limitations
- Amount tidak truly encrypted (hanya hash)
- Preview tidak available (blind payment mode)
- Untuk testing dan development only

### Next Phase: Native FHE
Akan upgrade ke native FHE encryption menggunakan Fhenix:
- True encrypted amounts on-chain
- Selective disclosure untuk compliance
- Preview dengan FHE decryption

## Gas Configuration

Gas fees sudah di-override untuk Anvil local:
```typescript
{
  maxFeePerGas: (feeData.maxFeePerGas ?? 30_000_000n) * 2n,
  maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000n) * 2n,
}
```

## Error Handling

Readable error messages untuk common issues:
- Duplicate quote ID
- Invalid payer address
- Transaction reverted
- User rejected transaction
- Wallet not found

## Testing

### Local Testing Checklist
- [ ] Create quote dengan valid inputs
- [ ] Test duplicate quote ID (dengan fixed ID toggle)
- [ ] Test expired quote (dengan short expiry toggle)
- [ ] Test invalid payer address
- [ ] Test wallet rejection
- [ ] Copy payment link
- [ ] Navigate to payment page

### Contract Interaction
Semua contract calls menggunakan ethers v6:
- `BrowserProvider` untuk wallet connection
- `JsonRpcSigner` untuk signing transactions
- `Contract` instance dengan ABI

## Styling

Page menggunakan existing HexaPay design system:
- Tailwind classes untuk consistency
- Dark theme dengan cyan/slate colors
- Responsive grid layout
- Status indicators (error, success, warning)

## Next Steps

1. **Test Integration**: Run local Anvil dan test full flow
2. **Add Payer View**: Create page untuk payer payment flow
3. **FHE Upgrade**: Migrate dari bootstrap ke native FHE
4. **Add Quote List**: Show merchant's created quotes
5. **Add Analytics**: Track quote creation dan settlement

## Troubleshooting

### "Wallet not found"
- Install MetaMask atau wallet lain
- Unlock wallet

### "Transaction reverted"
- Check duplicate quote ID
- Verify payer address valid
- Ensure contract deployed di Anvil

### Network issues
- Ensure Anvil running di `http://127.0.0.1:8545`
- Check wallet connected ke correct network
- Try manual network switch di wallet

## Support

Untuk issues atau questions:
1. Check contract deployment status
2. Verify ABI matches deployed contract
3. Check browser console untuk detailed errors
4. Review transaction di Anvil logs
