import ReactDOM from 'react-dom/client';
import HexaPayExecuteCard from './components/PaymentIntent/HexaPayExecuteCard';
import './index.css';

function PaymentIntentStandalone() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <HexaPayExecuteCard />
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <PaymentIntentStandalone />
);
