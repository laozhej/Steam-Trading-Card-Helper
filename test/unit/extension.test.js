import test from "node:test";
import assert from "node:assert/strict";
import { completionCost, multibuyUrl } from "../../src/extension/scan.js";

test("one-set total uses actual lowest asks and propagates missing quotes", () => {
  assert.equal(completionCost([]), 0);
  assert.equal(completionCost([{ lowestCents: 12 }, { lowestCents: 25 }]), 37);
  assert.equal(completionCost([{ lowestCents: 12 }, { medianCents: 5 }]), null);
});

test("native market cart preserves exact item names and requests one of each", () => {
  const names = ["123-A+B & C", "123-#王牌 (Foil Trading Card)"];
  const url = new URL(multibuyUrl(names.map(marketHashName => ({ marketHashName }))));
  assert.equal(url.origin + url.pathname, "https://steamcommunity.com/market/multibuy");
  assert.equal(url.searchParams.get("appid"), "753");
  assert.deepEqual(url.searchParams.getAll("items[]"), names);
  assert.deepEqual(url.searchParams.getAll("qty[]"), ["1", "1"]);
});
