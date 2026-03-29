import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase/server"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover" as any,
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  let event: Stripe.Event

  try {
    if (!signature || !webhookSecret) {
      throw new Error("Missing stripe-signature or webhook secret")
    }
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`)
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  const supabase = await createClient()

  // Handle the event
  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntentSucceeded = event.data.object as Stripe.PaymentIntent
      console.log(`PaymentIntent for ${paymentIntentSucceeded.amount} was successful!`)
      
      // Update payment status in database
      await supabase
        .from("payments")
        .update({ status: "succeeded" })
        .eq("transaction_id", paymentIntentSucceeded.id)
      
      // Here you would also update the user's subscription record
      // e.g., extend active_until, update plan_name, etc.
      if (paymentIntentSucceeded.metadata.userId) {
        await supabase
          .from("profiles")
          .update({ 
            // example: update a subscription_status field if it exists
            subscription_tier: paymentIntentSucceeded.metadata.planName 
          })
          .eq("id", paymentIntentSucceeded.metadata.userId)
      }
      break;

    case "payment_intent.payment_failed":
      const paymentIntentFailed = event.data.object as Stripe.PaymentIntent
      console.log(`PaymentIntent for ${paymentIntentFailed.amount} failed.`)
      
      await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("transaction_id", paymentIntentFailed.id)
      break;

    default:
      console.log(`Unhandled event type ${event.type}`)
  }

  return NextResponse.json({ received: true })
}

export const config = {
  api: {
    bodyParser: false, // Stripe webhooks need raw body
  },
}
