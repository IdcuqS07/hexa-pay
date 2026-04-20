# E2E Testing Guide — Bootstrap Phase

## ✅ Deployment Complete

**Contracts Deployed on Anvil (localhost:8545):**
```
MockCreditAdapter:    0x5FbDB2315678afecb367f032d93F642f64180aa3
PrivateMerchantQuote: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
```

**Status:**
- ✅ 13/13 tests passing
- ✅ Contracts deployed
- ✅ Frontend configured
- ✅ ABI exported

---

## 🚀 Start Frontend

```bash
cd frontend
npm run dev
```

**Expected:**
```
VITE v5.2.0  ready in 500 ms

➜  Local:   http://localhost:3000/
```

Open http://localhost:3000

---

## 🦊 MetaMask Setup

### 1. Add Localhost Network

**Network Details:**
- Network Name: `Localhost 8545`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency Symbol: `ETH`

### 2. Import Anvil Accounts

**Account #1 (Merchant):**
```
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Balance: 10000 ETH
```

**Account #2 (Payer):**
```
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
Address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Balance: 10000 ETH
```

---

## 🧪 E2E Test Flow

### Test 1: Happy Path (Merchant → Payer)

**Step 1: Merchant Creates Quote**
1. Open http://localhost:3000/create
2. Connect MetaMask (Account #1)
3. Enter amount: `1000`
4. Enter payer address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
5. Click "Create Quote"
6. Approve MetaMask transaction
7. Wait for confirmation
8. Copy payment link

**Expected:**
- ✅ Transaction confirms
- ✅ Quote ID displayed
- ✅ Payment link generated
- ✅ Link format: `http://localhost:3000/pay/0x...`

**Step 2: Payer Settles Quote**
1. Switch MetaMask to Account #2
2. Open payment link from Step 1
3. Review quote details:
   - Merchant: `0xf39F...`
   - Status: `Pending`
   - Expiry: ~1 hour
4. Click "Pay Now (Blind Payment)"
5. Approve MetaMask transaction
6. Wait for confirmation

**Expected:**
- ✅ Transaction confirms
- ✅ Success message displayed
- ✅ Status changes to `Settled`

---

### Test 2: Wrong Payer (Should Fail)

**Steps:**
1. Create quote as Account #1
2. Set payer to Account #2
3. Try to pay with Account #3 (different account)

**Expected:**
- ❌ Transaction reverts
- ❌ Error: "NotAuthorized"

---

### Test 3: Expired Quote (Should Fail)

**Steps:**
1. Create quote with short expiry
2. Wait for expiry
3. Try to pay

**Expected:**
- ❌ Transaction reverts
- ❌ Error: "Expired"

---

### Test 4: Duplicate Quote ID (Should Fail)

**Steps:**
1. Create quote with ID `0x123...`
2. Try to create another quote with same ID

**Expected:**
- ❌ Transaction reverts
- ❌ Error: "AlreadyExists"

---

## 📋 Validation Checklist

### Frontend
- [ ] App loads at localhost:3000
- [ ] Home page displays
- [ ] Create quote page accessible
- [ ] MetaMask connects
- [ ] Network is Localhost (31337)

### Merchant Flow
- [ ] Can input amount
- [ ] Can input payer address
- [ ] Create quote button works
- [ ] MetaMask prompts for approval
- [ ] Transaction confirms
- [ ] Quote ID displayed
- [ ] Payment link generated
- [ ] Can copy link

### Payer Flow
- [ ] Payment link opens
- [ ] Quote details display
- [ ] Merchant address shown
- [ ] Status shows "Pending"
- [ ] Expiry time shown
- [ ] Pay button works
- [ ] MetaMask prompts for approval
- [ ] Transaction confirms
- [ ] Success message shown
- [ ] Status updates to "Settled"

### Error Handling
- [ ] Wrong payer rejected
- [ ] Expired quote rejected
- [ ] Duplicate ID rejected
- [ ] Insufficient credit rejected (if tested)

---

## 🔍 Debugging

### Check Contract State

```bash
export PATH="$HOME/.foundry/bin:$PATH"

# Get quote details
cast call 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 \
  "getQuote(bytes32)(address,address,uint64,uint8,bool)" \
  <QUOTE_ID> \
  --rpc-url http://127.0.0.1:8545
```

### Check Transaction

```bash
# Get transaction receipt
cast receipt <TX_HASH> --rpc-url http://127.0.0.1:8545
```

### Check Logs

**Browser Console:**
- Open DevTools (F12)
- Check Console tab for errors
- Check Network tab for failed requests

**Anvil Logs:**
```bash
tail -f /tmp/anvil.log
```

---

## 🚨 Common Issues

### MetaMask Not Connecting
- Check network is Localhost (31337)
- Try resetting MetaMask account
- Clear browser cache

### Transaction Fails
- Check account has ETH
- Check correct network selected
- Check contract address correct
- Check Anvil is running

### Payment Link Doesn't Work
- Check quote ID is correct
- Check quote not expired
- Check quote status is Pending

---

## 📊 Expected Gas Usage

| Operation | Gas Used |
|-----------|----------|
| Create Quote | ~90k |
| Grant Access | ~50k |
| Settle Quote | ~100k |
| **Total Flow** | **~240k** |

---

## ✅ Success Criteria

**E2E Test Passes When:**
- ✅ Merchant creates quote
- ✅ Payment link works
- ✅ Payer can view quote
- ✅ Payer can settle quote
- ✅ Status updates correctly
- ✅ Wrong payer rejected
- ✅ Expired quote rejected

---

## 🎯 After E2E Success

**Next Steps:**
1. Document any issues found
2. Test edge cases
3. Prepare for FHE migration:
   - Replace hash encryption with CoFHE SDK
   - Migrate bytes32 → euint64
   - Add preview functionality
   - Add permit-based decryption

---

## 📞 Report Results

**Share:**
1. ✅ Which tests passed
2. ❌ Which tests failed
3. Screenshots of success/errors
4. Browser console errors
5. Transaction hashes

---

**Ready to test!** 🚀

Start frontend: `cd frontend && npm run dev`
