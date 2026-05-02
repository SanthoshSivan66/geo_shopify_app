import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getActiveSubscription } from "../services/billing.server";
import {
  generateAllSchemas,
  generateProductSchema,
} from "../services/schema-generator.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan } = await getActiveSubscription(admin, shop);

  // Get store data
  const store = await prisma.store.findUnique({ where: { shop } });

  // Fetch products
  const productsRes = await admin.graphql(`
    #graphql
    query {
      products(first: 250) {
        edges {
          node {
            id title description handle productType vendor tags
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
            images(first: 5) { edges { node { url altText } } }
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
      shop {
        name
        url
        description
        email
        currencyCode
      }
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

  // Generate schemas based on plan
  const schemas = generateAllSchemas(products, shopInfo, plan);

  // Build a preview for one product
  let sampleSchema = null;
  if (products.length > 0 && plan !== "free") {
    sampleSchema = generateProductSchema(products[0], shopInfo);
  }

  return {
    shop,
    plan,
    store,
    productCount: products.length,
    schemas: {
      productCount: schemas.productSchemas.length,
      hasOrganization: !!schemas.organizationSchema,
      breadcrumbCount: schemas.breadcrumbSchemas.length,
      faqCount: schemas.faqSchemas.length,
      hasLlmsTxt: !!schemas.llmsTxt,
    },
    sampleSchema,
    schemasEnabled: store?.schemasEnabled ?? false,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  if (actionType === "toggle-schemas") {
    const enabled = formData.get("enabled") === "true";
    await prisma.store.update({
      where: { shop },
      data: { schemasEnabled: enabled },
    });
    return { action: "toggle-schemas", enabled };
  }

  return { action: "unknown" };
};

import { motion } from "framer-motion";
import { 
  Lock, ArrowRight, Code, Database, Building2, 
  Navigation, MessageSquare, FileText, CheckCircle2, PauseCircle,
  Settings, Activity
} from "lucide-react";

export default function SchemasPage() {
  const { plan, productCount, schemas, sampleSchema, schemasEnabled, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isPending = fetcher.state !== "idle";
  const currentEnabled = fetcher.data?.action === "toggle-schemas" ? Boolean(fetcher.data.enabled) : schemasEnabled;

  if (fetcher.data?.action === "toggle-schemas" && fetcher.state === "idle") {
    shopify.toast.show(fetcher.data.enabled ? "Schema injection enabled!" : "Schema injection paused");
  }

  if (plan === "free") {
    return (
      <div className="min-h-screen bg-background text-gray-100 p-8 pb-20 overflow-x-hidden relative flex flex-col justify-center items-center text-center">
        <ui-title-bar title="Schemas" />
        <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="glass-panel p-12 rounded-3xl max-w-3xl relative z-10 neon-border">
          <div className="w-20 h-20 bg-primary/10 border border-primary/30 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Lock className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl font-extrabold mb-4">Unlock Schema Injection</h1>
          <p className="text-lg text-gray-400 mb-10 leading-relaxed">
            Auto-generate rich JSON-LD schemas for your products so AI assistants like ChatGPT and Perplexity can discover and recommend your store. Upgrade to Pro for just $7.99/mo.
          </p>

          <div className="grid md:grid-cols-3 gap-6 mb-10 text-left border-t border-white/10 pt-10">
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-2"><Database className="w-4 h-4 text-primary" /> Product Schema</h3>
              <p className="text-sm text-gray-500">Rich product data that AI bots can read instantly: price, SKU, images.</p>
            </div>
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-primary" /> Org Schema</h3>
              <p className="text-sm text-gray-500">Your brand identity and contact logic.</p>
            </div>
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-2"><Navigation className="w-4 h-4 text-primary" /> Breadcrumbs</h3>
              <p className="text-sm text-gray-500">Clear navigation structure for bots and AI crawlers.</p>
            </div>
          </div>

          <Link to="/app/billing" className="inline-flex items-center gap-3 px-8 py-4 bg-primary hover:bg-blue-600 text-white font-semibold rounded-full shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-transform hover:-translate-y-1">
            View Plans <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pb-24 overflow-x-hidden w-full relative">
      <ui-title-bar title="Schemas" />
      <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-3 gap-10 w-full overflow-hidden">
        
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-2xl font-bold mb-1 flex items-center gap-2 text-slate-900">
                <Code className="w-6 h-6 text-slate-700" /> Schema Injection
              </h1>
              <p className="text-sm text-slate-500">Manage JSON-LD structured data for AI bot discoverability.</p>
            </div>
            
            <button
              onClick={() => fetcher.submit({ action: "toggle-schemas", enabled: String(!currentEnabled) }, { method: "POST" })}
              disabled={isPending}
              className={`px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm shadow-sm ${currentEnabled ? 'bg-white border text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
            >
              {isPending ? <Activity className="w-4 h-4 animate-spin text-slate-400" /> : currentEnabled ? <PauseCircle className="w-5 h-5 text-slate-500" /> : <CheckCircle2 className="w-5 h-5 text-white" />}
              {isPending ? "Updating..." : currentEnabled ? "Pause Schemas" : "Enable Schemas"}
            </button>
          </div>

          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 border-b border-slate-100 pb-4 text-slate-900">
               Active Structured Data Elements
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-lg border border-slate-200"><Database className="w-5 h-5 text-emerald-600" /></div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Product Schema (JSON-LD)</h3>
                    <p className="text-sm text-slate-500">Covers {productCount} products with price, images, SKU, and availability data</p>
                  </div>
                </div>
                {currentEnabled ? <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium border border-emerald-200">{schemas.productCount} active</span> : <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">Paused</span>}
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-lg border border-slate-200"><Building2 className="w-5 h-5 text-blue-600" /></div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Organization Schema</h3>
                    <p className="text-sm text-slate-500">Brand identity, contact info, and business details</p>
                  </div>
                </div>
                {currentEnabled ? <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium border border-emerald-200">Active</span> : <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">Paused</span>}
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-lg border border-slate-200"><Navigation className="w-5 h-5 text-indigo-600" /></div>
                  <div>
                    <h3 className="font-semibold text-slate-900">BreadcrumbList Schema</h3>
                    <p className="text-sm text-slate-500">Navigation structure for all product pages</p>
                  </div>
                </div>
                {currentEnabled ? <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium border border-emerald-200">{schemas.breadcrumbCount} active</span> : <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">Paused</span>}
              </div>

              {plan === "enterprise" && (
                <>
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white rounded-lg border border-slate-200"><MessageSquare className="w-5 h-5 text-purple-600" /></div>
                      <div>
                        <h3 className="font-semibold text-slate-900">FAQ Schema</h3>
                        <p className="text-sm text-slate-500">Auto-generated Q&A from your product descriptions</p>
                      </div>
                    </div>
                    {currentEnabled ? <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium border border-emerald-200">{schemas.faqCount} active</span> : <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">Paused</span>}
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white rounded-lg border border-slate-200"><FileText className="w-5 h-5 text-pink-600" /></div>
                      <div>
                        <h3 className="font-semibold text-slate-900">llms.txt Configuration</h3>
                        <p className="text-sm text-slate-500">AI bot instruction protocol file</p>
                      </div>
                    </div>
                    {currentEnabled && schemas.hasLlmsTxt ? <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium border border-emerald-200">Generated</span> : <span className="px-3 py-1 bg-yellow-50 text-yellow-700 text-xs rounded-full font-medium border border-yellow-200">Pending Setup</span>}
                  </div>
                </>
              )}
            </div>
          </div>

          {sampleSchema && (
            <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-4">
                 <Code className="w-5 h-5 text-slate-500" /> Schema Preview (Sample Snippet)
              </h2>
              <div className="bg-[#1e1e1e] rounded-lg overflow-hidden border border-[#333]">
                <div className="p-2 border-b border-[#333] flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                </div>
                <pre className="p-4 text-xs font-mono text-[#4ec9b0] overflow-auto max-h-96">
                  {JSON.stringify(sampleSchema, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
            <h3 className="font-semibold text-slate-500 mb-4 uppercase tracking-wide text-xs flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" /> Active Plan
            </h3>
            <div className="flex items-center gap-3 mb-2">
               <span className={`px-3 py-1 rounded-full text-sm font-medium ${plan === 'enterprise' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-800 border border-slate-200'}`}>
                 {plan === 'enterprise' ? '🚀 Enterprise' : '⚡ Pro'}
               </span>
            </div>
            <p className="text-sm text-slate-500 mt-4 leading-relaxed">
              Schema injection adds invisible JSON-LD structured data to your store pages. This data tells AI bots exactly what your products are, how much they cost, and where to buy them.
            </p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-blue-200 shadow-sm bg-blue-50/30">
            <h2 className="text-base font-bold mb-4 flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-3">
               <Settings className="w-5 h-5 text-blue-600" /> Theme Setup Guide
            </h2>
            <div className="space-y-4 text-slate-600">
              <p className="text-sm">
                To inject schemas seamlessly without impacting load speed, you must enable the App Embed in your active theme.
              </p>
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                <ol className="list-decimal list-inside space-y-3 text-sm font-medium text-slate-700">
                  <li>Store Admin {">"} <strong className="text-slate-900">Themes</strong>.</li>
                  <li>Click <strong className="text-slate-900">Customize</strong> on your theme.</li>
                  <li>On the left sidebar, click the third icon for <strong className="text-slate-900">App Embeds</strong>.</li>
                  <li>Find <strong className="text-blue-600">GEO AI Injector</strong> and toggle it <strong className="text-emerald-600">ON</strong>.</li>
                  <li>Click <strong className="text-slate-900">Save</strong>.</li>
                </ol>
                <div className="mt-5 pt-5 border-t border-slate-100">
                  <a
                    href={`https://${shop}/admin/themes/current/editor?context=apps`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-colors"
                  >
                    <Navigation className="w-4 h-4" /> Open Theme Editor
                  </a>
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Once enabled, JSON-LD is instantly rendered readable exclusively by AI crawlers.
              </p>
            </div>
          </div>

          {plan === "pro" && (
            <div className="bg-zinc-900 p-6 rounded-xl shadow-sm text-white relative overflow-hidden">
              <h3 className="font-semibold mb-2">Upgrade to Enterprise</h3>
              <p className="text-sm text-zinc-400 mb-4">
                Get FAQ schemas, llms.txt, AI bot access monitoring, and competitor comparison for just $19.99/mo.
              </p>
              <Link to="/app/billing" className="block w-full text-center px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors border border-white/10">
                View Plans
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
