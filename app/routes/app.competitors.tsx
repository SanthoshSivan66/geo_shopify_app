import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Activity, ArrowRight, TrendingUp, Search, Lock, 
  ShieldAlert, Globe, Database, Trash2 
} from "lucide-react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getActiveSubscription } from "../services/billing.server";
import prisma from "../db.server";

/* ──────────────────────────────────────────────
   Competitor Scanner — fetches a Shopify store's
   public page and checks for GEO signals
   ────────────────────────────────────────────── */
async function scanCompetitor(url: string) {
  // Normalize URL
  let storeUrl = url.trim();
  if (!storeUrl.startsWith("http")) storeUrl = `https://${storeUrl}`;
  storeUrl = storeUrl.replace(/\/$/, "");

  const results = {
    url: storeUrl,
    name: "",
    geoScore: 0,
    schemaQuality: 0,
    aiBotAccess: 0,
    contentStructure: 0,
    hasProductSchema: false,
    hasOrgSchema: false,
    hasBreadcrumb: false,
    hasFaqSchema: false,
    hasLlmsTxt: false,
    error: null as string | null,
  };

  try {
    // Fetch homepage
    const homeRes = await fetch(storeUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GEOReviewBot/1.0; +https://geo-review-tool.vercel.app)",
      },
    });

    if (!homeRes.ok) {
      results.error = `Store returned ${homeRes.status}`;
      return results;
    }

    const html = await homeRes.text();

    // Extract store name from <title>
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      results.name = titleMatch[1]
        .replace(/\s*[-–|].*$/, "")
        .trim()
        .slice(0, 50);
    }

    // Check for schemas
    if (
      html.includes('"@type":"Product"') ||
      html.includes('"@type": "Product"')
    ) {
      results.hasProductSchema = true;
      results.schemaQuality += 35;
    }
    if (
      html.includes('"@type":"Organization"') ||
      html.includes('"@type": "Organization"')
    ) {
      results.hasOrgSchema = true;
      results.schemaQuality += 20;
    }
    if (
      html.includes('"@type":"BreadcrumbList"') ||
      html.includes('"@type": "BreadcrumbList"')
    ) {
      results.hasBreadcrumb = true;
      results.schemaQuality += 15;
    }
    if (
      html.includes('"@type":"FAQPage"') ||
      html.includes('"@type": "FAQPage"')
    ) {
      results.hasFaqSchema = true;
      results.schemaQuality += 15;
    }

    // Check meta tags
    const hasMetaDesc = html.includes('name="description"');
    const hasOgTags = html.includes('property="og:');
    if (hasMetaDesc) results.contentStructure += 30;
    if (hasOgTags) results.contentStructure += 20;

    // Base content score for having a working site
    results.contentStructure += 20;
    results.schemaQuality += 15; // Base Shopify defaults
  } catch (err) {
    results.error =
      err instanceof Error ? err.message : "Failed to reach store";
    return results;
  }

  // Check robots.txt
  try {
    const robotsRes = await fetch(`${storeUrl}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const robotsText = await robotsRes.text();
      if (!robotsText.match(/user-agent:\s*GPTBot[\s\S]*?disallow:\s*\//i))
        results.aiBotAccess += 30;
      if (
        !robotsText.match(/user-agent:\s*Googlebot[\s\S]*?disallow:\s*\//i)
      )
        results.aiBotAccess += 25;
      if (
        !robotsText.match(
          /user-agent:\s*PerplexityBot[\s\S]*?disallow:\s*\//i
        )
      )
        results.aiBotAccess += 25;
    } else {
      results.aiBotAccess = 80;
    }
  } catch {
    results.aiBotAccess = 70;
  }

  // Check llms.txt
  try {
    const llmsRes = await fetch(`${storeUrl}/llms.txt`, {
      signal: AbortSignal.timeout(3000),
    });
    if (llmsRes.ok) {
      const text = await llmsRes.text();
      if (text.length > 50 && !text.includes("<html")) {
        results.hasLlmsTxt = true;
        results.schemaQuality += 15;
      }
    }
  } catch {
    /* no llms.txt */
  }

  // Check sitemap
  try {
    const sitemapRes = await fetch(`${storeUrl}/sitemap.xml`, {
      signal: AbortSignal.timeout(3000),
    });
    if (sitemapRes.ok) results.aiBotAccess += 20;
  } catch {
    /* no sitemap */
  }

  // Cap and calculate overall
  results.schemaQuality = Math.min(100, results.schemaQuality);
  results.aiBotAccess = Math.min(100, results.aiBotAccess);
  results.contentStructure = Math.min(100, results.contentStructure);

  results.geoScore = Math.round(
    results.schemaQuality * 0.4 +
      results.aiBotAccess * 0.3 +
      results.contentStructure * 0.3
  );

  return results;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const { plan } = await getActiveSubscription(admin, shop);

  // Get store's own score
  const store = await prisma.store.findUnique({ where: { shop } });

  // Get past competitor scans
  const competitors = await prisma.competitorScan.findMany({
    where: { shop },
    orderBy: { scannedAt: "desc" },
    take: 10,
  });

  return {
    shop,
    plan,
    myScore: store?.geoScore ?? 0,
    myPlan: store?.plan ?? "free",
    competitors,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  if (actionType === "scan-competitor") {
    const competitorUrl = formData.get("url") as string;
    if (!competitorUrl) {
      return { action: "scan-competitor", error: "Please enter a store URL" };
    }

    const result = await scanCompetitor(competitorUrl);

    if (result.error) {
      return { action: "scan-competitor", error: result.error };
    }

    // Save to database
    await prisma.competitorScan.create({
      data: {
        shop,
        competitorUrl: result.url,
        competitorName: result.name,
        geoScore: result.geoScore,
        schemaQuality: result.schemaQuality,
        aiBotAccess: result.aiBotAccess,
        contentStructure: result.contentStructure,
        hasProductSchema: result.hasProductSchema,
        hasOrgSchema: result.hasOrgSchema,
        hasBreadcrumb: result.hasBreadcrumb,
        hasFaqSchema: result.hasFaqSchema,
        hasLlmsTxt: result.hasLlmsTxt,
      },
    });
    return { action: "scan-competitor", success: true, result };
  }

  if (actionType === "delete-competitor") {
    const id = formData.get("id") as string;
    await prisma.competitorScan.delete({ where: { id } });
    return { action: "delete-competitor", success: true };
  }

  return { action: "unknown" };
};

export default function CompetitorsPage() {
  const { myScore, competitors, plan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [competitorUrl, setCompetitorUrl] = useState("");

  const isPending = fetcher.state !== "idle";
  const scanResult = fetcher.data;

  if (scanResult?.action === "scan-competitor" && scanResult?.error) {
    shopify.toast.show(`Scan failed: ${scanResult.error}`);
  }

  if (plan !== "enterprise") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 p-8 pb-20 overflow-x-hidden relative flex flex-col justify-center items-center text-center">
        <div className="bg-white p-12 rounded-2xl max-w-2xl relative z-10 shadow-sm border border-slate-200">
          <div className="w-20 h-20 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-sm">
            <Lock className="w-10 h-10 text-slate-400" />
          </div>
          <h1 className="text-3xl font-extrabold mb-4 text-slate-900">Competitor Intelligence</h1>
          <p className="text-base text-slate-600 mb-10 leading-relaxed">
            Compare your GEO score against any competitor store. See exactly what schemas they have, whether AI bots can access their store, and how you stack up — so you can stay ahead.
          </p>
          <a href="/app/billing" className="inline-flex items-center gap-3 px-8 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-semibold rounded-xl shadow-sm transition-transform hover:-translate-y-1">
            Upgrade to Enterprise — $19.99/mo <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </div>
    );
  }

  const latestResult = scanResult?.action === "scan-competitor" && scanResult?.success ? scanResult.result : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pb-24 overflow-x-hidden w-full relative">
      <ui-title-bar title="Competitors" />
      <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-3 gap-10 w-full overflow-hidden">
        
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-10">
          <div>
            <h1 className="text-2xl font-bold mb-1 flex items-center gap-3 text-slate-900">
              <Globe className="w-6 h-6 text-slate-700" /> Competitor Comparison
            </h1>
            <p className="text-sm text-slate-500 mb-6">Scan competitor Shopify stores to decode their AI strategy.</p>
            
            <fetcher.Form method="POST" className="relative group">
              <input type="hidden" name="action" value="scan-competitor" />
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
              </div>
              <input
                type="url"
                name="url"
                required
                placeholder="https://competitor-store.myshopify.com"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
                className="w-full bg-white border border-slate-200 shadow-sm rounded-xl py-3 pl-12 pr-36 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all font-medium"
              />
              <button
                type="submit"
                disabled={isPending}
                className="absolute inset-y-1.5 right-1.5 px-6 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg font-medium transition-colors border border-transparent shadow-sm disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                {isPending ? <Activity className="w-4 h-4 animate-spin text-slate-400" /> : "Analyze"}
              </button>
            </fetcher.Form>
          </div>

          <AnimatePresence>
            {latestResult && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-900">
                  <Activity className="w-5 h-5 text-slate-700" /> Analysis Results
                </h2>
                <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                  
                  <div className="grid md:grid-cols-2 gap-8 mb-8">
                    {/* Their Score */}
                    <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 text-center">
                      <p className="text-slate-500 font-semibold mb-2 uppercase tracking-wide text-xs">{latestResult.name}</p>
                      <div className="text-5xl font-black mb-2 flex items-baseline justify-center gap-1">
                        <span className={latestResult.geoScore >= 80 ? 'text-emerald-600' : latestResult.geoScore >= 60 ? 'text-yellow-600' : 'text-red-600'}>{latestResult.geoScore}</span>
                        <span className="text-xl text-slate-400">/100</span>
                      </div>
                      <p className={`text-sm font-medium ${myScore > latestResult.geoScore ? 'text-emerald-600' : 'text-red-600'}`}>
                        {myScore > latestResult.geoScore ? `You are winning by ${myScore - latestResult.geoScore} points!` : `They are winning by ${latestResult.geoScore - myScore} points`}
                      </p>
                    </div>

                    {/* Breakdown */}
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-1 font-medium">
                          <span className="text-slate-600">Schema Quality</span>
                          <span className="text-slate-900">{latestResult.schemaQuality}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${latestResult.schemaQuality}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1 font-medium">
                          <span className="text-slate-600">AI Bot Access</span>
                          <span className="text-slate-900">{latestResult.aiBotAccess}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500" style={{ width: `${latestResult.aiBotAccess}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1 font-medium">
                          <span className="text-slate-600">Content Structure</span>
                          <span className="text-slate-900">{latestResult.contentStructure}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${latestResult.contentStructure}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 border-t border-slate-100 pt-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-500 line-clamp-1 truncate max-w-[200px]" title={latestResult.url}>{latestResult.url}</span>
                    </div>
                    <div className="flex gap-2 ms-auto">
                       {latestResult.hasLlmsTxt && <span className="px-3 py-1 bg-purple-50 border border-purple-200 text-purple-700 text-xs rounded-full font-medium">llms.txt</span>}
                       {latestResult.hasFaqSchema && <span className="px-3 py-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-full font-medium">FAQ Schema</span>}
                       {!latestResult.hasLlmsTxt && !latestResult.hasFaqSchema && <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-slate-600 text-xs rounded-full font-medium">Standard Theme</span>}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* History */}
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-900 border-b border-slate-200 pb-3">
               <Database className="w-5 h-5 text-slate-600" /> Past Scans
            </h2>
            {competitors.length > 0 ? (
              <div className="space-y-4">
                {competitors.map((comp) => (
                  <div key={comp.id} className="bg-white border border-slate-200 p-5 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:bg-slate-50 shadow-sm">
                    <div className="flex items-center gap-4 w-full sm:w-auto">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl border ${comp.geoScore >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : comp.geoScore >= 60 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {comp.geoScore}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-900">{comp.competitorName || comp.competitorUrl}</h4>
                        <p className="text-xs text-slate-500 font-medium">Scanned {new Date(comp.scannedAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${myScore > comp.geoScore ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {myScore > comp.geoScore ? `You +${myScore - comp.geoScore}` : `Them +${comp.geoScore - myScore}`}
                      </div>
                      <button
                        onClick={() => fetcher.submit({ action: "delete-competitor", id: comp.id }, { method: "POST" })}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent shadow-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !latestResult && (
              <div className="bg-white p-10 rounded-xl border border-slate-200 border-dashed text-center">
                <Search className="w-10 h-10 text-slate-400 mx-auto mb-4" />
                <h3 className="text-base font-bold text-slate-700 mb-2">No competitors scanned yet</h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">Enter a competitor's Shopify URL above to discover their GEO strategy and baseline your own score against theirs.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
            <h3 className="font-bold text-slate-500 mb-2 uppercase tracking-wide text-xs flex items-center justify-center gap-2">
              <TrendingUp className="w-4 h-4 text-slate-400" /> Your Score
            </h3>
            <div className="text-6xl font-black text-slate-900 flex items-baseline justify-center gap-1 my-4">
              {myScore} <span className="text-2xl text-slate-400">/100</span>
            </div>
            {latestResult && (
              <p className={`mt-2 text-sm font-semibold p-2 rounded-lg ${myScore > latestResult.geoScore ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {myScore > latestResult.geoScore ? 'You are leading this matchup!' : 'You need to optimize to catch up.'}
              </p>
            )}
          </div>

          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-semibold text-slate-900 mb-4 uppercase tracking-wide text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-slate-600" /> Why Track Rivals?
            </h3>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              When a user asks ChatGPT "What's the best running shoe?", the AI models look for deep semantic data and accessibility. 
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              Tracking your competitors shows you if they have implemented advanced features like <strong>llms.txt</strong> or <strong>FAQ Schemas</strong>, allowing you to react and adopt the same strategies to win the recommendation.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
