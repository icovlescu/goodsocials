"use server";

import { redirect } from "next/navigation";
import { claimAdmin } from "@/lib/admin";

/** The Claim button on /admin. Wins only while the deployment has no admin. */
export async function claimAdminAction() {
  await claimAdmin();
  redirect("/admin");
}
