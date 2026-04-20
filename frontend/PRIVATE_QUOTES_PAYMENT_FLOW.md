# Private Quotes - Payment Flow Implementation

## 🎯 New Files Added

### 1. `src/components/PrivateQuotes/QuoteStatusBadge.tsx`
Reusable component untuk menampilkan status quote dengan color coding:
- None (0): Slate gray
- Pending (1): Amber yellow
- Settled (2): Emerald green
- Cancelled (3): Rose red
- Expired (4): Red

### 2. `src/pages/PayPrivateQuotePage.tsx`
Complete payer payment page dengan features:
- Load quote details by ID
- Display quote information (merchant, payer, status, expiry)
- Check if quote can be paid (pending + not expired)
- Process payment (settleQuote)
- Show success/error states
- Bootstrap mode warning
- Privacy guarantee notice

### 3. Router Update (`src/App.tsx`)
- `/pay/:id` → `PayPrivateQuotePage` (new implementation)
- `/pay-old/:id` → `PayWrapper` (old implementation, backup)

## 🔄 Complete Flow

### Merchant Side
1. Navigate to `/private-quotes`
2. Enter amount dan payer address
3. Create quote
4. Copy payment link: `/pay/0x123...`
5. Share link dengan payer

### Payer Side
1. Receive payment link dari merchant
2. Open link: `/pay/0x123...`
3. View quote details:
   - Merchant address
   - Payer address (should match wallet)
   - Status badge
   - Expiry time
   - Access granted status
4. Click "Pay Now" button
5. Confirm transaction di wallet
6. See success message dengan tx hash

## 🎨 UI Components

### QuoteStatusBadge
```tsx
<QuoteStatusBadge status={quote.status} />
```

Props:
- `status`: QuoteStatus enum atau number (0-4)

Styling:
- Rounded pill badge
- Color-coded by status
- Border untuk emphasis

### PayPrivateQuotePage Layout

```
┌─────────────────────────────────────┐
│ Header                              │
│ - Title: Pay Private Quote          │
│ - Description                        │
├─────────────────────────────────────┤
│ Loading State (if loading)          │
├─────────────────────────────────────┤
│ Error State (if error)              │
├─────────────────────────────────────┤
│ Success Banner (if paid)            │
│ - Transaction hash                   │
├─────────────────────────────────────┤
│ Quote Details Card                  │
│ - Merchant address                   │
│ - Payer address                      │
│ - Status badge                       │
│ - Expiry time                        │
│ - Access granted                     │
├─────────────────────────────────────┤
│ Cannot Pay Warning (if not payable) │
├─────────────────────────────────────┤
│ Bootstrap Mode Notice               │
├─────────────────────────────────────┤
│ Pay Now Button (if payable)         │
├─────────────────────────────────────┤
│ Privacy Guarantee Notice            │
└─────────────────────────────────────┘
```

## 🔒 Payment Validation

### Can Pay Conditions
```typescript
const canPay = useMemo(() => {
  if (!quote) return false;
  if (quote.status !== QuoteStatus.Pending) return false;
  if (expired) return false;
  return true;
}, [quote, expired]);
```

Quote dapat dibayar jika:
- Quote exists
- Status = Pending (1)
- Not expired (current time < expiresAt)

### Cannot Pay Reasons
- Status bukan Pending (Settled, Cancelled, Expired)
- Quote sudah expired
- Quote tidak ditemukan

## 📊 State Management

### PayPrivateQuotePage States
```typescript
const [quote, setQuote] = useState<QuoteView | null>(null);
const [loading, setLoading] = useState(true);
const [paying, setPaying] = useState(false);
const [error, setError] = useState("");
const [success, setSuccess] = useState("");
const [txHash, setTxHash] = useState("");
```

### State Flow
1. Initial: `loading = true`
2. Load quote: `getPrivateQuote(id)`
3. Success: `quote = data, loading = false`
4. Error: `error = message, loading = false`
5. Pay click: `paying = true`
6. Payment success: `success = message, txHash = hash, paying = false`
7. Payment error: `error = message, paying = false`

## 🎯 Bootstrap Mode Features

### Current Implementation
- Hash-based mock encryption
- Blind payment (no preview)
- Amount tidak visible di UI
- Trust-based flow

### Bootstrap Notices
1. **Payment Page**:
   - "Amount is currently protected with hash-based mock encryption"
   - "Payment is processed as blind payment for local validation"

2. **Privacy Guarantee**:
   - "The payment amount is not exposed in public UI flow"
   - "Native FHE preview and permit-based reveal can be added in the next phase"

## 🔄 Integration with Existing Code

### Reuses from privateQuote.ts
```typescript
import {
  getPrivateQuote,
  settlePrivateQuote,
  formatQuoteExpiry,
  getReadableError,
  isExpired,
} from "../lib/privateQuote";
```

### Reuses from privateQuoteTypes.ts
```typescript
import { QuoteStatus, type QuoteView } from "../lib/privateQuoteTypes";
```

### New Component
```typescript
import QuoteStatusBadge from "../components/PrivateQuotes/QuoteStatusBadge";
```

## 🧪 Testing Scenarios

### Happy Path
1. Merchant creates quote
2. Payer opens payment link
3. Quote shows as Pending
4. Payer clicks Pay Now
5. Transaction succeeds
6. Status updates to Settled

### Error Cases

#### Expired Quote
1. Create quote dengan short expiry
2. Wait 10+ seconds
3. Try to pay
4. See "Quote has expired" error

#### Already Settled
1. Pay quote successfully
2. Try to pay again
3. See "Quote is not in pending status" error

#### Invalid Quote ID
1. Navigate to `/pay/0xinvalid`
2. See "Quote not found" error

#### Wallet Rejection
1. Click Pay Now
2. Reject transaction di wallet
3. See "Transaction was rejected in wallet" error

## 🎨 Styling Consistency

### Color Scheme
- Background: `slate-900/70`, `slate-950/40`
- Borders: `slate-800`, `slate-700`
- Text: `white`, `slate-300`, `slate-400`
- Accent: `cyan-400`, `cyan-500`
- Success: `emerald-500`, `emerald-300`
- Error: `red-500`, `red-300`
- Warning: `amber-500`, `amber-300`
- Info: `cyan-500`, `cyan-300`

### Component Patterns
- Rounded corners: `rounded-xl`, `rounded-2xl`
- Padding: `p-4`, `p-5`, `p-6`
- Gaps: `gap-3`, `gap-4`
- Responsive: `md:grid-cols-2`, `md:flex-row`

## 🚀 Next Steps

### Phase 1: Testing
- [ ] Test complete merchant → payer flow
- [ ] Test all error scenarios
- [ ] Test expired quotes
- [ ] Test duplicate payments
- [ ] Verify gas usage

### Phase 2: Enhancements
- [ ] Add wallet address validation
- [ ] Show "Connect Wallet" if not connected
- [ ] Add quote refresh button
- [ ] Add countdown timer untuk expiry
- [ ] Add transaction explorer link

### Phase 3: FHE Migration
- [ ] Replace bootstrap encryption
- [ ] Add FHE preview functionality
- [ ] Add permit-based reveal
- [ ] Add selective disclosure

### Phase 4: UX Improvements
- [ ] Add loading skeletons
- [ ] Add animations
- [ ] Add toast notifications
- [ ] Add payment confirmation modal
- [ ] Add receipt download

## 📝 Code Quality

### TypeScript
- Full type safety dengan QuoteView
- Proper error handling
- Null checks untuk quote data

### React Best Practices
- useMemo untuk computed values
- useEffect untuk data loading
- Proper state management
- Clean component structure

### Accessibility
- Semantic HTML
- Proper button states (disabled)
- Error messages visible
- Loading states announced

## 🔧 Configuration

### Route Configuration
```typescript
// App.tsx
<Route path="/pay/:id" element={<PayPrivateQuotePage />} />
```

### Component Location
```
frontend/src/
├── components/
│   └── PrivateQuotes/
│       └── QuoteStatusBadge.tsx
└── pages/
    └── PayPrivateQuotePage.tsx
```

## 📚 Related Documentation

- Main Integration: `PRIVATE_QUOTES_INTEGRATION.md`
- Quick Start: `PRIVATE_QUOTES_QUICKSTART.md`
- Summary: `../docs/private-quotes/PRIVATE_QUOTES_SUMMARY.md`
- Payment Flow: `PRIVATE_QUOTES_PAYMENT_FLOW.md` (this file)

## 🎉 Ready to Test

Complete payment flow sudah terintegrasi:

```bash
# Start Anvil
anvil

# Deploy contract
npm run deploy:private-quote

# Start frontend
cd frontend && npm run dev

# Test flow:
# 1. Go to /private-quotes
# 2. Create quote
# 3. Copy payment link
# 4. Open link di new tab/window
# 5. Pay quote
```

Flow lengkap dari merchant create sampai payer payment sudah siap!
