import { useEffect } from "react";
import { redirect } from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  PLANS,
  createSubscription,
  getActiveSubscription,
  cancelSubscription,
  type PlanId,
} from "../services/billing.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan: activePlan, subscription } =
    await getActiveSubscription(admin, shop);

  // Sync plan to local DB
  await prisma.store.upsert({
    where: { shop },
    create: { shop, plan: activePlan },
    update: { plan: activePlan },
  });

  return {
    shop,
    activePlan,
    subscription,
    plans: PLANS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;
  const targetPlan = formData.get("plan") as PlanId;

  if (actionType === "upgrade") {
    try {
      const appUrl = process.env.SHOPIFY_APP_URL || `https://${shop}/admin/apps`;
      const result = await createSubscription(
        admin,
        targetPlan,
        shop,
        `${appUrl}/app/billing?status=accepted`
      );

      if (result?.confirmationUrl) {
        // Return URL to frontend to break out of the Shopify App Bridge iframe
        return { action: "upgrade", success: true, confirmationUrl: result.confirmationUrl };
      }

      return { action: "upgrade", success: true };
    } catch (error) {
      // Re-throw redirects
      if (error instanceof Response) throw error;
      return {
        action: "upgrade",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  return { action: "unknown" };
};

import { motion } from "framer-motion";
import { CheckCircle2, CreditCard, ShieldCheck, Zap, Building2, Activity, ArrowRight, Settings } from "lucide-react";

export default function BillingPage() {
  const { activePlan, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isPending = fetcher.state !== "idle" || (fetcher.data?.action === "upgrade" && fetcher.data?.success);

  useEffect(() => {
    if (fetcher.data?.action === "upgrade" && fetcher.data?.success && fetcher.data?.confirmationUrl) {
      window.open(fetcher.data.confirmationUrl, "_top");
    }
  }, [fetcher.data]);

  if (fetcher.data?.action === "upgrade" && fetcher.data?.error) {
    shopify.toast.show(`Upgrade failed: ${fetcher.data.error}`);
  }

  if (fetcher.data?.action === "downgrade" && fetcher.data?.success) {
    shopify.toast.show("Downgraded to Free plan");
  }

  const planEntries = Object.entries(plans) as Array<[PlanId, (typeof plans)[PlanId]]>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pb-24 overflow-x-hidden w-full relative">
      <ui-title-bar title="Plans & Billing" />
      <div className="max-w-6xl mx-auto relative z-10 w-full overflow-hidden">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-slate-900">Choose Your Plan</h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            All plans include the GEO Score Dashboard with full category breakdown. Upgrade to unlock automatic schema injection, competitor intelligence, and advanced AI visibility features.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {planEntries.map(([planId, plan], index) => {
            const isActive = activePlan === planId;
            const isUpgrade = planId !== "free" && (activePlan === "free" || (activePlan === "pro" && planId === "enterprise"));
            const isDowngrade = planId === "free" && activePlan !== "free";
            
            const isPro = planId === "pro";
            const isEnterprise = planId === "enterprise";

            return (
               <motion.div
                key={planId}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`relative rounded-3xl overflow-hidden bg-white shadow-sm flex flex-col ${isActive ? 'ring-2 ring-zinc-900 border-none' : 'border border-slate-200'}`}
               >
                 {isActive && (
                   <div className="absolute top-0 inset-x-0 h-1 bg-zinc-900" />
                 )}
                 {isEnterprise && !isActive && (
                   <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
                 )}
                 
                 <div className="p-8 grow flex flex-col">
                   <div className="flex justify-between items-start mb-6">
                     <div>
                       <div className="flex items-center gap-2 mb-2">
                         {planId === "free" ? <Settings className="w-5 h-5 text-slate-500" /> : isPro ? <Zap className="w-5 h-5 text-yellow-500" /> : <Building2 className="w-5 h-5 text-purple-600" />}
                         <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                       </div>
                       <div className="flex items-baseline gap-1">
                         <span className="text-4xl font-black text-slate-900">{plan.price === 0 ? "Free" : `$${plan.price}`}</span>
                         {plan.price > 0 && <span className="text-slate-500 font-medium">/mo</span>}
                       </div>
                     </div>
                     {isActive && (
                       <span className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-full border border-slate-200">Current</span>
                     )}
                   </div>

                   <ul className="space-y-4 mb-8 flex-grow">
                     {plan.features.map((feature, i) => (
                       <li key={i} className="flex gap-3 text-slate-600 text-sm leading-relaxed">
                         <CheckCircle2 className={`w-5 h-5 shrink-0 ${isEnterprise ? 'text-purple-600' : isPro ? 'text-blue-600' : 'text-slate-400'}`} />
                         <span>{feature}</span>
                       </li>
                     ))}
                   </ul>

                   {/* Action Buttons */}
                   {isActive ? (
                     <button className="w-full py-3 px-6 bg-slate-50 text-slate-400 rounded-xl font-semibold cursor-default border border-slate-200">
                        Active Plan
                     </button>
                   ) : isUpgrade ? (
                     <button
                       onClick={() => fetcher.submit({ action: "upgrade", plan: planId }, { method: "POST" })}
                       disabled={isPending}
                       className={`w-full py-3 px-6 rounded-xl font-semibold transition-all flex justify-center items-center gap-2 shadow-sm ${isEnterprise ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white' : 'bg-zinc-900 hover:bg-zinc-800 text-white'}`}
                     >
                       {isPending ? <Activity className="w-5 h-5 animate-spin" /> : null}
                       {isPending ? "Processing..." : `Upgrade to ${plan.name}`}
                     </button>
                   ) : null}
                 </div>
               </motion.div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="mt-16 grid md:grid-cols-2 gap-8 text-center md:text-left">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center shrink-0 border border-slate-200">
               <CreditCard className="w-6 h-6 text-slate-700" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 mb-1">Secure Billing</h4>
              <p className="text-sm text-slate-600">All payments are securely processed through Shopify. Cancel anytime from your active subscriptions.</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center shrink-0 border border-emerald-100">
               <ShieldCheck className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 mb-1">Risk-Free Trial</h4>
              <p className="text-sm text-slate-600">Not sure which plan to choose? Try the Pro plan to instantly inject schemas and see the immediate SEO improvements.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
