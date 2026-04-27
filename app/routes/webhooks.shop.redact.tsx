import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // We do not store PII, so nothing to redact. But typically we might wipe the DB record.
  // Actually, uninstalled webhook already wipes the session. We can leave it simple.
  return new Response("OK", { status: 200 });
};
