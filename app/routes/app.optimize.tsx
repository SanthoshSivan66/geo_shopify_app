import { useState } from "react";
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
import { scanForIssues, applyFixes } from "../services/auto-fix.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const { plan } = await getActiveSubscription(admin, shop);

  // Get shop name for generating SEO content
  const shopRes = await admin.graphql(`
    #graphql
    query { shop { name } }
  `);
  const shopData = await shopRes.json();
  const shopName = shopData.data?.shop?.name ?? shop;

  // Scan for issues
  const { products, summary } = await scanForIssues(admin, shopName);

  return {
    shop,
    shopName,
    plan,
    products,
    summary,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  // Get shop name
  const shopRes = await admin.graphql(`
    #graphql
    query { shop { name } }
  `);
  const shopData = await shopRes.json();
  const shopName = shopData.data?.shop?.name ?? shop;

  if (actionType === "fix-all" || actionType === "fix-selected") {
    const { products } = await scanForIssues(admin, shopName);

    let productIds: string[];
    if (actionType === "fix-all") {
      productIds = products.map((p) => p.id);
    } else {
      const selected = formData.get("productIds") as string;
      productIds = selected ? selected.split(",") : [];
    }

    const result = await applyFixes(admin, productIds, products);

    return {
      action: actionType,
      ...result,
    };
  }

  return { action: "unknown" };
};

import { motion } from "framer-motion";
import { Zap, ShieldAlert, CheckCircle, Image as ImageIcon, Type, FileText, Settings, ArrowRight, XCircle, Activity } from "lucide-react";

export default function OptimizePage() {
  const { plan, products, summary } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const isPending = fetcher.state !== "idle";
  const fixResult = fetcher.data;

  if (fixResult?.action === "fix-all" && (fixResult as any)?.fixed && !isPending) {
    shopify.toast.show(`✅ Fixed ${(fixResult as any).fixed} product(s)! Rescan to see your new score.`);
  }

  if (plan === "free") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 p-8 pb-20 overflow-x-hidden relative flex flex-col justify-center items-center text-center">
        <div className="bg-white p-12 rounded-2xl max-w-2xl relative z-10 shadow-sm border border-slate-200">
          <div className="w-20 h-20 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-sm">
            <Zap className="w-10 h-10 text-slate-400" />
          </div>
          <h1 className="text-3xl font-extrabold mb-4 text-slate-900">Auto-Optimize Everything</h1>
          <p className="text-base text-slate-600 mb-10 leading-relaxed">
            Auto-Optimize scans all your products and fixes SEO issues with one click. Missing titles, descriptions, and image alt text are generated automatically to boost your GEO score to 90+.
          </p>
          <a href="/app/billing" className="inline-flex items-center gap-3 px-8 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-semibold rounded-xl shadow-sm transition-transform hover:-translate-y-1">
            Upgrade to Pro — $7.99/mo <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </div>
    );
  }

  const allGood = summary.totalFixable === 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pb-24 overflow-x-hidden w-full relative">
      <ui-title-bar title="Auto-Optimize" />
      <div className="max-w-5xl mx-auto relative z-10 w-full overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-3 text-slate-900">
              <Zap className="w-8 h-8 text-slate-700" /> Auto-Optimize
            </h1>
            <p className="text-slate-500">Instantly generate and inject missing SEO metadata</p>
          </div>
          
          {!allGood && (
            <button
              onClick={() => fetcher.submit({ action: "fix-all" }, { method: "POST" })}
              disabled={isPending}
              className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-medium transition-colors shadow-sm flex items-center gap-2 group border border-transparent disabled:opacity-50"
            >
              {isPending ? <Activity className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5 group-hover:fill-current group-hover:scale-110 transition-transform" />}
              {isPending ? "Optimizing..." : `Fix All Issues (${summary.totalFixable})`}
            </button>
          )}
        </div>

        {/* Issues Summary Header */}
        {allGood ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-emerald-50 p-10 rounded-2xl mb-10 text-center border border-emerald-200">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100 shadow-sm">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-emerald-800 mb-2">Clean Bill of Health!</h2>
            <p className="text-emerald-700">All {summary.totalProducts} products have proper SEO titles, meta descriptions, and image alt text. Your store is fully optimized for AI.</p>
          </motion.div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6 mb-10">
            <div className={`bg-white p-6 rounded-2xl shadow-sm border ${summary.missingSeoTitle > 0 ? 'border-red-200' : 'border-emerald-200'}`}>
              <div className="flex items-center gap-3 mb-2">
                <Type className={`w-5 h-5 ${summary.missingSeoTitle > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <h3 className="font-semibold text-slate-700">Missing SEO Titles</h3>
              </div>
              <div className={`text-4xl font-bold ${summary.missingSeoTitle > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{summary.missingSeoTitle}</div>
            </div>
            
            <div className={`bg-white p-6 rounded-2xl shadow-sm border ${summary.missingSeoDesc > 0 ? 'border-red-200' : 'border-emerald-200'}`}>
              <div className="flex items-center gap-3 mb-2">
                <FileText className={`w-5 h-5 ${summary.missingSeoDesc > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
                <h3 className="font-semibold text-slate-700">Missing Descriptions</h3>
              </div>
              <div className={`text-4xl font-bold ${summary.missingSeoDesc > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{summary.missingSeoDesc}</div>
            </div>
            
            <div className={`bg-white p-6 rounded-2xl shadow-sm border ${summary.missingAltText > 0 ? 'border-yellow-300' : 'border-emerald-200'}`}>
              <div className="flex items-center gap-3 mb-2">
                <ImageIcon className={`w-5 h-5 ${summary.missingAltText > 0 ? 'text-yellow-600' : 'text-emerald-500'}`} />
                <h3 className="font-semibold text-slate-700">Missing Alt Text</h3>
              </div>
              <div className={`text-4xl font-bold ${summary.missingAltText > 0 ? 'text-yellow-600' : 'text-emerald-600'}`}>{summary.missingAltText}</div>
            </div>
          </div>
        )}

        {/* Product List */}
        {!allGood && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-900 border-b border-slate-200 pb-3">
              <Settings className="w-5 h-5 text-slate-600" /> Affected Products
            </h2>
            
            {products.map((product) => (
              <div key={product.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all">
                <div className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="font-semibold text-lg text-slate-900">{product.title}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {product.issues.map((issue, i) => (
                        <span key={i} className="px-2 py-1 bg-red-50 border border-red-100 text-red-700 text-xs rounded-md flex items-center gap-1 font-medium">
                          <XCircle className="w-3 h-3" /> {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors border border-slate-200 text-slate-700"
                  >
                    {expandedProduct === product.id ? "Close Preview" : "Review Fixes"}
                  </button>
                </div>

                {expandedProduct === product.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-slate-200 p-5 bg-slate-50 space-y-6">
                    
                    {product.fixes.seoTitle && (
                      <div>
                        <h4 className="text-sm font-bold text-slate-500 mb-2 uppercase tracking-wide">SEO Title</h4>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="p-3 bg-white border border-red-200 rounded-xl shadow-sm">
                            <span className="text-xs font-bold text-red-500 mb-1 block">Current</span>
                            <span className="text-slate-500 line-through">{product.currentSeoTitle || "(Empty)"}</span>
                          </div>
                          <div className="p-3 bg-white border border-emerald-200 rounded-xl relative shadow-sm">
                            <ArrowRight className="w-4 h-4 text-emerald-500 absolute -left-3 top-1/2 -translate-y-1/2 bg-white rounded-full hidden md:block" />
                            <span className="text-xs font-bold text-emerald-600 mb-1 block">AI Generated</span>
                            <span className="text-emerald-800 font-medium">{product.fixes.seoTitle}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {product.fixes.seoDescription && (
                      <div>
                        <h4 className="text-sm font-bold text-slate-500 mb-2 uppercase tracking-wide">Meta Description</h4>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="p-3 bg-white border border-red-200 rounded-xl shadow-sm">
                            <span className="text-xs font-bold text-red-500 mb-1 block">Current</span>
                            <span className="text-slate-500 line-through text-sm">{product.currentSeoDescription || "(Empty)"}</span>
                          </div>
                          <div className="p-3 bg-white border border-emerald-200 rounded-xl relative shadow-sm">
                            <ArrowRight className="w-4 h-4 text-emerald-500 absolute -left-3 top-1/2 -translate-y-1/2 bg-white rounded-full hidden md:block" />
                            <span className="text-xs font-bold text-emerald-600 mb-1 block">AI Generated</span>
                            <span className="text-emerald-800 font-medium text-sm">{product.fixes.seoDescription}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {product.fixes.altTexts && product.fixes.altTexts.length > 0 && (
                      <div>
                        <h4 className="text-sm font-bold text-slate-500 mb-2 uppercase tracking-wide">Image Alt Texts ({product.fixes.altTexts.length})</h4>
                        <div className="space-y-2">
                          {product.fixes.altTexts.slice(0, 3).map((alt, i) => (
                            <div key={i} className="flex flex-col md:flex-row gap-2 md:items-center p-3 border border-slate-200 rounded-xl bg-white shadow-sm">
                               <span className="text-xs text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded font-medium">Empty</span>
                               <ArrowRight className="w-4 h-4 text-slate-400 hidden md:block" />
                               <span className="text-sm text-emerald-700 font-medium">{alt.altText}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t border-slate-200 flex justify-end">
                      <button
                        onClick={() => fetcher.submit({ action: "fix-selected", productIds: product.id }, { method: "POST" })}
                        disabled={isPending}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm shadow-sm"
                      >
                        Apply Fixes to Item
                      </button>
                    </div>

                  </motion.div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
