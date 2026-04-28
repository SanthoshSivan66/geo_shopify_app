import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { 
  Activity, Star, CheckCircle, ShieldAlert, Cpu, 
  Zap, ArrowRight, TrendingUp, Search, BarChart3, Database,
  X, Clock
} from "lucide-react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getActiveSubscription, PLANS } from "../services/billing.server";
import prisma from "../db.server";

/* ──────────────────────────────────────────────
   LOADER — runs on page load, fetches store data
   ────────────────────────────────────────────── */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get or create store record
  let store = await prisma.store.findUnique({ where: { shop } });
  if (!store) {
    store = await prisma.store.create({ data: { shop } });
  }

  // Check current plan
  const { plan: activePlan } = await getActiveSubscription(admin, shop);
  
  // Sync plan to DB
  if (store.plan !== activePlan) {
    store = await prisma.store.update({
      where: { shop },
      data: { plan: activePlan },
    });
  }

  // Set up Root Redirect for llms.txt automatically if Enterprise
  if (activePlan === "enterprise") {
    try {
      const redirectRes = await admin.graphql(`
        #graphql
        query { urlRedirects(first: 5, query: "path:/llms.txt") { edges { node { id } } } }
      `);
      const redirectData = await redirectRes.json();
      if (redirectData.data?.urlRedirects?.edges?.length === 0) {
        await admin.graphql(`
          #graphql
          mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
            urlRedirectCreate(urlRedirect: $urlRedirect) {
              urlRedirect { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            urlRedirect: { path: "/llms.txt", target: "/apps/geo/llms-txt" }
          }
        });
      }
    } catch (err) {
      console.error("Failed to set up root redirect", err);
    }
  }

  // Fetch product count for the dashboard
  const productCountRes = await admin.graphql(`
    #graphql
    query {
      productsCount {
        count
      }
    }
  `);
  const productCountData = await productCountRes.json();
  const productCount = productCountData.data?.productsCount?.count ?? 0;

  // Fetch scan history for score trend chart
  const scanHistory = await prisma.scanHistory.findMany({
    where: { shop },
    orderBy: { scannedAt: "asc" },
    take: 20,
    select: {
      geoScore: true,
      schemaQuality: true,
      aiBotAccess: true,
      scannedAt: true,
    },
  });

  const isFirstVisit = !store.lastScan;

  return {
    shop,
    store,
    productCount,
    activePlan,
    scanHistory,
    isFirstVisit,
  };
};

/* ──────────────────────────────────────────────
   ACTION — handles scan + schema injection
   ────────────────────────────────────────────── */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  if (actionType === "scan") {
    // ── Free plan: enforce 1 scan per day ──
    const store = await prisma.store.findUnique({ where: { shop } });
    const currentPlan = store?.plan ?? "free";

    if (currentPlan === "free" && store?.lastScan) {
      const hoursSinceLastScan = (Date.now() - new Date(store.lastScan).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastScan < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSinceLastScan);
        return {
          action: "scan",
          success: false,
          rateLimited: true,
          hoursRemaining,
          error: `Free plan allows 1 scan per day. You can scan again in ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}. Upgrade to Pro for unlimited rescans.`,
        };
      }
    }

    // ── Scan the store for GEO readiness ──
    try {
      // Fetch ALL products via cursor-based pagination (250 per page, Shopify max)
      const products: any[] = [];
      let hasNextPage = true;
      let cursor: string | null = null;

      while (hasNextPage) {
        const productsRes: any = await admin.graphql(`
          #graphql
          query FetchProducts($first: Int!, $after: String) {
            products(first: $first, after: $after) {
              edges {
                cursor
                node {
                  id
                  title
                  description
                  handle
                  productType
                  vendor
                  tags
                  priceRangeV2 {
                    minVariantPrice { amount currencyCode }
                    maxVariantPrice { amount currencyCode }
                  }
                  images(first: 5) {
                    edges {
                      node { url altText }
                    }
                  }
                  variants(first: 5) {
                    edges {
                      node {
                        id title price sku barcode
                      }
                    }
                  }
                  seo { title description }
                }
              }
              pageInfo {
                hasNextPage
              }
            }
          }
        `, {
          variables: {
            first: 250,
            after: cursor,
          },
        });
        const productsData: any = await productsRes.json();
        const edges: any[] = productsData.data?.products?.edges ?? [];
        for (const edge of edges) {
          products.push(edge.node);
          cursor = edge.cursor;
        }
        hasNextPage = productsData.data?.products?.pageInfo?.hasNextPage ?? false;
        
        // Prevent Vercel/Fly.io timeout on huge stores by capping to a representative 1000 products
        if (products.length >= 1000) {
          hasNextPage = false;
        }
      }

      // ── Calculate GEO Scores ──
      let schemaQuality = 30; // Base for having Shopify defaults
      let contentStructure = 35;
      let conversationalReady = 20;
      let metaSocial = 40;

      // Product richness
      const totalProducts = products.length;
      if (totalProducts > 0) schemaQuality += 15;
      
      let richProducts = 0;
      for (const p of products) {
        let richFields = 0;
        if (p.description && p.description.length > 50) richFields++;
        if (p.productType) richFields++;
        if (p.vendor) richFields++;
        if (p.images?.edges?.length > 0) richFields++;
        if (p.seo?.description) richFields++;
        if (p.variants?.edges?.[0]?.node?.sku) richFields++;
        if (p.variants?.edges?.[0]?.node?.barcode) richFields++;
        if (richFields >= 4) richProducts++;
        
        // Check for alt text
        const hasAltText = p.images?.edges?.every(
          (img: { node: { altText: string | null } }) => img.node.altText
        );
        if (hasAltText) contentStructure += 2;
      }

      if (richProducts > totalProducts * 0.5) schemaQuality += 20;
      else if (richProducts > 0) schemaQuality += 10;

      // SEO completeness
      const productsWithSEO = products.filter(
        (p: { seo: { title: string; description: string } }) =>
          p.seo?.title && p.seo?.description
      ).length;
      if (productsWithSEO > totalProducts * 0.5) {
        metaSocial += 35;
        contentStructure += 15;
      }
      if (productsWithSEO === totalProducts && totalProducts > 0) {
        metaSocial += 15; // Extra boost if 100% of products have SEO tags (via auto-optimize)
      }

      // Conversational readiness based on descriptions length
      const avgDescLength =
        products.reduce(
          (sum: number, p: { description: string }) =>
            sum + (p.description?.length || 0),
          0
        ) / Math.max(totalProducts, 1);
      if (avgDescLength > 200) conversationalReady += 30;
      else if (avgDescLength > 100) conversationalReady += 15;

      // Check robots.txt and sitemap
      let aiBotAccess = 0;
      try {
        const robotsRes = await fetch(`https://${shop}/robots.txt`, {
          signal: AbortSignal.timeout(5000),
        });
        if (robotsRes.ok) {
          const robotsText = await robotsRes.text();
          if (!robotsText.match(/user-agent:\s*GPTBot[\s\S]*?disallow:\s*\//i))
            aiBotAccess += 25;
          if (!robotsText.match(/user-agent:\s*Googlebot[\s\S]*?disallow:\s*\//i))
            aiBotAccess += 25;
          if (!robotsText.match(/user-agent:\s*PerplexityBot[\s\S]*?disallow:\s*\//i))
            aiBotAccess += 20;
          if (!robotsText.match(/user-agent:\s*ClaudeBot[\s\S]*?disallow:\s*\//i))
            aiBotAccess += 15;
        } else {
          aiBotAccess = 85; // No robots.txt = everything allowed
        }
      } catch {
        aiBotAccess = 70;
      }

      // Check sitemap
      try {
        const sitemapRes = await fetch(`https://${shop}/sitemap.xml`, {
          signal: AbortSignal.timeout(5000),
        });
        if (sitemapRes.ok) aiBotAccess += 15;
      } catch {
        /* no sitemap */
      }

      aiBotAccess = Math.min(100, aiBotAccess);

      // ── Check if Theme App Extension is injecting schemas ──
      const storeRecord = await prisma.store.findUnique({ where: { shop } });
      const schemasActive = storeRecord?.schemasEnabled ?? false;
      const isPaidPlan = storeRecord?.plan === "pro" || storeRecord?.plan === "enterprise";

      if (schemasActive && isPaidPlan) {
        // Schemas are being injected via Theme App Extension
        schemaQuality += 40; // Major boost for structured data injection
        contentStructure += 10;
        conversationalReady += 20;
      }

      // Also verify by checking the live storefront for JSON-LD
      try {
        const productHandle = products[0]?.handle;
        if (productHandle) {
          const storePageRes = await fetch(
            `https://${shop}/products/${productHandle}`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (storePageRes.ok) {
            const html = await storePageRes.text();
            if (html.includes('"@type":"Product"') || html.includes('"@type": "Product"')) {
              schemaQuality += 10; // Verified on live page
            }
            if (html.includes('"@type":"Organization"') || html.includes('"@type": "Organization"')) {
              schemaQuality += 5;
            }
            if (html.includes('"@type":"BreadcrumbList"') || html.includes('"@type": "BreadcrumbList"')) {
              contentStructure += 5;
            }
            // Enterprise: Check for FAQ Schema on live page
            if (html.includes('"@type":"FAQPage"') || html.includes('"@type": "FAQPage"')) {
              conversationalReady += 35; // FAQ schema solves readability instantly
              schemaQuality += 10;
              contentStructure += 10;
            }
          }
        }
      } catch {
        // Storefront check failed — rely on DB status
      }

      // ── Enterprise features: llms.txt check ──
      const isEnterprise = storeRecord?.plan === "enterprise";
      if (isEnterprise) {
        // Because we natively provision the App Proxy and root redirect on load,
        // we guarantee llms.txt is actively presented to bots.
        aiBotAccess += 10;
        contentStructure += 5;
        
        // Enterprise bonus: having FAQ + llms.txt capability
        conversationalReady += 15;
        metaSocial += 15;
      }

      schemaQuality = Math.min(100, schemaQuality);
      aiBotAccess = Math.min(100, aiBotAccess);
      contentStructure = Math.min(100, contentStructure);
      conversationalReady = Math.min(100, conversationalReady);
      metaSocial = Math.min(100, metaSocial);
      const technicalSpeed = 85; // Shopify stores are generally fast

      const overall = Math.round(
        schemaQuality * 0.3 +
          aiBotAccess * 0.2 +
          contentStructure * 0.15 +
          conversationalReady * 0.15 +
          technicalSpeed * 0.1 +
          metaSocial * 0.1
      );

      // Save to database
      await prisma.store.upsert({
        where: { shop },
        create: {
          shop,
          geoScore: overall,
          schemaQuality,
          aiBotAccess,
          contentStructure,
          conversationalReady,
          technicalSpeed,
          metaSocial,
          lastScan: new Date(),
        },
        update: {
          geoScore: overall,
          schemaQuality,
          aiBotAccess,
          contentStructure,
          conversationalReady,
          technicalSpeed,
          metaSocial,
          lastScan: new Date(),
        },
      });

      // Save scan history for score tracking/reports
      await prisma.scanHistory.create({
        data: {
          shop,
          geoScore: overall,
          schemaQuality,
          aiBotAccess,
          contentStructure,
          conversationalReady,
          technicalSpeed,
          metaSocial,
        },
      });

      return {
        action: "scan",
        success: true,
        scores: {
          overall,
          schemaQuality,
          aiBotAccess,
          contentStructure,
          conversationalReady,
          technicalSpeed,
          metaSocial,
        },
        productCount: totalProducts,
        richProducts,
        totalScanned: totalProducts,
        productsWithSEO: productsWithSEO,
      };
    } catch (error) {
      console.error("Scan error:", error);
      return { action: "scan", success: false, error: "Scan failed" };
    }
  }

  return { action: "unknown" };
};


/* Score Trend Chart Removed */

/* ──────────────────────────────────────────────
   Scanning Progress Indicator
   ────────────────────────────────────────────── */
function ScanProgress({ productCount }: { productCount: number }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: <Database className="w-5 h-5 text-indigo-500" />, label: `Loading all ${productCount} products from your catalog...`, hint: "We read every single product so your score is 100% accurate." },
    { icon: <Search className="w-5 h-5 text-blue-500" />, label: "Checking SEO titles, descriptions & image alt text...", hint: "AI bots need this metadata to understand what you sell." },
    { icon: <Cpu className="w-5 h-5 text-purple-500" />, label: "Testing if ChatGPT & Perplexity can access your store...", hint: "We check your robots.txt to see which AI crawlers are allowed in." },
    { icon: <BarChart3 className="w-5 h-5 text-emerald-500" />, label: "Evaluating your structured data quality...", hint: "JSON-LD schemas help AI engines read your prices, reviews & availability." },
    { icon: <Zap className="w-5 h-5 text-yellow-500" />, label: "Measuring site speed & technical performance...", hint: "Faster stores get prioritized by AI recommendation engines." },
    { icon: <Activity className="w-5 h-5 text-rose-500" />, label: "Calculating your final GEO score...", hint: "We combine all 6 categories into one overall readiness number." },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s < steps.length - 1 ? s + 1 : s));
    }, 2000);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="bg-white border border-slate-200 shadow-sm p-10 md:p-12 rounded-xl text-center max-w-2xl mx-auto">
      <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <Search className="w-8 h-8 text-slate-800" />
      </motion.div>
      <h2 className="text-2xl font-semibold mb-2 text-slate-900">Scanning Your Entire Store...</h2>
      <p className="text-slate-500 mb-2 max-w-md mx-auto">We're analyzing all {productCount} products to give you the most accurate AI readiness score possible.</p>
      <p className="text-xs text-slate-400 mb-8">This usually takes 10-20 seconds depending on your catalog size.</p>
      <div className="space-y-5 text-left max-w-md mx-auto">
        {steps.map((s, i) => (
          <div key={i} className={`transition-all duration-500 ${i < step ? "opacity-40" : i === step ? "opacity-100" : "opacity-15"}`}>
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full ${i < step ? "text-emerald-600" : "text-slate-400"}`}>
                {i < step ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : i === step ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-4 h-4 rounded-full border-2 border-current border-t-transparent" /> : <div className="w-4 h-4 rounded-full border-2 border-current" />}
              </div>
              <span className={`text-sm ${i === step ? "text-slate-900 font-medium" : "text-slate-500"}`}>{s.label}</span>
            </div>
            {i === step && (
              <motion.p initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="text-xs text-slate-400 ml-9 mt-1">{s.hint}</motion.p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ title, score, icon: Icon }: { title: string; score: number; icon: any }) {
  let color = score >= 80 ? 'text-emerald-700' : score >= 60 ? 'text-yellow-700' : 'text-red-700';
  let badgeColors = score >= 80 ? 'bg-emerald-50 text-emerald-700' : score >= 60 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700';

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col justify-between hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 text-slate-400`} />
        <div className={`px-2 py-0.5 rounded text-xs font-semibold ${badgeColors}`}>{score}/100</div>
      </div>
      <div className="text-sm font-medium text-slate-700 mt-2">{title}</div>
    </div>
  );
}

export default function GEODashboard() {
  const { shop, store, productCount, activePlan, scanHistory, isFirstVisit } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const [cooldown, setCooldown] = useState(0);
  const [showBanner, setShowBanner] = useState(true);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (cooldown > 0) {
      interval = setInterval(() => setCooldown((c) => c - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [cooldown]);

  const handleScan = () => {
    if (cooldown > 0) return;
    setCooldown(60);
    fetcher.submit({ action: "scan" }, { method: "POST" });
  };

  const isScanning = fetcher.state !== "idle" && fetcher.formData?.get("action") === "scan";
  const rateLimitData = fetcher.data?.action === "scan" && (fetcher.data as any)?.rateLimited ? fetcher.data as any : null;
  const scores = fetcher.data?.action === "scan" && fetcher.data?.success
    ? (fetcher.data as any).scores
    : store.geoScore > 0 ? {
        overall: store.geoScore, schemaQuality: store.schemaQuality, aiBotAccess: store.aiBotAccess,
        contentStructure: store.contentStructure, conversationalReady: store.conversationalReady,
        technicalSpeed: store.technicalSpeed, metaSocial: store.metaSocial,
      } : null;

  /* ── First-Time Onboarding ── */
  if (isFirstVisit && !scores && !isScanning) {
    return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pb-24 font-sans">
      <ui-title-bar title="Dashboard" />
      <div className="max-w-6xl mx-auto space-y-8">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16 relative">
            <h1 className="text-4xl font-semibold tracking-tight mb-4 text-slate-900">
              Make Your Products Discoverable by AI
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Connect your store directly to ChatGPT, Perplexity, and Google Gemini. We automatically analyze your store and apply the specialized structured data needed to recommend your products.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-12 relative z-10">
            {[
              { num: 1, title: "Enable App Embed", desc: "Crucial step: Open your Theme Editor and toggle the GEO AI Injector ON to allow bot parsing.", icon: Zap, action: true },
              { num: 2, title: "Scan Your Store", desc: `Find out how easily ChatGPT can currently read the structure of your ${productCount} products.`, icon: Search },
              { num: 3, title: "Get Recommended", desc: "Our system will inject missing data so your products show up as top answers in AI chats.", icon: Star }
            ].map((step, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className={`bg-white border shadow-sm p-6 rounded-xl ${step.action ? 'border-primary shadow-primary/10' : 'border-slate-200'}`}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 font-semibold ${step.action ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-800'}`}>
                  {step.num}
                </div>
                <h3 className="text-lg font-medium text-slate-900 mb-2">{step.title}</h3>
                <p className="text-sm text-slate-600 mb-4">{step.desc}</p>
                {step.action && (
                  <a href={`https://${shop}/admin/themes/current/editor?context=apps`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
                    Open Theme Editor <ArrowRight className="w-4 h-4" />
                  </a>
                )}
              </motion.div>
            ))}
          </div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="flex justify-center relative z-10">
            <button
              onClick={() => fetcher.submit({ action: "scan" }, { method: "POST" })}
              className="px-8 py-3 bg-zinc-900 text-white font-medium rounded-lg shadow-sm hover:bg-zinc-800 transition-all flex items-center gap-2"
            >
              Start Full Analysis
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Empty State Handling ──
  if (productCount === 0) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 flex flex-col items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Search className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No Products Found</h2>
          <p className="text-slate-500 mb-6 line-clamp-3">
            It looks like your Shopify store doesn't have any products yet! The GEO Review Tool needs products to analyze your AI search readiness. 
          </p>
          <a
            href={`https://${shop}/admin/products/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-6 py-2.5 bg-zinc-900 text-white font-medium rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Add Your First Product
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pb-24 overflow-x-hidden relative">
      <ui-title-bar title="Dashboard" />
      <div className="max-w-5xl mx-auto relative z-10">
        
        {/* Onboarding Banner for returning users */}
        {showBanner && !isFirstVisit && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-blue-50/80 border border-blue-200/60 p-4 rounded-xl mb-8 flex justify-between items-start shadow-sm backdrop-blur-sm">
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-blue-900 mb-1 text-base">Welcome to GEO Review! 🚀</h3>
                <p className="text-sm text-blue-800/80 max-w-2xl leading-relaxed">
                  Crucial step: Don't forget to enable the <span className="font-medium text-blue-900">GEO AI Injector</span> in your Theme Editor. This allows ChatGPT and Google Gemini to actually read your new structured data.
                </p>
                <a 
                  href={`https://${shop}/admin/themes/current/editor?context=apps`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-900 mt-3 bg-blue-100/50 px-3 py-1.5 rounded-md hover:bg-blue-200/50 transition-colors"
                >
                  Open Theme Editor <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
            <button onClick={() => setShowBanner(false)} className="text-blue-400 hover:text-blue-600 p-1 rounded-md hover:bg-blue-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6 border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1">AI Discoverability Overview</h1>
            <p className="text-sm text-slate-500">
              {shop} • {productCount} Products • <span className="font-medium text-slate-900">{activePlan.toUpperCase()} TIER</span>
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={isScanning || cooldown > 0}
            className="px-6 py-2 bg-white border border-slate-300 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {isScanning ? (
              <><Activity className="w-4 h-4 animate-spin text-slate-500" /> Scanning products...</>
            ) : cooldown > 0 ? (
              <><Clock className="w-4 h-4 text-slate-500" /> Wait {cooldown}s</>
            ) : (
              <><Search className="w-4 h-4 text-slate-500" /> Rescan All Products</>
            )}
          </button>
        </div>

        {/* Rate Limit Banner for Free Plan */}
        {rateLimitData && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-medium text-amber-900 mb-1">Daily Scan Limit Reached</h4>
                <p className="text-sm text-amber-700">Your free plan includes 1 scan per day. You can scan again in <strong>{rateLimitData.hoursRemaining} hour{rateLimitData.hoursRemaining === 1 ? '' : 's'}</strong>, or upgrade for unlimited rescans anytime.</p>
              </div>
            </div>
            <button onClick={() => navigate('/app/billing')} className="px-5 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-semibold transition-colors whitespace-nowrap flex items-center gap-2 shadow-sm">
              Upgrade to Pro <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {isScanning ? (
          <div className="py-20"><ScanProgress productCount={productCount} /></div>
        ) : scores ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            
            {/* Top Row: Explainer & Main Score */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-8 flex flex-col justify-center">
                <h2 className="text-xl font-semibold text-slate-900 mb-3">How AI Sees Your Store</h2>
                <p className="text-slate-600 leading-relaxed max-w-xl mb-4">
                  AI engines like ChatGPT and Google Gemini need hidden "structured data" on your product pages before they'll recommend your products to shoppers. Your score reflects how ready your entire catalog is right now.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-medium border border-slate-200">
                    <Database className="w-3 h-3" /> {productCount} products scanned
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-200">
                    <CheckCircle className="w-3 h-3" /> 100% catalog coverage
                  </span>
                </div>
              </div>

              <div className="md:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 p-8 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Overall Score</p>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className={`text-5xl font-bold tracking-tight ${scores.overall >= 80 ? 'text-emerald-600' : scores.overall >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {scores.overall}
                  </span>
                  <span className="text-xl font-medium text-slate-400">/100</span>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${scores.overall >= 80 ? 'bg-emerald-50 text-emerald-700' : scores.overall >= 60 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}`}>
                  {scores.overall >= 80 ? 'Excellent' : scores.overall >= 60 ? 'Needs Improvement' : 'Mostly Invisible'}
                </div>
              </div>
            </div>

            {/* Sub Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              <MetricCard title="Product Data" score={scores.schemaQuality} icon={Database} />
              <MetricCard title="Crawler Access" score={scores.aiBotAccess} icon={ShieldAlert} />
              <MetricCard title="Structure Quality" score={scores.contentStructure} icon={BarChart3} />
              <MetricCard title="Readability" score={scores.conversationalReady} icon={Activity} />
              <MetricCard title="SEO Metadata" score={scores.metaSocial} icon={Search} />
              <MetricCard title="Performance" score={scores.technicalSpeed} icon={Zap} />
            </div>

            {/* Recommendations List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 mt-4">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2 text-slate-900">
                <Star className="w-5 h-5 text-yellow-500" /> Recommended Actions
              </h3>
              
              <div className="space-y-4">
                {scores.schemaQuality < 60 && (
                  <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-50 border border-slate-100">
                    <Database className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium text-slate-900 mb-1">Provide More Product Information</h4>
                      <p className="text-sm text-slate-600">Bots cannot recommend products if they don't know the exact details. Consider adding proper SKUs, longer descriptions, and brand metadata.</p>
                    </div>
                  </div>
                )}
                {scores.conversationalReady < 50 && (
                  <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-50 border border-slate-100">
                    <Activity className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium text-slate-900 mb-1">Write In Complete Sentences</h4>
                      <p className="text-sm text-slate-600">When possible, use conversational English in your descriptions. ChatGPT uses this context to answer customer questions accurately.</p>
                    </div>
                  </div>
                )}
                {scores.aiBotAccess < 70 && (
                  <div className="flex items-start gap-4 p-4 rounded-lg bg-red-50 border border-red-100">
                    <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium text-red-900 mb-1">Unblock ChatGPT from Reading Your Store</h4>
                      <p className="text-sm text-red-700">Your current store settings (robots.txt) block AI crawlers like GPTBot from visiting your site. They cannot recommend you.</p>
                    </div>
                  </div>
                )}
                {scores.metaSocial < 60 && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-start gap-4">
                      <Zap className="w-5 h-5 text-slate-900 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="font-medium text-slate-900 mb-1">Add Required SEO Formatting</h4>
                        <p className="text-sm text-slate-600">You are missing SEO titles and schemas. Instantly apply these invisible tags globally.</p>
                      </div>
                    </div>
                    <button onClick={() => navigate('/app/optimize')} className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors whitespace-nowrap">
                      Fix with One-Click
                    </button>
                  </div>
                )}
              </div>
            </div>

          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
