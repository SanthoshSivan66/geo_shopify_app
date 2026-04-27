import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Clean up all store data (GDPR compliance)
  // Delete in reverse dependency order to respect foreign key constraints
  if (shop) {
    await db.competitorScan.deleteMany({ where: { shop } });
    await db.scanHistory.deleteMany({ where: { shop } });
    await db.store.deleteMany({ where: { shop } });
  }

  // Delete OAuth sessions
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
