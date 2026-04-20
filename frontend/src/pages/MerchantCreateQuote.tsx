import { useState } from "react";
import { ethers } from "ethers";
import { createQuote, grantAccess } from "../lib/contract";
import { encryptAmount, generateQuoteId } from "../lib/crypto";

// Debug flags for testing
const DEBUG_SHORT_EXPIRY = false;
const DEBUG_FIXED_QUOTE_ID = false;

export default function MerchantCreateQuote() {
  const [amount, setAmount] = useState("");
  const [payerAddress, setPayerAddress] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateQuote() {
    try {
      setLoading(true);
      setError("");

      // Validate inputs
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        throw new Error("Invalid amount");
      }

      if (!ethers.isAddress(payerAddress)) {
        throw new Error("Invalid payer address");
      }

      // Get signer
      if (!window.ethereum) {
        throw new Error("MetaMask not installed");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      // Generate quote ID
      const id = DEBUG_FIXED_QUOTE_ID
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : generateQuoteId();

      // Encrypt amount (bootstrap: simple hash)
      const amountCt = encryptAmount(Number(amount));

      // Set expiry (10 seconds for testing, 1 hour for production)
      const expiry = DEBUG_SHORT_EXPIRY
        ? Math.floor(Date.now() / 1000) + 10
        : Math.floor(Date.now() / 1000) + 3600;

      // Create quote on-chain
      console.log("Creating quote...", { id, payerAddress, amountCt, expiry });
      const tx = await createQuote(signer, id, payerAddress, amountCt, expiry);
      
      console.log("Waiting for confirmation...");
      await tx.wait();

      // Grant access to payer (optional in bootstrap, but good practice)
      console.log("Granting access to payer...");
      const grantTx = await grantAccess(signer, id, payerAddress);
      await grantTx.wait();

      setQuoteId(id);
      console.log("Quote created successfully:", id);
    } catch (err: any) {
      console.error("Error creating quote:", err);
      const msg = String(err?.message || "");
      
      if (msg.includes("execution reverted") || msg.includes("AlreadyExists")) {
        setError("Quote ID already exists. Please try again.");
      } else {
        setError(msg || "Failed to create quote");
      }
    } finally {
      setLoading(false);
    }
  }

  function getPaymentLink() {
    return `${window.location.origin}/pay/${quoteId}`;
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(getPaymentLink());
    alert("Link copied to clipboard!");
  }

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <h2>Create Private Quote</h2>

      {!quoteId ? (
        <div>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Amount (units):
            </label>
            <input
              type="number"
              placeholder="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Payer Address:
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={payerAddress}
              onChange={(e) => setPayerAddress(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
              disabled={loading}
            />
          </div>

          {error && (
            <div style={{ color: "red", marginBottom: "15px" }}>
              Error: {error}
            </div>
          )}

          <button
            onClick={handleCreateQuote}
            disabled={loading}
            style={{
              padding: "10px 20px",
              backgroundColor: loading ? "#ccc" : "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "Creating..." : "Create Quote"}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ 
            padding: "15px", 
            backgroundColor: "#d4edda", 
            border: "1px solid #c3e6cb",
            borderRadius: "4px",
            marginBottom: "20px"
          }}>
            <h3 style={{ marginTop: 0 }}>✅ Quote Created!</h3>
            
            <div style={{ marginBottom: "10px" }}>
              <strong>Quote ID:</strong>
              <div style={{ 
                fontFamily: "monospace", 
                fontSize: "12px",
                wordBreak: "break-all",
                backgroundColor: "white",
                padding: "8px",
                borderRadius: "4px",
                marginTop: "5px"
              }}>
                {quoteId}
              </div>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <strong>Payment Link:</strong>
              <div style={{ 
                fontFamily: "monospace", 
                fontSize: "12px",
                wordBreak: "break-all",
                backgroundColor: "white",
                padding: "8px",
                borderRadius: "4px",
                marginTop: "5px"
              }}>
                {getPaymentLink()}
              </div>
            </div>

            <button
              onClick={copyToClipboard}
              style={{
                padding: "8px 16px",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                marginTop: "10px"
              }}
            >
              📋 Copy Link
            </button>
          </div>

          <div style={{ 
            padding: "15px", 
            backgroundColor: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: "4px"
          }}>
            <h4 style={{ marginTop: 0 }}>Next Steps:</h4>
            <ol style={{ marginBottom: 0 }}>
              <li>Share the payment link with the payer</li>
              <li>Payer opens link and approves payment</li>
              <li>Payment settles on-chain (encrypted)</li>
            </ol>
          </div>

          <button
            onClick={() => {
              setQuoteId("");
              setAmount("");
              setPayerAddress("");
            }}
            style={{
              padding: "8px 16px",
              backgroundColor: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              marginTop: "15px"
            }}
          >
            Create Another Quote
          </button>
        </div>
      )}

      <div style={{ 
        marginTop: "30px", 
        padding: "15px",
        backgroundColor: "#fff3cd",
        border: "1px solid #ffeaa7",
        borderRadius: "4px"
      }}>
        <strong>ℹ️ Bootstrap Mode:</strong>
        <p style={{ marginBottom: 0, fontSize: "14px" }}>
          Currently using simplified encryption (hash-based). 
          Amount is encrypted but preview is not available yet.
          Payer will use blind payment (skipPreview=true).
        </p>
      </div>
    </div>
  );
}
