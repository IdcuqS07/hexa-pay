import { BrowserRouter, Routes, Route, useParams, Link } from "react-router-dom";
import MerchantCreateQuote from "./pages/MerchantCreateQuote";
import PayerPayQuote from "./pages/PayerPayQuote";
import PrivateQuotesPage from "./pages/PrivateQuotesPage";
import PayPrivateQuotePage from "./pages/PayPrivateQuotePage";
import PaymentIntentDemoPage from "./pages/PaymentIntentDemoPage";
import AppLayout from "./components/Layout/AppLayout";
import PublicLayout from "./components/Layout/PublicLayout";

function PayWrapper() {
  const { id } = useParams<{ id: string }>();
  
  if (!id) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h2>Invalid Quote ID</h2>
        <Link to="/">Go Home</Link>
      </div>
    );
  }
  
  return <PayerPayQuote quoteId={id} />;
}

function Home() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-4">
          🔐 HexaPay Private Merchant Quote
        </h1>
        <p className="text-lg text-slate-400">
          Create encrypted payment quotes where the amount stays private on-chain.
          Only authorized parties can see the payment details.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-6">
          <h3 className="text-xl font-semibold text-cyan-300 mb-3">
            🏪 For Merchants
          </h3>
          <p className="text-slate-300 mb-4">
            Create private payment quotes with encrypted amounts.
          </p>
          <Link
            to="/create"
            className="inline-block px-6 py-3 bg-cyan-500 text-slate-950 font-medium rounded-xl hover:bg-cyan-400 transition-colors"
          >
            Create Quote
          </Link>
        </div>

        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
          <h3 className="text-xl font-semibold text-emerald-300 mb-3">
            💳 For Payers
          </h3>
          <p className="text-slate-300 mb-4">
            Receive a payment link from merchant and pay securely.
          </p>
          <div className="rounded-lg bg-slate-950/60 p-4 text-sm text-slate-400">
            Payment links look like:
            <br />
            <code className="text-cyan-400">/pay/0x123...</code>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 mb-6">
        <h3 className="text-xl font-semibold text-amber-300 mb-3">
          ℹ️ Bootstrap Mode
        </h3>
        <p className="text-slate-300 mb-3">
          Currently running in bootstrap mode with simplified encryption.
        </p>
        <ul className="space-y-2 text-slate-300">
          <li className="flex items-start gap-2">
            <span className="text-amber-400">•</span>
            <span>Amounts are encrypted using hash-based mock</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400">•</span>
            <span>Preview not available (blind payment mode)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400">•</span>
            <span>Full FHE encryption coming in Phase 2</span>
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
        <h3 className="text-xl font-semibold text-white mb-3">
          🔐 Privacy Features
        </h3>
        <ul className="space-y-2 text-slate-300">
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✅</span>
            <span>Payment amounts encrypted on-chain</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✅</span>
            <span>Only merchant and payer can access details</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✅</span>
            <span>Blockchain cannot see payment amounts</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✅</span>
            <span>Selective disclosure for compliance</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* App routes with sidebar */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<MerchantCreateQuote />} />
          <Route path="/private-quotes" element={<PrivateQuotesPage />} />
          <Route path="/payment-intent-demo" element={<PaymentIntentDemoPage />} />
        </Route>

        {/* Public routes without sidebar (payment pages) */}
        <Route element={<PublicLayout />}>
          <Route path="/pay/:id" element={<PayPrivateQuotePage />} />
          <Route path="/pay-old/:id" element={<PayWrapper />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
