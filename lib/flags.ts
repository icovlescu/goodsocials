/**
 * Switches for running the product without part of it.
 *
 * NEXT_PUBLIC_PAYMENTS_HIDDEN takes every price, plan, trial and checkout off the screens
 * and lets every account publish as though it were paying, so the core loop
 * (sign in, board, approve, publish) can be tested without Stripe. Nothing
 * Stripe related is deleted: the webhook, `applySubscription`, the plan pages
 * and the billing columns all stay as they were, and turning the flag off puts
 * every screen back.
 *
 * Hidden unless the variable says otherwise, because that is the state the
 * product is being tested in now. To bring payments back, set
 * `NEXT_PUBLIC_PAYMENTS_HIDDEN=0` on Vercel and redeploy, or change the default
 * below. It is a public variable on purpose: it is not a secret, and the site
 * nav is a client component that needs the same answer the server has. Next
 * inlines it at build time, so a change needs a redeploy either way.
 */
export function paymentsHidden(): boolean {
  const value = process.env.NEXT_PUBLIC_PAYMENTS_HIDDEN;
  if (value === undefined || value === "") return true;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}
