"use client";

import { useState } from "react";
import { loadShareOptions, recordShare } from "@/app/board/actions";
import { PUBLISH_DISCLAIMER } from "@/lib/platforms/registry";
import type { ShareOption } from "@/lib/variants";

/**
 * The same post on other platforms, by hand. Each row opens that platform's
 * compose screen with the post filled in, or copies the text where the
 * platform has no such link, and the member presses Post there. Folded by
 * default and loaded on first open, so the dialog costs nothing extra for
 * the member who only posts to LinkedIn.
 *
 * Not a fourth card action: nothing here moves the card. Versions written for
 * a platform's limits come from the member's AI chat through the connector;
 * without one, the LinkedIn text is offered where it fits.
 */
export function ShareElsewhere({ cardId }: { cardId: string }) {
  const [options, setOptions] = useState<ShareOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    if (options || failed) return;
    const got = await loadShareOptions(cardId).catch(() => null);
    if (got) setOptions(got);
    else setFailed(true);
  }

  async function copy(o: ShareOption) {
    try {
      await navigator.clipboard.writeText(o.text);
      setCopied(o.platform);
    } catch {
      setCopied(null);
    }
    void recordShare(cardId, o.platform, o.text);
  }

  async function nativeShare(o: ShareOption) {
    try {
      await navigator.share({ text: o.text });
      void recordShare(cardId, o.platform, o.text);
    } catch {
      // The member closed the sheet. Nothing was handed over.
    }
  }

  const canShareSheet = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <details
      className="mt-6 border-t border-hairline pt-4"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer text-[13px] font-medium text-ink-2">
        Share to other platforms
      </summary>
      {failed ? (
        <p className="mt-3 text-[13px] text-ink-2">
          The share options did not load. Close the card and open it again.
        </p>
      ) : !options ? (
        <p className="mt-3 text-[13px] text-ink-2">Loading</p>
      ) : options.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-2">Write the post first.</p>
      ) : (
        <ul className="mt-3">
          {options.map((o) => (
            <li
              key={o.platform}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline py-[10px]"
            >
              <span className="text-[15px]">
                {o.name}
                {o.status === "manual" ? (
                  <span className="ml-2 text-[13px] text-ink-3">handed over</span>
                ) : null}
                {o.problems.length > 0 ? (
                  <span className="block text-[13px] text-ink-2">
                    {o.problems[0]}
                    {o.adapted ? "" : " Ask your AI chat for a version that fits."}
                  </span>
                ) : o.needsMedia ? (
                  <span className="block text-[13px] text-ink-2">
                    Needs {o.needsMedia === "image" ? "an image" : "a video"}, added in the app.
                  </span>
                ) : null}
              </span>
              {o.problems.length > 0 ? null : (
                <span className="flex gap-4 text-[13px]">
                  {o.shareUrl ? (
                    <a
                      href={o.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void recordShare(cardId, o.platform, o.text)}
                      className="text-ink underline"
                    >
                      Open {o.name}
                    </a>
                  ) : null}
                  <button type="button" onClick={() => void copy(o)} className="text-ink-2 underline">
                    {copied === o.platform ? "Copied" : "Copy text"}
                  </button>
                  {!o.shareUrl && canShareSheet ? (
                    <button
                      type="button"
                      onClick={() => void nativeShare(o)}
                      className="text-ink-2 underline"
                    >
                      Share sheet
                    </button>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] leading-[1.4] text-ink-3">{PUBLISH_DISCLAIMER}</p>
    </details>
  );
}
