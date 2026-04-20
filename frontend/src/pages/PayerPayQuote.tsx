import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getQuote, settleQuote, getStatusLabel, Quote, QuoteStatus } from "../lib/contract";

interface PayerPayQuoteProps {
  quoteId: string;
}

export default function PayerPayQuote({ quoteId }: PayerPayQuoteProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadQuote();
  }, [quoteId]);

  async function loadQuote() {
    try {
      setLoading(true);
      setError("");

      if (!window.ethereum) {
        throw new Error("MetaMask not installed");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const quoteData = await getQuote(provider, quoteId);

      setQuote(quoteData);
      console.log("Quote loaded:", quoteData);
    } catch (err: any) {
      console.error("Error loading quote:", err);
      setError(err.message || "Failed to load quote");
    } finally {
      setLoading(false);
    }
  }

  async function handlePay() {
    try {
      setPaying(true);
      setError("");

      if (!window.ethereum) {
        throw new Error("MetaMask not installed");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Verify payer
      if (quote?.payer !== ethers.ZeroAddress && quote?.payer !== signerAddress) {
        throw new Error("You are not authorized to pay this quote");
      }

      // Settle quote (skipPreview=true in bootstrap mode)
      console.log("Settling quote...", quoteId);
      const tx = await settleQuote(signer, quoteId, true);
      
      console.log("Waiting for confirmation...");
      await tx.wait();

      setSuccess(true);
      console.log("Payment successful!");

      // Reload quote to show updated status
      await loadQuote();
    } catch (err: any) {
      console.error("Error paying quote:", err);
      setError(err.message || "Failed to process payment");
    } finally {
      setPaying(false);
    }
  }

  function isExpired(): boolean {
    if (!quote) return false;
    return Number(quote.expiresAt) < Math.floor(Date.now() / 1000);
  }

  function canPay(): boolean {
    if (!quote) return false;
    return quote.status === QuoteStatus.Pending && !isExpired();
  }

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h2>Loading Quote...</h2>
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8d7da",
          border: "1px solid #f5c6cb",
          borderRadius: "4px"
        }}>
          <h3 style={{ marginTop: 0 }}>❌ Error</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <h2>Pay Private Quote</h2>

      {success && (
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#d4edda",
          border: "1px solid #c3e6cb",
          borderRadius: "4px",
          marginBottom: "20px"
        }}>
          <h3 style={{ marginTop: 0 }}>✅ Payment Successful!</h3>
          <p style={{ marginBottom: 0 }}>
            Your payment has been processed on-chain.
          </p>
        </div>
      )}

      {quote && (
        <div>
          <div style={{ 
            padding: "15px",
            backgroundColor: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: "4px",
            marginBottom: "20px"
          }}>
            <h3 style={{ marginTop: 0 }}>Quote Details</h3>
            
            <div style={{ marginBottom: "10px" }}>
              <strong>Merchant:</strong>
              <div style={{ 
                fontFamily: "monospace", 
                fontSize: "12px",
                wordBreak: "break-all"
              }}>
                {quote.merchant}
              </div>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <strong>Payer:</strong>
              <div style={{ 
                fontFamily: "monospace", 
                fontSize: "12px",
                wordBreak: "break-all"
              }}>
                {quote.payer === ethers.ZeroAddress ? "Anyone" : quote.payer}
              </div>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <strong>Status:</strong>{" "}
              <span style={{ 
                padding: "2px 8px",
                backgroundColor: quote.status === QuoteStatus.Pending ? "#fff3cd" : 
                                quote.status === QuoteStatus.Settled ? "#d4edda" : "#f8d7da",
                borderRadius: "4px",
                fontSize: "14px"
              }}>
                {getStatusLabel(quote.status)}
              </span>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <strong>Expires:</strong>{" "}
              {new Date(Number(quote.expiresAt) * 1000).toLocaleString()}
              {isExpired() && (
                <span style={{ color: "red", marginLeft: "10px" }}>
                  (Expired)
                </span>
              )}
            </div>

            <div style={{ marginBottom: "10px" }}>
              <strong>Access Granted:</strong>{" "}
              {quote.accessGranted ? "✅ Yes" : "❌ No"}
            </div>
          </div>

          {error && (
            <div style={{ 
              padding: "15px", 
              backgroundColor: "#f8d7da",
              border: "1px solid #f5c6cb",
              borderRadius: "4px",
              marginBottom: "20px"
            }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {canPay() && !success && (
            <div>
              <div style={{ 
                padding: "15px",
                backgroundColor: "#fff3cd",
                border: "1px solid #ffeaa7",
                borderRadius: "4px",
                marginBottom: "15px"
              }}>
                <strong>ℹ️ Bootstrap Mode:</strong>
                <p style={{ marginBottom: 0, fontSize: "14px" }}>
                  Amount is encrypted and cannot be previewed yet.
                  You are making a blind payment (trusted merchant).
                </p>
              </div>

              <button
                onClick={handlePay}
                disabled={paying}
                style={{
                  padding: "12px 24px",
                  backgroundColor: paying ? "#ccc" : "#28a745",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: paying ? "not-allowed" : "pointer",
                  fontSize: "16px",
                  width: "100%"
                }}
              >
                {paying ? "Processing..." : "💳 Pay Now (Blind Payment)"}
              </button>
            </div>
          )}

          {!canPay() && !success && (
            <div style={{ 
              padding: "15px",
              backgroundColor: "#f8d7da",
              border: "1px solid #f5c6cb",
              borderRadius: "4px"
            }}>
              <strong>Cannot Pay:</strong>
              <p style={{ marginBottom: 0 }}>
                {quote.status !== QuoteStatus.Pending 
                  ? "Quote is not in pending status"
                  : "Quote has expired"}
              </p>
            </div>
          )}
        </div>
      )}

      <div style={{ 
        marginTop: "30px",
        padding: "15px",
        backgroundColor: "#e7f3ff",
        border: "1px solid #b3d9ff",
        borderRadius: "4px"
      }}>
        <strong>🔐 Privacy Guarantee:</strong>
        <p style={{ marginBottom: 0, fontSize: "14px" }}>
          The payment amount is encrypted on-chain. Only authorized parties
          can decrypt the amount. The blockchain cannot see how much you paid.
        </p>
      </div>
    </div>
  );
}
