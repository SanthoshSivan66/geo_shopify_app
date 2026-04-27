/* ──────────────────────────────────────────────
   Auto-Fix Service
   
   Generates and applies SEO improvements to
   Shopify products via the Admin API.
   ────────────────────────────────────────────── */

import { authenticate } from "../shopify.server";

type AdminClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

interface ProductIssue {
  id: string;
  handle: string;
  title: string;
  currentSeoTitle: string | null;
  currentSeoDescription: string | null;
  description: string;
  productType: string;
  vendor: string;
  price: string;
  currency: string;
  imageCount: number;
  imagesWithoutAlt: Array<{ id: string; url: string }>;
  issues: string[];
  fixes: {
    seoTitle?: string;
    seoDescription?: string;
    altTexts?: Array<{ id: string; altText: string }>;
  };
}

/* ──────────────────────────────────────────────
   Scan products for fixable issues
   ────────────────────────────────────────────── */
export async function scanForIssues(
  admin: AdminClient,
  shopName: string
): Promise<{
  products: ProductIssue[];
  summary: {
    totalProducts: number;
    missingSeoTitle: number;
    missingSeoDesc: number;
    missingAltText: number;
    shortDescriptions: number;
    totalFixable: number;
  };
}> {
  const response = await admin.graphql(`
    #graphql
    query {
      products(first: 50) {
        edges {
          node {
            id
            title
            handle
            description
            productType
            vendor
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
            }
            images(first: 10) {
              edges {
                node {
                  id
                  url
                  altText
                }
              }
            }
            seo {
              title
              description
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const rawProducts =
    data.data?.products?.edges?.map(
      (e: { node: Record<string, unknown> }) => e.node
    ) ?? [];

  const products: ProductIssue[] = [];
  let missingSeoTitle = 0;
  let missingSeoDesc = 0;
  let missingAltText = 0;
  let shortDescriptions = 0;

  for (const p of rawProducts) {
    const issues: string[] = [];
    const fixes: ProductIssue["fixes"] = {};

    const price = p.priceRangeV2?.minVariantPrice?.amount ?? "";
    const currency = p.priceRangeV2?.minVariantPrice?.currencyCode ?? "USD";
    const plainDesc = (p.description || "")
      .replace(/<[^>]*>/g, "")
      .trim();

    // Check SEO Title
    if (!p.seo?.title) {
      issues.push("Missing SEO title");
      missingSeoTitle++;
      fixes.seoTitle = generateSeoTitle(p.title, shopName, p.productType);
    }

    // Check SEO Description
    if (!p.seo?.description) {
      issues.push("Missing meta description");
      missingSeoDesc++;
      fixes.seoDescription = generateMetaDescription(
        p.title,
        plainDesc,
        price,
        currency,
        shopName
      );
    }

    // Check Image Alt Text
    const imagesWithoutAlt: Array<{ id: string; url: string }> = [];
    for (const img of p.images?.edges ?? []) {
      if (!img.node.altText) {
        imagesWithoutAlt.push({ id: img.node.id, url: img.node.url });
      }
    }
    if (imagesWithoutAlt.length > 0) {
      issues.push(`${imagesWithoutAlt.length} image(s) missing alt text`);
      missingAltText += imagesWithoutAlt.length;
      fixes.altTexts = imagesWithoutAlt.map((img, i) => ({
        id: img.id,
        altText: generateAltText(p.title, p.productType, i),
      }));
    }

    // Check Description Length
    if (plainDesc.length < 100) {
      issues.push("Product description is too short for AI");
      shortDescriptions++;
    }

    if (issues.length > 0) {
      products.push({
        id: p.id,
        handle: p.handle,
        title: p.title,
        currentSeoTitle: p.seo?.title ?? null,
        currentSeoDescription: p.seo?.description ?? null,
        description: plainDesc,
        productType: p.productType || "",
        vendor: p.vendor || "",
        price,
        currency,
        imageCount: p.images?.edges?.length ?? 0,
        imagesWithoutAlt,
        issues,
        fixes,
      });
    }
  }

  // AI Upgrade: If GROQ API Key is present, batch process the fixes
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey && products.length > 0) {
    await generateGroqFixes(products, shopName, groqApiKey);
  }

  return {
    products,
    summary: {
      totalProducts: rawProducts.length,
      missingSeoTitle,
      missingSeoDesc,
      missingAltText,
      shortDescriptions,
      totalFixable: missingSeoTitle + missingSeoDesc + missingAltText,
    },
  };
}

/* ──────────────────────────────────────────────
   Apply fixes to products
   ────────────────────────────────────────────── */
export async function applyFixes(
  admin: AdminClient,
  productIds: string[],
  issues: ProductIssue[]
): Promise<{ fixed: number; errors: string[] }> {
  let fixed = 0;
  const errors: string[] = [];

  const chunkSize = 5;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    
    await Promise.all(chunk.map(async (productId) => {
      const product = issues.find((p) => p.id === productId);
      if (!product) return;

    try {
      // Fix SEO title and description
      if (product.fixes.seoTitle || product.fixes.seoDescription) {
        await admin.graphql(
          `#graphql
          mutation UpdateProductSEO($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              input: {
                id: productId,
                seo: {
                  ...(product.fixes.seoTitle && {
                    title: product.fixes.seoTitle,
                  }),
                  ...(product.fixes.seoDescription && {
                    description: product.fixes.seoDescription,
                  }),
                },
              },
            },
          }
        );
        fixed++;
      }

      // Fix image alt text
      if (product.fixes.altTexts && product.fixes.altTexts.length > 0) {
        for (const alt of product.fixes.altTexts) {
          try {
            // Use the file update mutation for images
            await admin.graphql(
              `#graphql
              mutation UpdateProductImage($productId: ID!, $image: ImageInput!) {
                productUpdateMedia(
                  productId: $productId,
                  media: [{
                    id: $image.id,
                    alt: $image.altText
                  }]
                ) {
                  media { alt }
                  mediaUserErrors { field message }
                }
              }`,
              {
                variables: {
                  productId: productId,
                  image: { id: alt.id, altText: alt.altText },
                },
              }
            );
          } catch {
            // Image update might need a different approach per API version
            // Continue with other fixes
          }
        }
      }
    } catch (err) {
      errors.push(
        `Failed to fix ${product.title}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }));
}
  return { fixed, errors };
}

/* ──────────────────────────────────────────────
   Generator Functions
   ────────────────────────────────────────────── */
function generateSeoTitle(
  productTitle: string,
  shopName: string,
  productType: string
): string {
  const parts = [productTitle];
  if (productType) parts.push(productType);
  parts.push(shopName);
  const title = parts.join(" | ");
  // SEO titles should be 50-60 chars
  return title.length > 60 ? `${productTitle} | ${shopName}` : title;
}

function generateMetaDescription(
  title: string,
  description: string,
  price: string,
  currency: string,
  shopName: string
): string {
  let meta = "";

  if (description && description.length > 30) {
    // Use first sentence of description
    const firstSentence = description.split(/[.!?]/)[0].trim();
    meta = firstSentence.length > 20 ? firstSentence + "." : "";
  }

  if (!meta) {
    meta = `Shop ${title} at ${shopName}.`;
  }

  if (price) {
    meta += ` Starting at ${currency} ${price}.`;
  }

  meta += " In stock & ready to ship.";

  // Meta descriptions should be 150-160 chars
  if (meta.length > 160) {
    meta = meta.slice(0, 157) + "...";
  }

  return meta;
}

function generateAltText(
  productTitle: string,
  productType: string,
  imageIndex: number
): string {
  if (imageIndex === 0) {
    return productType
      ? `${productTitle} - ${productType}`
      : `${productTitle} - Product Image`;
  }
  return `${productTitle} - Image ${imageIndex + 1}`;
}

async function generateGroqFixes(products: ProductIssue[], shopName: string, apiKey: string) {
  const batchSize = 10;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    
    const promptData = batch.map(p => ({
      id: p.id,
      title: p.title,
      productType: p.productType,
      description: p.description.slice(0, 400),
      needsSeoTitle: !p.currentSeoTitle && p.fixes.seoTitle,
      needsSeoDesc: !p.currentSeoDescription && p.fixes.seoDescription,
      missingAltImageCount: p.imagesWithoutAlt.length
    }));

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [{
            role: "system",
            content: `You are an expert SEO AI for a Shopify store named "${shopName}". You will receive a JSON list of products missing SEO metadata.
Return a valid JSON object with a 'fixes' array containing the exact same 'id' and the generated text.
Do NOT output markdown, backticks, or conversational text. Output ONLY raw JSON.

Format:
{
  "fixes": [
    {
      "id": "product_id",
      "seoTitle": "Generated title (max 60 chars)",
      "seoDescription": "Generated description (max 150 chars)",
      "altTexts": ["alt text 1", "alt text 2"] 
    }
  ]
}`
          }, {
            role: "user",
            content: JSON.stringify(promptData)
          }],
          temperature: 0.3,
          response_format: { type: "json_object" }
        })
      });

      if (response.ok) {
         const json = await response.json();
         const content = json.choices[0]?.message?.content;
         if (!content) continue;
         
         const parsed = JSON.parse(content);
         if (parsed && Array.isArray(parsed.fixes)) {
            for (const aiFix of parsed.fixes) {
               const p = batch.find(b => b.id === aiFix.id);
               if (p) {
                 if (aiFix.seoTitle && p.fixes.seoTitle) p.fixes.seoTitle = aiFix.seoTitle;
                 if (aiFix.seoDescription && p.fixes.seoDescription) p.fixes.seoDescription = aiFix.seoDescription;
                 if (aiFix.altTexts && p.fixes.altTexts && Array.isArray(aiFix.altTexts)) {
                    aiFix.altTexts.forEach((alt: string, idx: number) => {
                       if (p.fixes.altTexts![idx]) p.fixes.altTexts![idx].altText = alt;
                    });
                 }
               }
            }
         }
      }
    } catch (e) {
      console.error("Failed to generate AI fixes via Groq, falling back to syntactic generator.", e);
    }
  }
}
