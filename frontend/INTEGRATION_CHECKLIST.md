# Integration Checklist - Private Quotes

## 🎯 Pre-Integration Setup

- [ ] Anvil running di `http://127.0.0.1:8545`
- [ ] Contract deployed (PrivateMerchantQuote)
- [ ] Contract address updated di `src/lib/privateQuote.ts`
- [ ] Frontend dependencies installed (`npm install`)
- [ ] Frontend running (`npm run dev`)

## 📂 Files Created

### Layout Components
- [x] `src/components/Layout/AppLayout.tsx`
- [x] `src/components/Layout/PublicLayout.tsx`
- [x] `src/components/Layout/Sidebar.tsx`

### Private Quotes Components
- [x] `src/components/PrivateQuotes/QuoteStatusBadge.tsx`

### Pages
- [x] `src/pages/PrivateQuotesPage.tsx`
- [x] `src/pages/PayPrivateQuotePage.tsx`

### Library
- [x] `src/lib/privateQuote.ts`
- [x] `src/lib/privateQuoteTypes.ts`
- [x] `src/lib/abi/PrivateMerchantQuote.json`

### Router
- [x] `src/App.tsx` updated dengan layouts

## 🧪 Navigation Testing

### Sidebar Menu
- [ ] Open app → Sidebar visible di kiri
- [ ] Logo "🔐 HexaPay" visible di top sidebar
- [ ] Menu items visible:
  - [ ] 🏠 Home
  - [ ] ➕ Create Quote
  - [ ] 🔐 Private Quotes
- [ ] Footer visible di bottom sidebar

### Menu Navigation
- [ ] Click "Home" → Navigate to `/`
- [ ] Click "Create Quote" → Navigate to `/create`
- [ ] Click "Private Quotes" → Navigate to `/private-quotes`

### Active State
- [ ] Current page highlighted dengan cyan background
- [ ] Other menu items gray
- [ ] Hover effect works (gray background on hover)

## 🎨 Layout Testing

### Dashboard Pages (dengan Sidebar)
- [ ] Home page (`/`) shows sidebar
- [ ] Create Quote page (`/create`) shows sidebar
- [ ] Private Quotes page (`/private-quotes`) shows sidebar
- [ ] Sidebar sticky di kiri
- [ ] Content area scrollable

### Public Pages (tanpa Sidebar)
- [ ] Payment page (`/pay/:id`) no sidebar
- [ ] Navbar visible di top
- [ ] Footer visible di bottom
- [ ] Clean layout untuk payer

## 🔄 Merchant Flow Testing

### Create Quote Flow
- [ ] Navigate to `/private-quotes` via sidebar
- [ ] Page renders correctly
- [ ] Form visible dengan fields:
  - [ ] Amount input
  - [ ] Payer address input
  - [ ] Debug toggles (short expiry, fixed ID)
- [ ] Enter amount: `100`
- [ ] Enter payer address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- [ ] Click "Create Quote"
- [ ] Wallet prompts for transaction
- [ ] Confirm transaction
- [ ] Success message appears
- [ ] Quote ID displayed
- [ ] Payment link displayed
- [ ] Transaction hash displayed
- [ ] "Copy Payment Link" button works
- [ ] Link copied to clipboard

### Debug Features
- [ ] Toggle "Debug short expiry" → Quote expires in 10s
- [ ] Toggle "Debug fixed quote ID" → Uses fixed ID
- [ ] Create quote dengan fixed ID
- [ ] Try create again → Error "duplicate quote ID"

## 💳 Payer Flow Testing

### Payment Page
- [ ] Open payment link di new tab
- [ ] Page renders without sidebar
- [ ] Navbar visible di top
- [ ] Quote details visible:
  - [ ] Merchant address
  - [ ] Payer address
  - [ ] Status badge (Pending)
  - [ ] Expiry time
  - [ ] Access granted status
- [ ] Bootstrap mode notice visible
- [ ] Privacy guarantee notice visible
- [ ] "Pay Now" button visible dan enabled

### Payment Process
- [ ] Click "Pay Now"
- [ ] Wallet prompts for transaction
- [ ] Confirm transaction
- [ ] Success message appears
- [ ] Transaction hash displayed
- [ ] Status badge updates to "Settled"
- [ ] "Pay Now" button disabled
- [ ] "Cannot Pay" message shows

### Error Cases
- [ ] Open invalid quote ID → Error message
- [ ] Try pay expired quote → "Quote has expired"
- [ ] Try pay settled quote → "Quote is not in pending status"
- [ ] Reject transaction → "Transaction was rejected in wallet"

## 🎨 Styling Testing

### Theme Consistency
- [ ] Dark theme throughout app
- [ ] Slate colors (950, 900, 800)
- [ ] Cyan accent color (500, 400)
- [ ] Consistent rounded corners
- [ ] Consistent padding/spacing

### Responsive Design
- [ ] Desktop view (>1024px) works
- [ ] Tablet view (768-1024px) works
- [ ] Mobile view (<768px) works
- [ ] Sidebar responsive
- [ ] Grid layouts responsive

### Interactive States
- [ ] Hover states work
- [ ] Active states work
- [ ] Focus states work
- [ ] Disabled states work
- [ ] Loading states work

## 🔄 Old Flow Testing (Backward Compatibility)

### Old Routes Still Work
- [ ] `/create` → MerchantCreateQuote page
- [ ] Old create flow still functional
- [ ] `/pay/:id` → New PayPrivateQuotePage (updated)
- [ ] `/pay-old/:id` → Old PayWrapper (backup)

### No Breaking Changes
- [ ] Existing functionality intact
- [ ] Old pages still accessible
- [ ] No console errors
- [ ] No styling conflicts

## 🐛 Error Handling Testing

### Network Errors
- [ ] Wallet not installed → Clear error message
- [ ] Wrong network → Auto-switch prompt
- [ ] Network switch rejected → Error message
- [ ] Transaction failed → Readable error

### Validation Errors
- [ ] Empty amount → Validation error
- [ ] Invalid amount → Validation error
- [ ] Empty payer address → Validation error
- [ ] Invalid payer address → Validation error

### Contract Errors
- [ ] Duplicate quote ID → "Quote ID already exists"
- [ ] Expired quote → "Quote has expired"
- [ ] Invalid state → "Quote is not in pending status"

## 📊 Performance Testing

### Load Times
- [ ] Home page loads quickly
- [ ] Private Quotes page loads quickly
- [ ] Payment page loads quickly
- [ ] No lag when navigating

### Interactions
- [ ] Menu clicks responsive
- [ ] Form inputs responsive
- [ ] Button clicks responsive
- [ ] Wallet interactions smooth

## 🔒 Security Testing

### Access Control
- [ ] Only merchant can create quotes
- [ ] Only payer can pay quotes
- [ ] Quote details visible to authorized parties
- [ ] Invalid quote IDs handled safely

### Data Validation
- [ ] Amount validated
- [ ] Address validated
- [ ] Quote ID validated
- [ ] Expiry validated

## 📱 Cross-Browser Testing

### Desktop Browsers
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Edge

### Mobile Browsers
- [ ] Chrome Mobile
- [ ] Safari Mobile
- [ ] Firefox Mobile

## ✅ Final Verification

### Functionality
- [ ] All routes working
- [ ] All navigation working
- [ ] All forms working
- [ ] All buttons working
- [ ] All links working

### UI/UX
- [ ] Consistent styling
- [ ] Responsive design
- [ ] Smooth transitions
- [ ] Clear feedback
- [ ] Intuitive flow

### Integration
- [ ] Sidebar integrated
- [ ] Layouts working
- [ ] Theme consistent
- [ ] No breaking changes
- [ ] Old flow intact

## 🎉 Sign-Off

- [ ] All tests passed
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] Ready for production

**Tested by**: _______________  
**Date**: _______________  
**Notes**: _______________

---

## 🚀 Quick Test Commands

```bash
# Start Anvil
anvil

# Deploy contract
npm run deploy:private-quote

# Start frontend
cd frontend && npm run dev

# Open browser
open http://localhost:5173
```

## 📝 Test Accounts

### Merchant (Account 0)
```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Payer (Account 1)
```
Address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

## 🐛 Common Issues

### Sidebar not showing
- Check route wrapped dengan `<AppLayout />`
- Verify Tailwind loaded
- Check browser console for errors

### Payment link not working
- Verify contract address correct
- Check quote ID valid
- Ensure Anvil running

### Wallet not connecting
- Install MetaMask
- Unlock wallet
- Switch to Anvil network (Chain ID: 31337)

### Styling broken
- Clear browser cache
- Restart dev server
- Check Tailwind config
