import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { PaymentService } from "@/lib/payment-service"

// Validation schema
const refundSchema = z.object({
  transactionId: z.string().min(1, "Transaction ID is required"),
})

export const POST = createApiRoute(
  async (request: NextRequest, context, user) => {
    if (!user) {
      throw ApiErrors.unauthorized("User not authenticated")
    }

    // Validate request body
    const body = await validateRequestBody(request, refundSchema)

    const paymentService = new PaymentService({
      provider: "stripe", // For now, assume Stripe
    })

    const result = await paymentService.refundPayment(body.transactionId)

    if (!result.success) {
      throw ApiErrors.internalError(`Refund failed: ${result.error || "Unknown error"}`)
    }

    return createSuccessResponse(
      {
        refundId: result.transactionId,
        status: "refunded",
      },
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    requireAuth: true,
    rateLimit: RateLimiters.strict,
  }
)
