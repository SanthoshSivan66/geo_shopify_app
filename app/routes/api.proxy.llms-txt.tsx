/* ──────────────────────────────────────────────
   llms.txt API Endpoint
   
   Generates and serves the llms.txt file for
   Enterprise plan stores. This file tells AI
   bots about the store's products and structure.
   
   Usage: Merchants add a link to this endpoint
   in their theme, or configure a proxy route.
   ────────────────────────────────────────────── */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { getActiveSubscription } from "../services/billing.server";
import { generateLlmsTxt } from "../services/schema-generator.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const shop = session.shop;
  const { admin } = await unauthenticated.admin(shop);

  const { plan } = await getActiveSubscription(admin, shop);

  if (plan !== "enterprise") {
    return new Response(
      "# llms.txt\n\n> This feature requires the Enterprise plan.\n> Upgrade at your GEO Review Tool dashboard.\n",
      {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  // Fetch products
  const productsRes = await admin.graphql(`
    #graphql
    query {
      products(first: 50) {
        edges {
          node {
            id title description handle productType vendor tags
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
            images(first: 1) { edges { node { url altText } } }
            variants(first: 5) {
              edges { node { id title price sku barcode } }
            }
            seo { title description }
          }
        }
      }
    }
  `);
  const productsData = await productsRes.json();
  const products =
    productsData.data?.products?.edges?.map(
      (e: { node: unknown }) => e.node
    ) ?? [];

  // Get shop info
  const shopRes = await admin.graphql(`
    #graphql
    query {
      shop { name url description email currencyCode }
    }
  `);
  const shopData = await shopRes.json();
  const shopInfo = {
    name: shopData.data?.shop?.name ?? shop,
    url: `https://${shop}`,
    description: shopData.data?.shop?.description,
    email: shopData.data?.shop?.email,
    currencyCode: shopData.data?.shop?.currencyCode,
  };

  const llmsTxt = generateLlmsTxt(shopInfo, products);

  return new Response(llmsTxt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
