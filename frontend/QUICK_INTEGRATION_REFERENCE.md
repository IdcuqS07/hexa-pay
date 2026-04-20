# Quick Integration Reference - Private Quotes

## ✅ Current Status: FULLY INTEGRATED

App sudah terintegrasi lengkap dengan sidebar navigation dan layout system.

## 🎯 What's Already Done

```
✅ Routes added to App.tsx
✅ Sidebar menu with "Private Quotes" item
✅ Layout system (AppLayout + PublicLayout)
✅ Dark theme styling
✅ Active state highlighting
✅ Responsive design
```

## 📂 Key Files

```
frontend/src/
├── App.tsx                              ✅ Router configured
├── components/Layout/
│   ├── AppLayout.tsx                    ✅ Dashboard layout
│   ├── PublicLayout.tsx                 ✅ Public layout
│   └── Sidebar.tsx                      ✅ Navigation menu
└── pages/
    ├── PrivateQuotesPage.tsx            ✅ Merchant page
    └── PayPrivateQuotePage.tsx          ✅ Payment page
```

## 🗺️ Routes

```typescript
// Dashboard (dengan sidebar)
/                    → Home
/create              → Create Quote (old)
/private-quotes      → Private Quotes (new) ✅

// Public (tanpa sidebar)
/pay/:id             → Payment Page ✅
/pay-old/:id         → Backup (old)
```

## 🎨 Sidebar Menu

```
🏠 Home
➕ Create Quote
🔐 Private Quotes    ✅ NEW
```

## 🚀 Quick Test

```bash
# 1. Start Anvil
anvil

# 2. Deploy contract
npm run deploy:private-quote

# 3. Update contract address
# Edit: frontend/src/lib/privateQuote.ts
# Line 6: const CONTRACT_ADDRESS = "0xYourAddress";

# 4. Start frontend
cd frontend && npm run dev

# 5. Test
# - Open http://localhost:5173
# - Click "Private Quotes" in sidebar
# - Create quote
# - Copy payment link
# - Open link (new tab)
# - Pay quote
```

## 🔧 If You Need to Modify

### Add Menu Item to Sidebar

```typescript
// frontend/src/components/Layout/Sidebar.tsx
const menuItems = [
  { label: "Home", href: "/", icon: "🏠" },
  { label: "Create Quote", href: "/create", icon: "➕" },
  { label: "Private Quotes", href: "/private-quotes", icon: "🔐" },
  { label: "New Feature", href: "/new", icon: "🆕" }, // Add here
];
```

### Add Route

```typescript
// frontend/src/App.tsx
<Route element={<AppLayout />}>
  <Route path="/" element={<Home />} />
  <Route path="/create" element={<MerchantCreateQuote />} />
  <Route path="/private-quotes" element={<PrivateQuotesPage />} />
  <Route path="/new" element={<NewPage />} /> {/* Add here */}
</Route>
```

### Change Theme Color

```typescript
// Update Tailwind classes:
// cyan-500 → blue-500
// slate-950 → gray-950
```

## 📋 Integration Patterns (If Starting Fresh)

### Pattern 1: Minimal (No Sidebar)

```typescript
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/private-quotes" element={<PrivateQuotesPage />} />
  <Route path="/pay/:id" element={<PayPrivateQuotePage />} />
</Routes>
```

### Pattern 2: With Simple Navbar

```typescript
<BrowserRouter>
  <Navbar /> {/* Simple top nav */}
  <Routes>
    <Route path="/private-quotes" element={<PrivateQuotesPage />} />
    <Route path="/pay/:id" element={<PayPrivateQuotePage />} />
  </Routes>
</BrowserRouter>
```

### Pattern 3: With AppShell (Current)

```typescript
<Routes>
  <Route element={<AppLayout />}> {/* With sidebar */}
    <Route path="/private-quotes" element={<PrivateQuotesPage />} />
  </Route>
  <Route element={<PublicLayout />}> {/* Without sidebar */}
    <Route path="/pay/:id" element={<PayPrivateQuotePage />} />
  </Route>
</Routes>
```

## 🐛 Troubleshooting

### Sidebar not showing
```bash
# Check route wrapped with AppLayout
<Route element={<AppLayout />}>
  <Route path="/private-quotes" element={<PrivateQuotesPage />} />
</Route>
```

### Menu item not clickable
```bash
# Verify Link component used
import { Link } from "react-router-dom";
<Link to="/private-quotes">Private Quotes</Link>
```

### Styling broken
```bash
# Clear cache and restart
rm -rf node_modules/.vite
npm run dev
```

### Payment link not working
```bash
# Check contract address
# frontend/src/lib/privateQuote.ts
const CONTRACT_ADDRESS = "0x..."; // Must match deployed contract
```

## 📚 Documentation

- **Simple Guide**: `INTEGRATION_SIMPLE.md`
- **Complete Guide**: `INTEGRATION_COMPLETE.md`
- **Checklist**: `INTEGRATION_CHECKLIST.md`
- **Summary**: `../docs/status/INTEGRATION_SUMMARY.md`
- **Quick Ref**: `QUICK_INTEGRATION_REFERENCE.md` (this file)

## 🎉 Status

```
✅ Integration Complete
✅ Sidebar Navigation Working
✅ Routes Configured
✅ Layout System Active
✅ Theme Consistent
✅ Ready for Testing
```

## 🎯 Next Steps

1. **Test Flow**: Create quote → Pay quote
2. **Polish UI**: Adjust styling if needed
3. **Add Features**: Quote list, analytics, etc.
4. **Migrate FHE**: Bootstrap → Native FHE

## 💡 Quick Commands

```bash
# Start everything
anvil & npm run deploy:private-quote && cd frontend && npm run dev

# Test accounts (Anvil default)
Merchant: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Payer:    0x70997970C51812dc3A010C7d01b50e0d17dc79C8

# Open app
open http://localhost:5173
```

---

**Integration Status**: ✅ COMPLETE  
**Ready for**: Production Testing  
**Next**: Test → Polish → Deploy
