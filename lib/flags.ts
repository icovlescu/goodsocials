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

/**
 * Whether this deployment can write with our own model. Off while
 * ANTHROPIC_API_KEY is unset, which is how the free tier is tested: the
 * member's AI chat writes everything through the connector, onboarding
 * included, and every screen that would have called the model says what to
 * do instead of failing. Server side only; the key never reaches a client.
 */
export function serverWriting(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Whether this deployment can generate images. Off while OPENROUTER_API_KEY is unset. */
export function serverImages(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** What a screen says when it would have written with our model and cannot. */
export const CHAT_WRITES =
  "On this plan your AI chat writes the posts. Ask it in Claude or ChatGPT with the GoodSocials connector, and the post lands here.";
