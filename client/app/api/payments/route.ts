import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { PaymentService } from "@/lib/payment-service"

// Validation schema
const paymentSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  currency: z
    .string()
    .length(3, "Currency must be 3 characters")
    .default("usd"),
  token: z.string().min(1, "Payment token is required"),
  planName: z.string().min(1, "Plan name is required"),
  provider: z.enum(["stripe", "paypal", "mock"]).default("stripe"),
});

export const POST = createApiRoute(
  async (request: NextRequest, context, user) => {
    if (!user) {
      throw ApiErrors.unauthorized("User not authenticated");
    }

    const body = await validateRequestBody(request, paymentSchema);

    const paymentService = new PaymentService({
      provider: body.provider,
    });

    const result = await paymentService.processPayment(
      body.amount,
      body.currency,
      body.token,
      {
        planName: body.planName,
        userId: user.id,
        userEmail: user.email || "",
      },
    );

    if (!result.success) {
      throw ApiErrors.internalError(
        `Payment processing failed: ${result.error || "Unknown error"}`,
      );
    }

    return createSuccessResponse(
      {
        payment: {
          id: result.transactionId,
          amount: body.amount,
          currency: body.currency,
          status: "succeeded",
          createdAt: new Date(),
        },
      },
      HttpStatus.CREATED,
      context.requestId,
    );
  },
  {
    requireAuth: true,
    rateLimit: RateLimiters.strict,
  },
);
