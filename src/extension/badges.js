import { currencies, estimate, multibuyUrl, pageCandidates } from "./scan.js";

function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function link(text, url) {
  const anchor = element("a", text);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function profilePath(href) {
  if (!href) return "";
  const url = new URL(href, location.href);
  return url.origin === location.origin
    ? url.pathname.match(/^\/(?:profiles\/\d+|id\/[^/]+)(?=\/|$)/i)?.[0].toLowerCase() || ""
    : "";
}

function resultRow(result, money) {
  const details = element("details");
  const summary = element("summary");
  const title = element("strong", result.name);
  if (result.isFoil) title.append(element("em", "闪卡"));
  const status = result.error ? "" : result.missing.length ? `缺 ${result.missing.length} 张` : "已集齐";
  const amount = element("b", result.error || (result.cost == null ? "缺价" : money.format(result.cost / 100)));
  if (result.cost == null) amount.className = "stch-unknown";
  summary.append(title, element("span", status), amount);
  details.append(summary);
  if (result.missing?.length) {
    const list = element("ul");
    for (const card of result.missing) {
      const item = element("li");
      const price = element("span", card.lowestCents == null ? "暂无售价" : money.format(card.lowestCents / 100));
      if (card.lowestCents == null) price.className = "stch-unknown";
      item.append(element("span", card.name), price);
      list.append(item);
    }
    details.append(list);
  }
  const actions = element("div");
  actions.className = "stch-links";
  actions.append(link("查看 Steam 卡组", result.href));
  if (result.cost > 0) actions.append(link("在 Steam 购买缺卡", multibuyUrl(result.missing)));
  details.append(actions);
  return details;
}

function mount() {
  if (!/^\/(?:id|profiles)\/[^/]+\/badges\/?$/i.test(location.pathname)) return;
  const sheet = document.querySelector(".badges_sheet");
  if (!sheet || document.getElementById("stch-completion")) return;
  const panel = element("section");
  panel.id = "stch-completion";
  panel.setAttribute("aria-label", "Steam 徽章补齐助手");
  const header = element("div");
  header.className = "stch-header";
  header.append(element("h2", "徽章补齐成本"));
  panel.append(header);
  sheet.before(panel);

  const account = profilePath(document.querySelector("#global_actions a.user_avatar")?.href);
  const owner = profilePath(document.querySelector(".profile_small_header_name a")?.href);
  if (!account || (account !== owner && account !== profilePath(location.href))) {
    header.append(link(account ? "打开我的徽章" : "登录 Steam 查看我的徽章",
      account ? location.origin + account + "/badges/" : "https://steamcommunity.com/my/badges/"));
    return;
  }

  const select = element("select");
  const label = element("label", "估价币种 ");
  for (const currency of currencies) select.add(new Option(currency.code, currency.id));
  try {
    const wallet = JSON.parse(document.getElementById("application_config")?.dataset.walletinfo || "{}");
    if (currencies.some(item => item.id === Number(wallet.wallet_currency))) select.value = wallet.wallet_currency;
  } catch { /* Keep the visible default when Steam omits wallet data. */ }
  label.append(select);
  const button = element("button", "扫描本页");
  button.type = "button";
  header.append(label, button);
  const status = element("p");
  status.setAttribute("role", "status");
  const results = element("div");
  panel.append(status, results);
  let controller = null;
  const reset = () => {
    results.replaceChildren();
    status.textContent = "";
    button.textContent = "扫描本页";
  };
  select.addEventListener("change", reset);
  button.addEventListener("click", async () => {
    if (controller) {
      controller.abort();
      return;
    }
    reset();
    const badges = pageCandidates(sheet, location.origin + account);
    if (!badges.length) {
      status.textContent = "本页没有卡牌徽章。";
      return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    const currency = currencies.find(item => item.id === Number(select.value));
    const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency.code });
    select.disabled = true;
    button.textContent = "停止扫描";
    let completed = 0;
    let skipped = 0;
    try {
      for (const badge of badges) {
        const progress = `正在扫描 ${completed + 1}/${badges.length} · ${badge.name}`;
        status.textContent = progress;
        let result;
        try {
          result = await estimate(badge, currency, signal, seconds => {
            status.textContent = seconds ? `${progress} · 等待市场查询额度（约 ${seconds} 秒）` : progress;
          });
        } catch (error) {
          if (signal.aborted || [403, 429].includes(error.status)) throw error;
          result = { ...badge, cost: null, error: "读取失败" };
        }
        signal.throwIfAborted();
        completed++;
        if (result.skipped) { skipped++; continue; }
        const row = resultRow(result, money);
        const cost = result.cost ?? Infinity;
        row.dataset.cost = cost;
        const next = [...results.children].find(other => Number(other.dataset.cost) > cost);
        results.insertBefore(row, next || null);
      }
      status.textContent = `已扫描 ${completed} 个徽章。` + (skipped ? `已跳过 ${skipped} 个满级徽章。` : "");
    } catch (error) {
      const reason = signal.aborted ? "已停止扫描" : error.status === 429
        ? "Steam 暂时限制了查价频率，请稍后重试" : "Steam 拒绝了请求，请检查登录状态后重试";
      status.textContent = `${reason}。已扫描 ${completed}/${badges.length}。`;
    } finally {
      select.disabled = false;
      button.textContent = "重新扫描";
      controller = null;
    }
  });
}

mount();
