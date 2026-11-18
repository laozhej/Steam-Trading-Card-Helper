import { parseGameCardsDocument } from "../parsers/gamecards.js";
import { reservePriceOverviewRequest } from "../request/price-overview-rate.js";
import { normalizePriceOverview } from "../services/market-data.js";
import { calculateResultPricingTotals } from "../services/pricing-estimate.js";
import { getGameCardsUrl } from "../utils/badge.js";

const origin = "https://steamcommunity.com";
export const currencies = [
  { id: 23, code: "CNY", symbol: /^(?:[¥￥]|CNY|RMB)\s*|\s*(?:CNY|RMB)$/i },
  { id: 1, code: "USD", symbol: /^(?:US\$|\$)\s*\d[\d,.\s]*(?:USD)?$/i },
  { id: 29, code: "HKD", symbol: /^HK\$\s*|\s*HKD$/i },
];

export function pageCandidates(sheet, profile) {
  const badges = new Map();
  for (const row of sheet.querySelectorAll(".badge_row")) {
    const link = row.querySelector("a.badge_row_overlay");
    if (!link) continue;
    const url = new URL(link.href);
    const match = url.pathname.match(/\/gamecards\/(\d+)\/?$/);
    if (url.origin !== origin || !match) continue;
    const appid = match[1];
    const isFoil = url.searchParams.get("border") === "1";
    const href = getGameCardsUrl(profile, appid, isFoil, { language: "english" });
    const title = row.querySelector(".badge_title")?.cloneNode(true);
    title?.querySelectorAll(".badge_view_details, .badge_title_stats").forEach(node => node.remove());
    const name = title?.textContent.replace(/(?:View details|查看详情|[\u200B-\u200D\uFEFF])/gi, "").trim() || appid;
    badges.set(href, { appid, isFoil, name, href });
  }
  return [...badges.values()];
}

export function readSet(html, badge) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slots = [...doc.querySelectorAll(".badge_card_set_card")];
  const purchase = doc.querySelector('a[href*="multibuy"]');
  // Some Steam pages link only the missing cards. Their indices are different
  // from the indices of the full set used by the upstream parser.
  const items = purchase ? new URL(purchase.getAttribute("href"), origin).searchParams.getAll("items[]") : [];
  purchase?.remove();
  const set = parseGameCardsDocument(doc, badge.appid, badge.isFoil);
  if (!slots.length || slots.length !== set.cards.length) throw new Error("无法读取卡牌清单");
  const missing = [];
  for (const card of set.cards) {
    const slot = slots[card.idx];
    if (slot.classList.contains("owned")) card.owned = Math.max(1, card.owned);
    if (!card.owned) missing.push(card);
  }
  const progress = doc.querySelector('meta[name="Description" i]')?.content.match(/(\d+) of (\d+) cards? collected/i);
  if (progress && (+progress[2] !== slots.length || +progress[1] !== slots.length - missing.length)) {
    throw new Error("卡牌清单与 Steam 收集进度不一致");
  }
  const ordered = items.length === slots.length ? set.cards : items.length === missing.length ? missing : [];
  const prefix = badge.appid + "-";
  for (const card of missing) {
    const direct = slots[card.idx].querySelector('a[href*="/market/listings/753/"]');
    const englishName = prefix + card.name + (badge.isFoil ? " (Foil Trading Card)" : "");
    const nativeName = items.includes(englishName) ? englishName : items[ordered.indexOf(card)];
    if (!direct && nativeName?.startsWith(prefix)) card.marketHashName = nativeName;
    else if (!direct && badge.isFoil && card.marketHashName === prefix + card.name) {
      card.marketHashName += " (Foil Trading Card)";
    }
    if (!card.marketHashName.startsWith(prefix)) throw new Error("无法匹配 Steam 市场物品");
  }
  if (new Set(missing.map(card => card.marketHashName)).size !== missing.length) throw new Error("卡牌资料重复");
  return { missing, maxLevel: set.level >= set.targetLevel };
}

export function multibuyUrl(cards) {
  const url = new URL("/market/multibuy", origin);
  url.searchParams.set("appid", "753");
  for (const card of cards) {
    url.searchParams.append("items[]", card.marketHashName);
    url.searchParams.append("qty[]", "1");
  }
  return url.href;
}

export function completionCost(cards) {
  return calculateResultPricingTotals({
    cards,
    hasIncompletePricing: cards.some(card => !(card.lowestCents > 0)),
  }, { minimumPriceMinor: 1 }).completionCents;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function request(url, signal) {
  const response = await fetch(url, {
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) {
    const error = new Error("Steam 返回 HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function estimate(badge, currency, signal, onWait) {
  const response = await request(badge.href, signal);
  const { missing, maxLevel } = readSet(await response.text(), badge);
  if (maxLevel) return { ...badge, skipped: true };
  for (const card of missing) {
    const url = new URL("/market/priceoverview/", origin);
    url.search = new URLSearchParams({
      appid: "753", currency: String(currency.id), market_hash_name: card.marketHashName, l: "english",
    }).toString();
    let delay;
    while ((delay = reservePriceOverviewRequest()) > 0) {
      onWait(Math.ceil(delay / 1000));
      await wait(delay, signal);
    }
    onWait(0);
    try {
      const payload = await (await request(url, signal)).json();
      if ([true, 1, "1"].includes(payload.success) && currency.symbol.test(payload.lowest_price || "")) {
        card.lowestCents = normalizePriceOverview(payload, {
          appid: "753", currencyId: currency.id, currencyCode: currency.code, marketHashName: card.marketHashName,
        })?.lowestSellMinor;
      }
    } catch (error) {
      if (signal.aborted || error.status === 429 || error.status === 403) throw error;
    }
  }
  return { ...badge, missing, cost: completionCost(missing) };
}
