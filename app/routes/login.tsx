import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  buildDemoBypassSession,
  commitSession,
  getOptionalCustomer,
  getSession,
  isDemoBypassEmail,
  startPasswordlessLogin,
} from "~/lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Sign in — Walden Local" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await getOptionalCustomer(request);
  if (auth) {
    const url = new URL(request.url);
    const next = url.searchParams.get("next");
    return redirect(next && next.startsWith("/") ? next : `/${auth.customerId}`);
  }

  const cookie = await getSession(request.headers.get("Cookie"));
  const pendingEmail = cookie.get("pendingEmail") ?? "";
  return json({ pendingEmail });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "");

  if (!email) {
    return json({ error: "Please enter an email address." }, { status: 400 });
  }

  if (isDemoBypassEmail(email)) {
    const resolved = buildDemoBypassSession();
    const cookie = await getSession(request.headers.get("Cookie"));
    cookie.set("customerId", resolved.customerId);
    cookie.set("apiToken", resolved.apiToken);
    cookie.set("apiTokenExpiresAt", resolved.apiTokenExpiresAt);
    cookie.set("email", resolved.email);
    const destination = next && next.startsWith("/") ? next : `/${resolved.customerId}`;
    return redirect(destination, { headers: { "Set-Cookie": await commitSession(cookie) } });
  }

  let sessionToken: string;
  try {
    sessionToken = await startPasswordlessLogin(email);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start sign-in.";
    return json({ error: message }, { status: 502 });
  }

  const cookie = await getSession(request.headers.get("Cookie"));
  cookie.set("pendingEmail", email);
  cookie.set("pendingSessionToken", sessionToken);

  const verifyUrl = next ? `/login/verify?next=${encodeURIComponent(next)}` : "/login/verify";
  return redirect(verifyUrl, { headers: { "Set-Cookie": await commitSession(cookie) } });
}

export default function LoginPage() {
  const { pendingEmail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";

  const reason = searchParams.get("reason");
  const next = searchParams.get("next") ?? "";
  const expired = reason === "expired";
  const required = reason === "required";

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <div className="bg-gold-light py-1 text-center text-[13px] font-medium text-ink">Recharge demo environment</div>
      <div className="bg-forest h-[72px] flex items-center justify-center">
        <img src="/walden-logo.svg" alt="Walden Local" className="h-[52px]" />
      </div>
      <div className="flex-1 flex items-start justify-center px-4 pt-16 pb-10">

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="bg-white rounded-lg border border-line shadow-card p-8 sm:p-10">

          <div className="text-center mb-7">
            <h1 className="text-[34px] font-[900] uppercase tracking-[-0.02em] text-ink">
              Welcome back
            </h1>
            <p className="text-stone-500 mt-1.5 text-sm">
              Sign in to My Walden to manage your upcoming deliveries.
            </p>
          </div>

          {(expired || required) && !actionData?.error && (
            <div className="mb-5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 animate-slide-up">
              {expired ? "Your session expired. Please sign in again." : "Please sign in to continue."}
            </div>
          )}

          <Form method="post" className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                defaultValue={pendingEmail}
                autoFocus
                required
                className="w-full rounded border border-line bg-white px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-forest-700/30 focus:border-forest-700 transition-shadow"
              />
              <p className="mt-2 text-xs text-stone-500">
                We&apos;ll email you a 6-digit code to confirm it&apos;s you.
              </p>
            </div>
            <button type="submit" disabled={isSubmitting} className="btn-forest-lg w-full rounded-full">
              {isSubmitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending code…
                </>
              ) : (
                "Send sign-in code"
              )}
            </button>
          </Form>

          {actionData?.error && (
            <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2 animate-slide-up">
              <svg className="w-4 h-4 text-red-500 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-red-700">{actionData.error}</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-stone-400">
          <span>Pasture-raised meat, delivered by our own vans.</span>
          <span aria-hidden="true">·</span>
          <Link to="/merchant" className="hover:text-forest-700 transition-colors">
            Merchant portal →
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}
