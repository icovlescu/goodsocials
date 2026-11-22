import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { Footer } from "@/components/footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { BLOCK_LINE, resolveEntry, type EntryBlock } from "@/lib/entry";
import { PLAN_COOKIE, planFromSlug } from "@/lib/plans";
import { TrackView } from "@/components/onboarding/track-view";
import { anonId, track } from "@/lib/track";
import { shareMetadata } from "@/lib/share";
import { TEST_LOGIN_PROVIDER, testLoginEnabled } from "@/lib/test-login";

export const metadata = shareMetadata({
  path: "/signin",
  title: "Sign in | GoodSocials",
  description:
    "Connect your LinkedIn profile so GoodSocials can write posts for your approval and publish the ones you approve.",
});

/**
 * Replaces the Auth.js default page. The stock page is an unbranded button
 * naming a major platform on a domain with no content, which is the exact
 * shape of a credential harvester and is what got goodsocials.co flagged by
 * Google Safe Browsing. So the page still says who we are, what LinkedIn is
 * about to ask for, and what we never do, but in four lines instead of two
 * screens. The long version lives on the landing page and in the terms.
 *
 * Our name leads the tab title, the nav and the heading, and LinkedIn comes
 * second as the way in. On 25 September the page went back to "Sign in with
 * LinkedIn" in the title and the heading with no mark and no nav, and Search
 * Console reported Deceptive pages the next day. Keep GoodSocials first.
 *
 * The page is a sign in and nothing else: no plan, no price, no trial. Those
 * belong to the offer screen after the sample post. Each pricing link still
 * arrives with its own ?plan=, and the choice survives the trip through
 * LinkedIn in a cookie that checkout reads, without being shown here. An
 * unknown or missing slug falls back to the entry plan rather than blocking
 * the flow.
 *
 * A member who is already signed in never sees this page as a stranger would.
 * Either their board opens, or the page names what is stopping it. Sending
 * them back through LinkedIn with nothing said is what turned one broken row
 * into a redirect loop: consent takes a blink the second time, so the bounce
 * came straight back here and looked like a sign in that would not take.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; stuck?: string; test?: string }>;
}) {
  const params = await searchParams;
  const plan = planFromSlug(params.plan);
  const entry = await resolveEntry();

  if (entry.at === "board") redirect("/board");
  if (entry.at === "onboarding") redirect("/onboarding");
  if (entry.at === "no-seat") redirect("/settings");

  // Live state, not the ?stuck= that sent them here. The parameter is there so
  // the reason survives in a screenshot and in the log; the sentence comes
  // from what is true now.
  const blocked: Exclude<EntryBlock, "signed-out"> | null =
    entry.at === "signed-out" ? null : entry.at;

  return (
    <>
      {/* One lifted card on the warm ground, the same object the landing page
          is built out of. DESIGN.md section 7. */}
      {blocked ? null : <TrackView step="signin" />}
      <SiteNav />
      <main className="mx-auto max-w-[480px] px-6 py-20">
        <div className="card-lift rounded-[var(--r-xl)] p-8 sm:p-10">
          <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em]">
            {blocked ? "Finish connecting." : "Sign in to GoodSocials."}
          </h1>
          <p className="mt-3 text-ink-2">
            {blocked
              ? BLOCK_LINE[blocked]
              : "GoodSocials writes posts for your LinkedIn profile and publishes the ones you approve. You sign in with your LinkedIn account."}
          </p>

          <form
            className="mt-10"
            action={async () => {
              "use server";
              const store = await cookies();
              store.set(PLAN_COOKIE, plan.slug, {
                httpOnly: true,
                sameSite: "lax",
                secure: true,
                path: "/",
                maxAge: 60 * 60 * 24 * 30,
              });
              // Before LinkedIn, so the funnel counts the people who press the
              // button and never come back from the consent screen.
              await track("signin_started", { distinctId: await anonId(), plan: plan.slug });
              await signIn("linkedin", { redirectTo: "/onboarding" });
            }}
          >
            <button
              type="submit"
              className="pill btn-ink w-full bg-ink px-6 py-[14px] text-[17px] text-paper"
            >
              {blocked ? "Connect again" : "Continue with LinkedIn"}
            </button>
          </form>

          {blocked ? (
            // The only way out of a session that cannot open a board. Without it
            // the member is holding a cookie they have no control over.
            <form
              className="mt-6 text-center"
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="text-[13px] text-ink-2 underline"
              >
                Sign out and start again
              </button>
            </form>
          ) : null}

          {/* Only while TEST_LOGIN_PASSWORD is set. lib/test-login.ts. */}
          {testLoginEnabled() && !blocked ? (
            <form
              className="mt-8 border-t border-hairline pt-6"
              action={async (data: FormData) => {
                "use server";
                const password = String(data.get("password") ?? "");
                try {
                  await signIn(TEST_LOGIN_PROVIDER, {
                    password,
                    redirectTo: "/onboarding",
                  });
                } catch (cause) {
                  // A wrong password is CredentialsSignin. Anything else from
                  // Auth.js is the account rows failing to write, which is the
                  // database. The redirect on success is thrown too, and has
                  // to be let through.
                  if (cause instanceof AuthError) {
                    console.error("[test-login]", cause.type, cause.message);
                    redirect(
                      cause.type === "CredentialsSignin"
                        ? "/signin?test=wrong"
                        : "/signin?test=failed",
                    );
                  }
                  throw cause;
                }
              }}
            >
              <label
                htmlFor="test-password"
                className="text-[13px] font-medium text-ink-2"
              >
                Test account, no LinkedIn
              </label>
              <input
                id="test-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="mt-2 w-full rounded-[10px] border border-hairline bg-surface px-4 py-[10px] text-[15px]"
              />
              {params.test === "wrong" || params.test === "failed" ? (
                <p className="mt-2 text-[13px] text-ink" role="alert">
                  {params.test === "wrong"
                    ? "That password did not match. Check TEST_LOGIN_PASSWORD on the deployment."
                    : "The password matched, but the test account could not be created. Check the database tables, then try again."}
                </p>
              ) : null}
              <button
                type="submit"
                className="pill btn-outline mt-3 w-full border border-hairline bg-surface px-6 py-[12px] text-[15px]"
              >
                Sign in to the test account
              </button>
            </form>
          ) : null}

          <ul className="mt-12 text-[13px] text-ink-2">
            <li className="border-t border-hairline py-[12px]">
              LinkedIn asks you to allow your name and email, and posting as
              you.
            </li>
            <li className="border-y border-hairline py-[12px]">
              We never see your password, and nothing publishes without your
              approval.
            </li>
          </ul>
        </div>
      </main>
      <Footer />
    </>
  );
}
