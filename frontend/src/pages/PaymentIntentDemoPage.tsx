import ExecutePaymentCard from "../components/PaymentIntent/ExecutePaymentCard";

export default function PaymentIntentDemoPage() {
  console.log("PaymentIntentDemoPage rendered");
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white">Payment Intent Demo</h1>
          <p className="mt-2 text-slate-400">
            Test the full payment flow: challenge creation → EIP-712 signing → onchain execution
          </p>
        </div>

        <ExecutePaymentCard />
      </div>
    </div>
  );
}
