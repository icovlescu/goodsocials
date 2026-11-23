import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Footer } from "@/components/footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { loadAccess } from "@/lib/profiles";
import { checkAuthorize, denyUrl, issueCode } from "@/lib/oauth/server";
import { TEST_LOGIN_PROVIDER, testLoginEnabled } from "@/lib/test-login";

export const metadata = {
  title: "Connect Claude | GoodSocials",
  robots: { index: false },
};

type Params = Record<string, string | undefined>;

/** Only the parameters the authorization request is made of, in one string. */
const KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

function pick(raw: Record<string, string | string[] | undefined>): Params {
  const out: Params = {};
  for (const key of KEYS) {
    const value = raw[key];
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function selfHref(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `/oauth/authorize?${qs.toString()}`;
}

function fromForm(data: FormData): Params {
  const out: Params = {};
  for (const key of KEYS) {
    const v = data.get(key);
    out[key] = typeof v === "string" && v ? v : undefined;
  }
  return out;
}

/**
 * The consent screen for the Claude connector.
 *
 * The member proves who they are with the same LinkedIn sign in the board
 * uses, then says yes or no to one app. Allow and Deny both run the checks
 * again on the server, from the submitted parameters, so nothing on this page
 * is trusted because it rendered.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = pick(await searchParams);
  const checked = await checkAuthorize(params);

  if (!checked.ok && "redirect" in checked) redirect(checked.redirect);
  if (!checked.ok) {
    return (
      <Shell title="This connection cannot go ahead.">
        <p className="mt-3 text-ink-2">{checked.show}</p>
      </Shell>
    );
  }

  const { request } = checked;
  const session = await auth();
  const here = selfHref(params);

  if (!session?.memberId) {
    return (
      <Shell title="Sign in to connect Claude.">
        <p className="mt-3 text-ink-2">
          {request.client.name} wants to work on your GoodSocials board. Sign in
          first, then you choose whether to allow it.
        </p>
        <form
          className="mt-10"
          action={async () => {
            "use server";
            await signIn("linkedin", { redirectTo: here });
          }}
        >
          <button
            type="submit"
            className="pill btn-ink w-full bg-ink px-6 py-[14px] text-[17px] text-paper"
          >
            Continue with LinkedIn
          </button>
        </form>
        {testLoginEnabled() ? (
          <form
            className="mt-8 border-t border-hairline pt-6"
            action={async (data: FormData) => {
              "use server";
              await signIn(TEST_LOGIN_PROVIDER, {
                password: String(data.get("password") ?? ""),
                redirectTo: here,
              });
            }}
          >
            <label htmlFor="test-password" className="text-[13px] font-medium text-ink-2">
              Test account, no LinkedIn
            </label>
            <input
              id="test-password"
              name="password"
              type="password"
              required
              className="mt-2 w-full rounded-[10px] border border-hairline bg-surface px-4 py-[10px] text-[15px]"
            />
            <button
              type="submit"
              className="pill btn-outline mt-3 w-full border border-hairline bg-surface px-6 py-[12px] text-[15px]"
            >
              Sign in to the test account
            </button>
          </form>
        ) : null}
      </Shell>
    );
  }

  const access = await loadAccess(session.memberId);
  if (!access?.active) {
    return (
      <Shell title="Set up your board first.">
        <p className="mt-3 text-ink-2">
          Your GoodSocials account has no board yet. Open{" "}
          <a className="underline" href="/onboarding">
            onboarding
          </a>
          , finish it, then add the connector in Claude again.
        </p>
      </Shell>
    );
  }

  const profiles = access.seats.length;

  return (
    <Shell title={`Allow ${request.client.name} to use your board?`}>
      <p className="mt-3 text-ink-2">
        Claude writes the posts in your own chat, on your own Claude plan.
        GoodSocials keeps the board, your brand principles and the schedule,
        and publishes to LinkedIn.
      </p>
      <ul className="mt-8 text-[14px] text-ink-2">
        <li className="border-t border-hairline py-[12px]">
          Read your brand principles, themes and connected numbers
          {profiles > 1 ? `, for all ${profiles} profiles on this account` : ""}.
        </li>
        <li className="border-t border-hairline py-[12px]">
          Add and edit drafts, and change a brand principle when you ask it to.
        </li>
        <li className="border-y border-hairline py-[12px]">
          Schedule and publish a post only when you tell it to in the chat.
        </li>
      </ul>
      <p className="mt-4 text-[13px] text-ink-3">
        Sends you back to {new URL(request.redirectUri).host}. You can
        disconnect it in settings at any time.
      </p>

      <form
        className="mt-8 flex flex-col gap-3"
        action={async (data: FormData) => {
          "use server";
          const who = await auth();
          const again = await checkAuthorize(fromForm(data));
          if (!again.ok) {
            redirect("redirect" in again ? again.redirect : "/settings");
          }
          if (!who?.memberId) redirect(selfHref(fromForm(data)));
          if (data.get("decision") !== "allow") redirect(denyUrl(again.request));
          redirect(await issueCode(again.request, who.memberId));
        }}
      >
        {Object.entries(params).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}
        <button
          type="submit"
          name="decision"
          value="allow"
          className="pill btn-ink w-full bg-ink px-6 py-[14px] text-[17px] text-paper"
        >
          Allow
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="pill btn-outline w-full border border-hairline bg-surface px-6 py-[12px] text-[15px]"
        >
          Do not allow
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[480px] px-6 py-20">
        <div className="card-lift rounded-[var(--r-xl)] p-8 sm:p-10">
          <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em]">
            {title}
          </h1>
          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}
