/* ──────────────────────────────────────────────
   Schema Generator Service
   
   Generates JSON-LD structured data for Shopify
   products, organization, breadcrumbs, and FAQs.
   ────────────────────────────────────────────── */

interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  };
  images: {
    edges: Array<{ node: { url: string; altText: string | null } }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        sku: string;
        barcode: string;
        availableForSale?: boolean;
      };
    }>;
  };
  seo: { title: string | null; description: string | null };
}

interface ShopInfo {
  name: string;
  url: string;
  description?: string;
  email?: string;
  currencyCode?: string;
}

/* ──────────────────────────────────────────────
   Product Schema (JSON-LD)
   ────────────────────────────────────────────── */
export function generateProductSchema(
  product: ShopifyProduct,
  shop: ShopInfo
): object {
  const mainImage = product.images?.edges?.[0]?.node?.url;
  const images = product.images?.edges?.map((e) => e.node.url) ?? [];
  const variant = product.variants?.edges?.[0]?.node;
  const minPrice = product.priceRangeV2?.minVariantPrice?.amount;
  const maxPrice = product.priceRangeV2?.maxVariantPrice?.amount;
  const currency =
    product.priceRangeV2?.minVariantPrice?.currencyCode || "USD";

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description?.replace(/<[^>]*>/g, "").slice(0, 500),
    url: `${shop.url}/products/${product.handle}`,
    brand: {
      "@type": "Brand",
      name: product.vendor || shop.name,
    },
  };

  if (mainImage) schema.image = images.length > 1 ? images : mainImage;
  if (variant?.sku) schema.sku = variant.sku;
  if (variant?.barcode) schema.gtin = variant.barcode;
  if (product.productType) schema.category = product.productType;

  // Offers
  if (minPrice) {
    if (minPrice === maxPrice || !maxPrice) {
      schema.offers = {
        "@type": "Offer",
        price: minPrice,
        priceCurrency: currency,
        availability: "https://schema.org/InStock",
        url: `${shop.url}/products/${product.handle}`,
        seller: {
          "@type": "Organization",
          name: shop.name,
        },
      };
    } else {
      schema.offers = {
        "@type": "AggregateOffer",
        lowPrice: minPrice,
        highPrice: maxPrice,
        priceCurrency: currency,
        offerCount: product.variants?.edges?.length || 1,
        availability: "https://schema.org/InStock",
      };
    }
  }

  return schema;
}

/* ──────────────────────────────────────────────
   Organization Schema
   ────────────────────────────────────────────── */
export function generateOrganizationSchema(shop: ShopInfo): object {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: shop.name,
    url: shop.url,
    ...(shop.description && { description: shop.description }),
    ...(shop.email && { email: shop.email }),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      url: `${shop.url}/pages/contact`,
    },
    sameAs: [],
  };
}

/* ──────────────────────────────────────────────
   BreadcrumbList Schema
   ────────────────────────────────────────────── */
export function generateBreadcrumbSchema(
  shop: ShopInfo,
  product?: ShopifyProduct
): object {
  const items: Array<{ position: number; name: string; item: string }> = [
    { position: 1, name: "Home", item: shop.url },
  ];

  if (product) {
    if (product.productType) {
      items.push({
        position: 2,
        name: product.productType,
        item: `${shop.url}/collections/${product.productType.toLowerCase().replace(/\s+/g, "-")}`,
      });
      items.push({
        position: 3,
        name: product.title,
        item: `${shop.url}/products/${product.handle}`,
      });
    } else {
      items.push({
        position: 2,
        name: "Products",
        item: `${shop.url}/collections/all`,
      });
      items.push({
        position: 3,
        name: product.title,
        item: `${shop.url}/products/${product.handle}`,
      });
    }
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item) => ({
      "@type": "ListItem",
      position: item.position,
      name: item.name,
      item: item.item,
    })),
  };
}

/* ──────────────────────────────────────────────
   FAQ Schema (Enterprise only)
   Generates FAQs from product descriptions
   ────────────────────────────────────────────── */
export function generateFAQSchema(
  product: ShopifyProduct,
  shop: ShopInfo
): object | null {
  const desc = product.description?.replace(/<[^>]*>/g, "") ?? "";
  if (desc.length < 50) return null;

  // Generate common Q&A pairs from product data
  const faqs: Array<{ question: string; answer: string }> = [];

  if (product.description) {
    faqs.push({
      question: `What is ${product.title}?`,
      answer: desc.slice(0, 300),
    });
  }

  if (
    product.priceRangeV2?.minVariantPrice?.amount
  ) {
    const price = product.priceRangeV2.minVariantPrice.amount;
    const currency = product.priceRangeV2.minVariantPrice.currencyCode;
    faqs.push({
      question: `How much does ${product.title} cost?`,
      answer: `${product.title} is priced at ${currency} ${price}${
        product.variants?.edges?.length > 1
          ? `. We offer ${product.variants.edges.length} variants with different pricing options.`
          : "."
      }`,
    });
  }

  if (product.variants?.edges?.length > 1) {
    const variantNames = product.variants.edges
      .map((e) => e.node.title)
      .filter((t) => t !== "Default Title")
      .join(", ");
    if (variantNames) {
      faqs.push({
        question: `What options are available for ${product.title}?`,
        answer: `${product.title} comes in the following options: ${variantNames}.`,
      });
    }
  }

  faqs.push({
    question: `Where can I buy ${product.title}?`,
    answer: `You can purchase ${product.title} directly from ${shop.name} at ${shop.url}/products/${product.handle}`,
  });

  if (faqs.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/* ──────────────────────────────────────────────
   llms.txt Generator (Enterprise only)
   ────────────────────────────────────────────── */
export function generateLlmsTxt(
  shop: ShopInfo,
  products: ShopifyProduct[]
): string {
  const lines: string[] = [];

  lines.push(`# ${shop.name}`);
  lines.push("");

  if (shop.description) {
    lines.push(`> ${shop.description}`);
    lines.push("");
  }

  lines.push("## Store Information");
  lines.push(`- Website: ${shop.url}`);
  if (shop.email) lines.push(`- Contact: ${shop.email}`);
  lines.push("");

  lines.push("## Products");
  for (const product of products.slice(0, 50)) {
    const price = product.priceRangeV2?.minVariantPrice;
    const priceStr = price ? ` - ${price.currencyCode} ${price.amount}` : "";
    lines.push(
      `- [${product.title}](${shop.url}/products/${product.handle})${priceStr}`
    );
    if (product.description) {
      const shortDesc = product.description
        .replace(/<[^>]*>/g, "")
        .slice(0, 100);
      lines.push(`  ${shortDesc}`);
    }
  }
  lines.push("");

  // Collect product types as categories
  const categories = [
    ...new Set(products.map((p) => p.productType).filter(Boolean)),
  ];
  if (categories.length > 0) {
    lines.push("## Categories");
    for (const cat of categories) {
      lines.push(
        `- [${cat}](${shop.url}/collections/${cat.toLowerCase().replace(/\s+/g, "-")})`
      );
    }
    lines.push("");
  }

  lines.push("## Policies");
  lines.push(`- [Shipping Policy](${shop.url}/policies/shipping-policy)`);
  lines.push(`- [Refund Policy](${shop.url}/policies/refund-policy)`);
  lines.push(`- [Privacy Policy](${shop.url}/policies/privacy-policy)`);
  lines.push(`- [Terms of Service](${shop.url}/policies/terms-of-service)`);

  return lines.join("\n");
}

/* ──────────────────────────────────────────────
   Generate all schemas for a store
   ────────────────────────────────────────────── */
export function generateAllSchemas(
  products: ShopifyProduct[],
  shop: ShopInfo,
  plan: "free" | "pro" | "enterprise"
): {
  productSchemas: object[];
  organizationSchema: object | null;
  breadcrumbSchemas: object[];
  faqSchemas: object[];
  llmsTxt: string | null;
} {
  if (plan === "free") {
    return {
      productSchemas: [],
      organizationSchema: null,
      breadcrumbSchemas: [],
      faqSchemas: [],
      llmsTxt: null,
    };
  }

  // Pro + Enterprise: Product, Org, Breadcrumb schemas
  const productSchemas = products.map((p) =>
    generateProductSchema(p, shop)
  );
  const organizationSchema = generateOrganizationSchema(shop);
  const breadcrumbSchemas = products.map((p) =>
    generateBreadcrumbSchema(shop, p)
  );

  // Enterprise only: FAQ + llms.txt
  const faqSchemas =
    plan === "enterprise"
      ? products
          .map((p) => generateFAQSchema(p, shop))
          .filter((s): s is object => s !== null)
      : [];

  const llmsTxt =
    plan === "enterprise" ? generateLlmsTxt(shop, products) : null;

  return {
    productSchemas,
    organizationSchema,
    breadcrumbSchemas,
    faqSchemas,
    llmsTxt,
  };
}
