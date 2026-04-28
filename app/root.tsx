import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";
import * as Sentry from "@sentry/react-router";
import tailwindCss from "./tailwind.css?url";

Sentry.init({
  dsn: "https://173f5d6fa41f297e7544773a4be74cca@o4511263325749248.ingest.de.sentry.io/4511298166653008",
  tracesSampleRate: 1.0,
});

export function links() {
  return [
    { rel: "stylesheet", href: tailwindCss },
  ];
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        
        {/* PostHog Analytics Placeholder */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])}},window.posthog||function(){var t=window.posthog=[];return t.push=function(){t.push.apply(t,arguments)},t}();
              posthog.init('phc_ydVwpHtk9TxLHNEvU2ywMhaCb2weG6NGAZ5aGr8Pq5mF', {
                  api_host:'https://us.i.posthog.com',
                  person_profiles: 'identified_only' // or 'always' to create profiles for anonymous users as well
              })
            `,
          }}
        />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  Sentry.captureException(error);
  return (
    <html lang="en">
      <head>
        <title>Oh no!</title>
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Something went wrong</h1>
          <p>The app encountered an error. We've been notified and are looking into it.</p>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
