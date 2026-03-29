import Stripe from "stripe"
import { createClient } from "./supabase/server"

export interface PaymentConfig {
  provider: "stripe" | "paypal" | "mock"
  apiKey?: string
}

export interface PaymentResult {
  success: boolean
  transactionId: string
  error?: string
}

export class PaymentService {
  private provider: string
  private stripe: Stripe | null = null

  constructor(config: PaymentConfig) {
    this.provider = config.provider
    if (this.provider === "stripe" && process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2025-11-17.clover" as any,
      })
    }
  }

  async processPayment(
    amount: number,
    currency: string = "usd",
    paymentMethodId: string,
    metadata: any = {}
  ): Promise<PaymentResult> {
    let result: PaymentResult

    if (this.provider === "stripe") {
      result = await this.processStripePayment(amount, currency, paymentMethodId)
    } else if (this.provider === "paypal") {
      result = await this.processPayPalPayment(amount, currency, paymentMethodId)
    } else {
      result = await this.processMockPayment(amount, currency)
    }

    if (result.success) {
      await this.savePaymentToDatabase({
        amount,
        currency,
        status: "succeeded",
        provider: this.provider,
        transaction_id: result.transactionId,
        metadata,
        user_id: metadata.userId,
        plan_name: metadata.planName,
      })
    }

    return result
  }

  private async processStripePayment(
    amount: number,
    currency: string,
    paymentMethodId: string
  ): Promise<PaymentResult> {
    if (!this.stripe) {
      return { success: false, transactionId: "", error: "Stripe not configured" }
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        payment_method: paymentMethodId,
        confirm: true,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
      })

      return {
        success: paymentIntent.status === "succeeded",
        transactionId: paymentIntent.id,
      }
    } catch (error: any) {
      return {
        success: false,
        transactionId: "",
        error: error.message,
      }
    }
  }

  private async processPayPalPayment(
    amount: number,
    currency: string,
    paymentMethodId: string
  ): Promise<PaymentResult> {
    // TODO: Implement real PayPal integration
    // For now, still mock but better structure
    return {
      success: true,
      transactionId: `paypal_${Date.now()}`,
    }
  }

  private async processMockPayment(amount: number, currency: string): Promise<PaymentResult> {
    return {
      success: true,
      transactionId: `mock_${Date.now()}`,
    }
  }

  private async savePaymentToDatabase(paymentData: any) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.from("payments").insert(paymentData)
      if (error) throw error
    } catch (error) {
      console.error("Failed to save payment to database:", error)
      // We don't want to fail the whole payment if only the logging fails,
      // but ideally this should be handled by webhooks anyway.
    }
  }

  async refundPayment(transactionId: string): Promise<PaymentResult> {
    if (this.provider === "stripe" && this.stripe) {
      try {
        const refund = await this.stripe.refunds.create({
          payment_intent: transactionId,
        })
        
        // Update database status
        const supabase = await createClient()
        await supabase
          .from("payments")
          .update({ status: "refunded" })
          .eq("transaction_id", transactionId)

        return { success: true, transactionId: refund.id }
      } catch (error: any) {
        return { success: false, transactionId: "", error: error.message }
      }
    }
    
    // Fallback for mock/paypal
    return { success: true, transactionId: `refund_${Date.now()}` }
  }
}
