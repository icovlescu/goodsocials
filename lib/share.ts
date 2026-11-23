import type { Metadata } from "next";
import { BASE_PATH, withBase } from "@/lib/base-path";

/**
 * What a public page says about itself when its link is pasted somewhere:
 * LinkedIn, X, WhatsApp, Telegram, Slack, iMessage, Product Hunt.
 *
 * Next replaces `openGraph` and `twitter` whole rather than merging them, so a
 * page that sets only a title inherits the homepage's card and every shared
 * blog post would read as the homepage. Every public page goes through here
 * instead. The same replacement drops the picture that app/opengraph-image.png
 * would otherwise give every route below it, so the picture is named here too.
 * scripts/share-export.ts draws it.
 *
 * `path` sets the canonical URL, so a visit from ?ref=producthunt or a UTM link
 * counts toward the one page rather than a copy of it.
 */

/** The canonical host. The only one that appears anywhere a stranger reads. */
export const HOST = "https://goodsocials.co";

/** The canonical site: the host, plus /v2 on the pivot product. */
export const ORIGIN = `${HOST}${BASE_PATH}`;

export const SITE_NAME = "GoodSocials";

const IMAGE = {
  width: 1200,
  height: 630,
  alt: "GoodSocials, AI social media manager for LinkedIn. From $100 a month.",
  type: "image/png",
};

export function shareMetadata({
  path,
  title,
  description,
  openGraph,
}: {
  path: string;
  title: string;
  description: string;
  openGraph?: { type: "article"; publishedTime: string; modifiedTime?: string };
}): Metadata {
  // The site name already rides along as og:site_name, so the card carries
  // the page's own title without the suffix the browser tab needs.
  const cardTitle = title.replace(/ \| GoodSocials$/, "");
  return {
    title,
    description,
    alternates: { canonical: withBase(path) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: withBase(path),
      title: cardTitle,
      description,
      images: [{ url: withBase("/opengraph-image.png"), ...IMAGE }],
      ...openGraph,
    },
    twitter: {
      card: "summary_large_image",
      title: cardTitle,
      description,
      images: [{ url: withBase("/twitter-image.png"), ...IMAGE }],
    },
  };
}
