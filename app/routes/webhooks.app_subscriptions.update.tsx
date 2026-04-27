import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = payload?.app_subscription;
  if (!subscription) return new Response("OK", { status: 200 });

  const status = subscription.status; // e.g. ACTIVE, CANCELLED, CANCELLED_ON_BILLING_CYCLE_END, EXPIRED, DECLINED
  
  if (status !== "ACTIVE") {
    // If they canceled or payment failed, downgrade to free instantly
    await prisma.store.upsert({
      where: { shop },
      create: { shop, plan: "free" },
      update: { plan: "free" },
    });
    console.log(`Downgraded store ${shop} to free due to status: ${status}`);
  } else {
    // If ACTIVE, extract plan name from subscription name
    const name = subscription.name?.toLowerCase() || "";
    const activePlan = name.includes("enterprise") ? "enterprise" : name.includes("pro") ? "pro" : "free";
    
    await prisma.store.upsert({
      where: { shop },
      create: { shop, plan: activePlan },
      update: { plan: activePlan },
    });
    console.log(`Synced store ${shop} to plan: ${activePlan}`);
  }

  return new Response("OK", { status: 200 });
};
