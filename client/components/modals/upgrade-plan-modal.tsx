"use client"
import { X, Check, Copy, Wallet, CreditCard, Shield, Zap } from "lucide-react"
import { useState, useEffect } from "react"
import QRCode from "react-qr-code"

interface CryptoPaymentFormProps {
  plan: any
  onSuccess: () => void
  onCancel: () => void
  darkMode?: boolean
}

function CryptoPaymentForm({ plan, onSuccess, onCancel, darkMode }: CryptoPaymentFormProps) {
  const [selectedToken, setSelectedToken] = useState("USDC")
  const [selectedChain, setSelectedChain] = useState("ethereum")
  const [copied, setCopied] = useState(false)
  const [txHash, setTxHash] = useState("")

  const tokens = [
    { id: "USDC", name: "USDC", icon: "💵" },
    { id: "USDT", name: "USDT", icon: "💲" },
    { id: "DAI", name: "DAI", icon: "◈" },
  ]

  const chains = [
    { id: "ethereum", name: "Ethereum", icon: "⟠", color: "#627EEA" },
    { id: "polygon", name: "Polygon", icon: "⬡", color: "#8247E5" },
    { id: "bsc", name: "BSC", icon: "◆", color: "#F3BA2F" },
    { id: "tron", name: "Tron", icon: "▲", color: "#FF0013" },
  ]

  const walletAddresses = {
    ethereum: "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE1",
    polygon: "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE2",
    bsc: "0x742d35Cc6634C0532925a3b844Bc9e7595f42bE3",
    tron: "TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS",
  }

  const currentWallet = (walletAddresses as Record<string, string>)[selectedChain]
  const selectedChainData = chains.find((c) => c.id === selectedChain)
  const selectedTokenData = tokens.find((t) => t.id === selectedToken)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(currentWallet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleConfirm = () => {
    if (!txHash) {
      alert("Please enter your transaction hash")
      return
    }
    onSuccess()
  }

  return (
    <div className="space-y-6">
      {/* Token Selection */}
      <div>
        <label className={`block text-sm font-semibold mb-3 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
          Select Stablecoin
        </label>
        <div className="grid grid-cols-3 gap-3">
          {tokens.map((token) => (
            <button
              key={token.id}
              onClick={() => setSelectedToken(token.id)}
              className={`p-4 rounded-xl border-2 transition-all ${
                selectedToken === token.id
                  ? darkMode
                    ? "border-[#FFD166] bg-[#FFD166]/10"
                    : "border-[#1E2A35] bg-[#1E2A35]/5"
                  : darkMode
                    ? "border-[#374151] hover:border-[#4B5563]"
                    : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <span className="text-2xl">{token.icon}</span>
                <span className={`font-semibold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>{token.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chain Selection */}
      <div>
        <label className={`block text-sm font-semibold mb-3 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
          Select Blockchain Network
        </label>
        <div className="grid grid-cols-2 gap-3">
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              className={`p-4 rounded-xl border-2 transition-all ${
                selectedChain === chain.id
                  ? darkMode
                    ? "border-[#FFD166] bg-[#FFD166]/10"
                    : "border-[#1E2A35] bg-[#1E2A35]/5"
                  : darkMode
                    ? "border-[#374151] hover:border-[#4B5563]"
                    : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{chain.icon}</span>
                <span className={`font-semibold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>{chain.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Payment Details */}
      <div
        className={`p-6 rounded-xl border-2 ${darkMode ? "border-[#374151] bg-[#2D3748]" : "border-gray-200 bg-gray-50"}`}
      >
        <div className="flex items-center justify-between mb-4">
          <span className={`text-sm font-medium ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Amount to Send</span>
          <span className={`text-2xl font-bold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
            ${plan.price} {selectedToken}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span
            className="text-xl"
            style={{
              color: selectedChainData?.color,
            }}
          >
            {selectedChainData?.icon}
          </span>
          <span className={`text-sm font-medium ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
            {selectedChainData?.name} Network
          </span>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-4 p-4 bg-white rounded-lg">
          <QRCode value={currentWallet} size={160} />
        </div>

        {/* Wallet Address */}
        <div>
          <label className={`block text-xs font-medium mb-2 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
            Wallet Address
          </label>
          <div
            className={`flex items-center gap-2 p-3 rounded-lg ${darkMode ? "bg-[#1E2A35]" : "bg-white"} border ${darkMode ? "border-[#374151]" : "border-gray-200"}`}
          >
            <code className={`flex-1 text-xs font-mono ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"} break-all`}>
              {currentWallet}
            </code>
            <button
              onClick={copyToClipboard}
              className={`p-2 rounded-lg transition-colors ${darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"}`}
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          {copied && (
            <p className={`text-xs mt-2 ${darkMode ? "text-[#007A5C]" : "text-green-600"}`}>Copied to clipboard!</p>
          )}
        </div>
      </div>

      {/* Transaction Hash Input */}
      <div>
        <label className={`block text-sm font-semibold mb-2 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
          Transaction Hash <span className="text-[#E86A33]">*</span>
        </label>
        <input
          type="text"
          placeholder="0x..."
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          className={`w-full px-4 py-3 rounded-lg border-2 font-mono text-sm ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-[#F9F6F2] focus:border-[#FFD166]"
              : "bg-white border-gray-200 text-[#1E2A35] focus:border-[#1E2A35]"
          } focus:outline-none transition-colors`}
        />
        <p className={`text-xs mt-2 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
          Enter your transaction hash after sending the payment
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onCancel}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
            darkMode ? "bg-[#374151] text-[#F9F6F2] hover:bg-[#4B5563]" : "bg-gray-100 text-[#1E2A35] hover:bg-gray-200"
          }`}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!txHash}
          className="flex-1 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Confirm Payment
        </button>
      </div>
    </div>
  )
}

interface StripePaymentFormProps {
  plan: any
  onSuccess: () => void
  onCancel: () => void
  darkMode?: boolean
}

function StripePaymentForm({ plan, onSuccess, onCancel, darkMode }: StripePaymentFormProps) {
  const [loading, setLoading] = useState(false)
  const [cardNumber, setCardNumber] = useState("")
  const [expiry, setExpiry] = useState("")
  const [cvc, setCvc] = useState("")
  const [name, setName] = useState("")

  const formatCardNumber = (value: string) => {
    return value
      .replace(/\s/g, "")
      .replace(/(\d{4})/g, "$1 ")
      .trim()
  }

  const formatExpiry = (value: string) => {
    const cleaned = value.replace(/\D/g, "")
    if (cleaned.length >= 2) {
      return cleaned.slice(0, 2) + "/" + cleaned.slice(2, 4)
    }
    return cleaned
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!cardNumber || !expiry || !cvc || !name) {
      alert("Please fill in all card details")
      return
    }

    setLoading(true)
    try {
      // In a real implementation with Stripe Elements, you would create a payment method here.
      // For this implementation, we'll send a test token to our new backend.
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: plan.price,
          currency: "usd",
          token: "tok_visa", // Mock Stripe test token
          planName: plan.name,
          provider: "stripe",
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Payment failed")
      }

      setLoading(false)
      onSuccess()
    } catch (error: any) {
      setLoading(false)
      alert(`Payment failed: ${error.message}`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Card Number */}
      <div>
        <label className={`block text-sm font-semibold mb-2 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
          Card Number
        </label>
        <input
          type="text"
          placeholder="4242 4242 4242 4242"
          value={cardNumber}
          onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
          maxLength={19}
          className={`w-full px-4 py-3 rounded-lg border-2 ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-[#F9F6F2] focus:border-[#FFD166]"
              : "bg-white border-gray-200 text-[#1E2A35] focus:border-[#1E2A35]"
          } focus:outline-none transition-colors`}
        />
      </div>

      {/* Cardholder Name */}
      <div>
        <label className={`block text-sm font-semibold mb-2 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
          Cardholder Name
        </label>
        <input
          type="text"
          placeholder="John Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`w-full px-4 py-3 rounded-lg border-2 ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-[#F9F6F2] focus:border-[#FFD166]"
              : "bg-white border-gray-200 text-[#1E2A35] focus:border-[#1E2A35]"
          } focus:outline-none transition-colors`}
        />
      </div>

      {/* Expiry and CVC */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={`block text-sm font-semibold mb-2 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
            Expiry Date
          </label>
          <input
            type="text"
            placeholder="MM/YY"
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            maxLength={5}
            className={`w-full px-4 py-3 rounded-lg border-2 ${
              darkMode
                ? "bg-[#2D3748] border-[#374151] text-[#F9F6F2] focus:border-[#FFD166]"
                : "bg-white border-gray-200 text-[#1E2A35] focus:border-[#1E2A35]"
            } focus:outline-none transition-colors`}
          />
        </div>
        <div>
          <label className={`block text-sm font-semibold mb-2 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
            CVC
          </label>
          <input
            type="text"
            placeholder="123"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 3))}
            maxLength={3}
            className={`w-full px-4 py-3 rounded-lg border-2 ${
              darkMode
                ? "bg-[#2D3748] border-[#374151] text-[#F9F6F2] focus:border-[#FFD166]"
                : "bg-white border-gray-200 text-[#1E2A35] focus:border-[#1E2A35]"
            } focus:outline-none transition-colors`}
          />
        </div>
      </div>

      {/* Security Badge */}
      <div
        className={`flex items-center gap-3 p-4 rounded-lg ${darkMode ? "bg-[#007A5C]/10 border border-[#007A5C]/30" : "bg-green-50 border border-green-200"}`}
      >
        <Shield className={`w-5 h-5 ${darkMode ? "text-[#007A5C]" : "text-green-600"}`} />
        <p className={`text-sm ${darkMode ? "text-[#007A5C]" : "text-green-800"}`}>
          Your payment is secured with 256-bit SSL encryption
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
            darkMode ? "bg-[#374151] text-[#F9F6F2] hover:bg-[#4B5563]" : "bg-gray-100 text-[#1E2A35] hover:bg-gray-200"
          }`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Processing..." : `Pay $${plan.price}/month`}
        </button>
      </div>
    </form>
  )
}

interface UpgradePlanModalProps {
  currentPlan: string
  onUpgrade: (plan: string) => void
  onClose: () => void
  darkMode?: boolean
}

interface Plan {
  name: string
  displayName: string
  price: number
  features: string[]
  popular?: boolean
}

export default function UpgradePlanModal({ currentPlan, onUpgrade, onClose, darkMode }: UpgradePlanModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "crypto">("stripe")

  const plans = [
    {
      name: "free",
      displayName: "Free",
      price: 0,
      features: [
        "Up to 5 AI subscriptions",
        "Basic analytics",
        "Manual subscription entry",
        "Email notifications",
        "Community support",
      ],
      popular: false,
    },
    {
      name: "pro",
      displayName: "Individual Pro",
      price: 5,
      features: [
        "Up to 20 AI subscriptions",
        "Advanced analytics & insights",
        "Email & bank integration",
        "Budget alerts & tracking",
        "Priority email support",
      ],
      popular: true,
    },
    {
      name: "enterprise",
      displayName: "Enterprise",
      price: 60,
      features: [
        "Unlimited AI subscriptions",
        "Team management & collaboration",
        "Usage tracking per member",
        "API access & integrations",
        "Custom reports & exports",
        "24/7 priority support",
        "Dedicated account manager",
      ],
    },
  ]

  useEffect(() => {
    if (selectedPlan && selectedPlan.price === 0) {
      onUpgrade(selectedPlan.name)
      onClose()
    }
  }, [selectedPlan, onUpgrade, onClose])

  if (selectedPlan && selectedPlan.price === 0) {
    return null
  }

  if (selectedPlan) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div
          className={`${darkMode ? "bg-[#1E2A35]" : "bg-[#F9F6F2]"} rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto`}
        >
          {/* Header */}
          <div className={`p-6 border-b ${darkMode ? "border-[#374151]" : "border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className={`text-2xl font-bold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
                  Complete Your Purchase
                </h2>
                <p className={`text-sm mt-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  Choose your preferred payment method
                </p>
              </div>
              <button
                onClick={() => setSelectedPlan(null)}
                className={`p-2 rounded-lg transition-colors ${darkMode ? "hover:bg-[#2D3748]" : "hover:bg-gray-100"}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Plan Summary */}
            <div
              className={`p-6 rounded-xl mb-6 ${darkMode ? "bg-[#2D3748] border border-[#374151]" : "bg-white border border-gray-200"}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Upgrading to</p>
                  <h3 className={`text-xl font-bold mt-1 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
                    {selectedPlan.displayName}
                  </h3>
                </div>
                <div className="text-right">
                  <p className={`text-3xl font-bold ${darkMode ? "text-[#FFD166]" : "text-[#1E2A35]"}`}>
                    ${selectedPlan.price}
                  </p>
                  <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>per month</p>
                </div>
              </div>
            </div>

            {/* Payment Method Selection */}
            <div className="mb-6">
              <label className={`block text-sm font-semibold mb-3 ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
                Payment Method
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("stripe")}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    paymentMethod === "stripe"
                      ? "border-[#FFD166] bg-[#FFD166]/10"
                      : darkMode
                        ? "border-[#374151] hover:border-[#4B5563]"
                        : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5" />
                    <div className="text-left">
                      <p className={`font-semibold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>Card Payment</p>
                      <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Visa, Mastercard</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setPaymentMethod("crypto")}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    paymentMethod === "crypto"
                      ? "border-[#FFD166] bg-[#FFD166]/10"
                      : darkMode
                        ? "border-[#374151] hover:border-[#4B5563]"
                        : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Wallet className="w-5 h-5" />
                    <div className="text-left">
                      <p className={`font-semibold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
                        Cryptocurrency
                      </p>
                      <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>USDC, USDT, DAI</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Payment Form */}
            {paymentMethod === "stripe" ? (
              <StripePaymentForm
                plan={selectedPlan}
                onSuccess={() => {
                  onUpgrade(selectedPlan.name)
                  setSelectedPlan(null)
                }}
                onCancel={() => setSelectedPlan(null)}
                darkMode={darkMode}
              />
            ) : (
              <CryptoPaymentForm
                plan={selectedPlan}
                onSuccess={() => {
                  onUpgrade(selectedPlan.name)
                  setSelectedPlan(null)
                }}
                onCancel={() => setSelectedPlan(null)}
                darkMode={darkMode}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className={`${darkMode ? "bg-[#1E2A35]" : "bg-[#F9F6F2]"} rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-auto`}
      >
        {/* Header */}
        <div className={`p-8 border-b ${darkMode ? "border-[#374151]" : "border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-3xl font-bold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
                Choose Your Plan
              </h2>
              <p className={`text-sm mt-2 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                Upgrade to unlock advanced features and scale your AI subscription management
              </p>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${darkMode ? "hover:bg-[#2D3748]" : "hover:bg-gray-100"}`}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="p-8">
          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border-2 p-8 relative transition-all ${
                  plan.popular
                    ? "border-[#FFD166] bg-[#FFD166]/5 shadow-xl"
                    : darkMode
                      ? "border-[#374151] hover:border-[#4B5563]"
                      : "border-gray-200 hover:border-gray-300"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-[#FFD166] text-[#1E2A35] px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Most Popular
                  </div>
                )}

                <div className="mb-6">
                  <h3 className={`text-2xl font-bold ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>
                    {plan.displayName}
                  </h3>
                  <div className="mt-4 flex items-baseline gap-2">
                    {plan.price === 0 ? (
                      <span className={`text-5xl font-bold ${darkMode ? "text-[#FFD166]" : "text-[#1E2A35]"}`}>
                        Free
                      </span>
                    ) : (
                      <>
                        <span className={`text-5xl font-bold ${darkMode ? "text-[#FFD166]" : "text-[#1E2A35]"}`}>
                          ${plan.price}
                        </span>
                        <span className={`text-lg ${darkMode ? "text-gray-400" : "text-gray-600"}`}>/month</span>
                      </>
                    )}
                  </div>
                </div>

                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-[#007A5C] flex-shrink-0 mt-0.5" />
                      <span className={`text-sm ${darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"}`}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => setSelectedPlan(plan)}
                  className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                    plan.popular
                      ? "bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90 shadow-lg hover:shadow-xl"
                      : darkMode
                        ? "bg-[#2D3748] text-[#F9F6F2] hover:bg-[#374151] border-2 border-[#374151]"
                        : "bg-white text-[#1E2A35] hover:bg-gray-50 border-2 border-gray-200"
                  }`}
                >
                  {plan.price === 0 ? "Get Started Free" : "Get Started"}
                </button>
              </div>
            ))}
          </div>

          {/* Payment Methods Info */}
          <div
            className={`mt-8 p-6 rounded-xl ${darkMode ? "bg-[#2D3748] border border-[#374151]" : "bg-white border border-gray-200"}`}
          >
            <div className="flex items-center justify-center gap-8 flex-wrap">
              <div className="flex items-center gap-2">
                <CreditCard className={`w-5 h-5 ${darkMode ? "text-gray-400" : "text-gray-600"}`} />
                <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Stripe Payments</span>
              </div>
              <div className="flex items-center gap-2">
                <Wallet className={`w-5 h-5 ${darkMode ? "text-gray-400" : "text-gray-600"}`} />
                <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  Crypto: USDC, USDT, DAI
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className={`w-5 h-5 ${darkMode ? "text-gray-400" : "text-gray-600"}`} />
                <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Secure & Encrypted</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
