import { authenticate } from "../shopify.server";

/* ──────────────────────────────────────────────
   Plan Definitions
   ────────────────────────────────────────────── */
export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    features: [
      "GEO Score Dashboard",
      "6-Category Breakdown",
      "Basic Recommendations",
      "AI Bot Access Check",
      "1 scan per day",
    ],
  },
  pro: {
    name: "Pro",
    price: 7.99,
    features: [
      "Everything in Free",
      "Auto Product Schema (JSON-LD)",
      "Organization Schema",
      "BreadcrumbList Schema",
      "One-Click Theme Install",
      "Schema Dashboard",
      "Unlimited Rescans",
      "Advanced Recommendations",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 19.99,
    features: [
      "Everything in Pro",
      "FAQ Schema Generator",
      "llms.txt Generation",
      "AI Bot Access Monitoring",
      "Competitor Comparison",
    ],
  },
} as const;

export type PlanId = keyof typeof PLANS;

/* ──────────────────────────────────────────────
   Create a recurring subscription charge
   ────────────────────────────────────────────── */
export async function createSubscription(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  plan: PlanId,
  shop: string,
  returnUrl: string
) {
  if (plan === "free") {
    return null;
  }

  const planConfig = PLANS[plan];

  const response = await admin.graphql(
    `#graphql
    mutation CreateSubscription($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        test: $test
        lineItems: $lineItems
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: `GEO Review Tool - ${planConfig.name}`,
        returnUrl,
        test: process.env.NODE_ENV !== "production" || process.env.SHOPIFY_TEST_BILLING === "true", // Use test charges in local dev or when explicitly flagged
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: planConfig.price,
                  currencyCode: "USD",
                },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    }
  );

  const data = await response.json();
  const { appSubscriptionCreate } = data.data!;

  if (appSubscriptionCreate.userErrors.length > 0) {
    throw new Error(
      appSubscriptionCreate.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ")
    );
  }

  return {
    subscriptionId: appSubscriptionCreate.appSubscription.id,
    confirmationUrl: appSubscriptionCreate.confirmationUrl,
  };
}

/* ──────────────────────────────────────────────
   Check active subscription status
   Falls back to database if Billing API unavailable
   (e.g., Custom distribution apps)
   ────────────────────────────────────────────── */
export async function getActiveSubscription(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  shop?: string
) {
  try {
    const response = await admin.graphql(
      `#graphql
      query {
        appInstallation {
          activeSubscriptions {
            id
            name
            status
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    price {
                      amount
                      currencyCode
                    }
                    interval
                  }
                }
              }
            }
            currentPeriodEnd
            test
          }
        }
      }`
    );

    const data = await response.json();
    const subscriptions =
      data.data?.appInstallation?.activeSubscriptions ?? [];

    if (subscriptions.length === 0) {
      // No active subscription via API — check database fallback
      if (shop) {
        return await getStorePlanFromDb(shop);
      }
      return { plan: "free" as PlanId, subscription: null };
    }

    const activeSub = subscriptions[0];
    const price = parseFloat(
      activeSub.lineItems[0]?.plan?.pricingDetails?.price?.amount ?? "0"
    );

    let plan: PlanId = "free";
    if (price >= 19.99) {
      plan = "enterprise";
    } else if (price >= 7.99) {
      plan = "pro";
    }

    return { plan, subscription: activeSub };
  } catch {
    // Billing API not available (custom distribution) — use database
    if (shop) {
      return await getStorePlanFromDb(shop);
    }
    return { plan: "free" as PlanId, subscription: null };
  }
}

/* ──────────────────────────────────────────────
   Get plan from database (fallback)
   ────────────────────────────────────────────── */
async function getStorePlanFromDb(shop: string) {
  const { default: prisma } = await import("../db.server");
  const store = await prisma.store.findUnique({ where: { shop } });
  const plan = (store?.plan as PlanId) || "free";
  return { plan, subscription: null };
}

/* ──────────────────────────────────────────────
   Cancel subscription
   ────────────────────────────────────────────── */
export async function cancelSubscription(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  subscriptionId: string
) {
  const response = await admin.graphql(
    `#graphql
    mutation CancelSubscription($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: { id: subscriptionId },
    }
  );

  const data = await response.json();
  return data.data?.appSubscriptionCancel;
}
