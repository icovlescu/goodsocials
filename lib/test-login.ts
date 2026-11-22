import { timingSafeEqual } from "node:crypto";
import { onboardMember } from "@/lib/onboarding";

/**
 * A sign in that does not go through LinkedIn, for testing the board without a
 * LinkedIn app, a consent screen or a real profile.
 *
 * Off unless TEST_LOGIN_PASSWORD is set on the deployment, and refused if that
 * password is shorter than 16 characters, so a forgotten variable or a weak one
 * cannot open a door on production. The password lives only in the
 * environment; nothing in the repo holds it.
 *
 * The account it signs into is an ordinary account, profile and board, built
 * by the same `onboardMember` a LinkedIn sign in uses. Two things differ:
 *
 * - The member id starts with TEST_MEMBER_PREFIX, so nothing can collide with a
 *   real LinkedIn `sub`, and anything that needs to know can tell.
 * - The stored token is a placeholder. The publish cron checks the prefix
 *   before it reads the token and pauses the post with a sentence instead, so a
 *   test board never sends anything to LinkedIn. lib/publish.ts.
 *
 * Generation (Anthropic, OpenRouter) is real and costs what it costs, under the
 * same image cap as any profile.
 */
export const TEST_LOGIN_PROVIDER = "test-login";
export const TEST_MEMBER_PREFIX = "test-";

const MIN_PASSWORD = 16;
const TEST_MEMBER_ID = `${TEST_MEMBER_PREFIX}account`;
const PLACEHOLDER_TOKEN = "test-login-placeholder-not-a-linkedin-token";

export function testLoginEnabled(): boolean {
  return (process.env.TEST_LOGIN_PASSWORD ?? "").length >= MIN_PASSWORD;
}

export function isTestMember(memberId: string | null | undefined): boolean {
  return Boolean(memberId?.startsWith(TEST_MEMBER_PREFIX));
}

function passwordMatches(given: string): boolean {
  const expected = process.env.TEST_LOGIN_PASSWORD ?? "";
  if (expected.length < MIN_PASSWORD) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The Credentials provider's authorize step. Returns the Auth.js user, whose
 * id becomes the session's memberId, or null for a wrong password.
 */
export async function authorizeTestLogin(
  credentials: Partial<Record<string, unknown>>,
): Promise<{ id: string; name: string; email: string | null } | null> {
  const password =
    typeof credentials.password === "string" ? credentials.password : "";
  if (!testLoginEnabled() || !passwordMatches(password)) {
    console.warn("[test-login] refused a sign in");
    return null;
  }

  const name = "Test account";
  const email = process.env.TEST_LOGIN_EMAIL || null;

  await onboardMember({
    memberId: TEST_MEMBER_ID,
    name,
    email,
    avatarUrl: null,
    accessToken: PLACEHOLDER_TOKEN,
    // A year out, so the expiry banner and the day 50 email stay quiet. The
    // token is never used, so its lifetime means nothing to LinkedIn.
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    scopes: "test",
  });

  return { id: TEST_MEMBER_ID, name, email };
}
