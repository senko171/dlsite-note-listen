// ==UserScript==
// @name         DLsite 备注 & 试听
// @namespace    https://github.com/senko171/dlsite-note-listen
// @version      0.0.1
// @description  在优惠券板块上方加「备注 / 试听」双键；同作品不同语言版本共享数据；文件导出 / 导入备份恢复。
// @author       泫恰松鼠鱼
// @license      MIT
// @match        *://www.dlsite.com/*
// @match        *://dlsite.com/*
// @match        *://*.dlsite.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @homepageURL  https://github.com/senko171/dlsite-note-listen
// @supportURL   https://github.com/senko171/dlsite-note-listen/issues
// 更新地址必须是「会移动」的地址，不能钉死某个版本：
// 钉死 tag 会让「检查更新」永远看到同一版本，表现为「油猴无法更新」。
// 也不用 jsDelivr 的 @latest：它的 tag 解析缓存很顽固。这里用 GitHub
// 官方「最新 release 附件」永久地址，内容永远指向最新一版、无解析缓存。
// @updateURL https://github.com/senko171/dlsite-note-listen/releases/latest/download/dlsite-note-listen.user.js
// @downloadURL https://github.com/senko171/dlsite-note-listen/releases/latest/download/dlsite-note-listen.user.js
// ==/UserScript==

/*
 * DLsite 备注 & 试听 · 独立版
 * ---------------------------------------------------------------
 * 外观规则参考 dlsite-best-deal v0.6.104 的 browse-analysis-frame：
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------- 常量

  const HOST_CLASS = "dlwb-host";
  const STORE_KEY = "dlwb-note-listen-v1";
  const STYLE_ID = "dlwb-userscript-style";
  const BACKUP_PREFIX = "DLWB1:";
  const ID_RE = /^[RBV]J\d{6,}$/i;
  const URL_ID_RE = /product_id\/([RBV]J\d{6,})/i;
  const INFO_API = "/maniax/product/info/ajax";
  const BATCH_SIZE = 10;
  const FETCH_TIMEOUT_MS = 9000;
  const FAMILY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------- 更新自检
  // 移植自 dlsite-best-deal 的同名机制：定时问 GitHub 最新版本，有新版弹提示。
  // 注意：改版本时 @version 和这里的 APP_VERSION 要一起改。
  const APP_VERSION = "0.0.1";
  const UPDATE_REPO = "senko171/dlsite-note-listen";
  const UPDATE_BANNER_CLASSNAME = "dlwb-update-banner";
  const UPDATE_CHECK_STORAGE_KEY = "dlwb-update-check-at";
  const UPDATE_DISMISSED_VERSION_KEY = "dlwb-update-dismissed-version";
  const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  // 两个源都可能缓存到旧版（GitHub API 优先，jsDelivr 兜底），都查、取更大的那个。
  const UPDATE_LATEST_SOURCES = [
    {
      url: `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      pick: (json) => json && json.tag_name,
    },
    {
      url: `https://data.jsdelivr.com/v1/packages/gh/${UPDATE_REPO}/resolved?specifier=latest`,
      pick: (json) => json && json.version,
    },
  ];

  const PRODUCT_PRICE_HOST_SELECTORS = [
    "#work_price .work_buy_container",
    "#work_price",
    "#work_buy",
    ".c-purchaseBox__priceInfo",
    ".c-purchaseBox__value",
    ".work_buy_container",
    ".work_buy_content",
    ".work_price_wrap",
    '[data-testid*="price"]',
  ];

  const CARD_SELECTORS = [
    "li.search_result_img_box_inner[data-workno]",
    ".search_result_img_box_inner[data-workno]",
    "tr[data-list_item_product_id]",
    "article[data-workno]",
    "li[data-workno]",
    '[data-vue-component="product-item"][data-product_id]',
    "li.cart_list_item",
    "li.n_work_list_item",
    ".n_worklist_item",
    ".product-item",
    // 收藏夹 / 稍后再买等页面的卡片外壳
    "#wishlist_work article",
    "#wishlist_work li",
    '[id*="wishlist_work"] article',
    '[id*="wishlist"] article',
    '[id*="wishlist"] li',
    ".wishlist_work article",
    ".wishlist_work li",
    ".item[data-workno]",
  ];

  const LINK_PARENT_SELECTORS = [
    "li",
    "article",
    "tr[data-list_item_product_id]",
    "tr[data-product_id]",
    ".search_result_img_box_inner",
    ".product-item",
    ".n_worklist_item",
    ".work",
    ".item",
    ".wishlist_work_item",
  ];

  // 主页 / 分类页「排行」板块：信息密度已很高，不在此处叠加双键。
  // 兼容桌面与触屏：容器类名、整页排行 URL、以及带「排行 / ランキング」标题的区块。
  const RANKING_SELECTORS = [
    '[class*="ranking"]',
    '[id*="ranking"]',
    '[class*="rank_list"]',
    '[class*="rankList"]',
    '[class*="rankBox"]',
    '[class*="RankBox"]',
    '[class*="rank"]',
    '[id*="rank"]',
    ".n_ranking",
    ".ranking",
  ];

  const RANKING_TEXT_RE = /排行|ランキング|ランク|ranking|rank\b|順位/i;

  // 整页就是排行页（如 /maniax/rank/...）：这一页所有作品卡都不加双键。
  function isRankingPage() {
    return /\/(?:rank|ranking)\b/i.test(location.href);
  }

  // 往上找祖先区块，若其直接子标题含有排行关键词，则视为排行板块。
  function ancestorHasRankingHeading(node) {
    let el = node.parentElement;
    for (let i = 0; i < 6 && el; i += 1) {
      const heading = el.querySelector(
        ":scope > h1, :scope > h2, :scope > h3, :scope > h4, " +
        ":scope > [class*=\"heading\"], :scope > [class*=\"title\"]",
      );
      if (heading && RANKING_TEXT_RE.test(heading.textContent || "")) return true;
      el = el.parentElement;
    }
    return false;
  }

  function inRankingSection(node) {
    if (!node || typeof node.closest !== "function") return false;
    if (isRankingPage()) return true;
    if (node.closest(RANKING_SELECTORS.join(","))) return true;
    return ancestorHasRankingHeading(node);
  }


  const COMMENT_SECTION_SELECTORS = [
    "#work_review",
    ".review_area",
    ".review_list",
    ".review_item",
    ".impression_area",
    ".impression_list",
    ".comment_area",
    ".comment_list",
    '[id*="work_review"]',
    '[id*="impression"]',
    '[class*="review_area"]',
    '[class*="review_list"]',
    '[class*="review_item"]',
    '[class*="impression_list"]',
    '[class*="comment_area"]',
    '[class*="comment_list"]',
  ];

  function inCommentSection(node) {
    if (!node || typeof node.closest !== "function") return false;
    return Boolean(node.closest(COMMENT_SECTION_SELECTORS.join(",")));
  }

  // 可能出现的「优惠券插件 UI」。只用来决定谁排前面，不依赖它们存在。
  const REF_UI_SELECTORS = [
    ".dltracker-browse-analysis-host",
    ".dltracker-mobile-product-host",
    ".dltracker-cart-host",
    ".dltracker-lowest-price-card",
    ".dltracker-browse-analysis",
    ".dltracker-cart-layout",
    ".dltracker-deal-insight",
    ".dltracker-inline-host",
    ".dltracker-wishlist-host",
  ];

  // 详情页里优惠券插件会往价格容器里并列 append 好几个顶层节点：
  // 史低卡 → 可用优惠券框 → 「比较语言版本」按钮。双键要接在最后一个后面。
  // 这里单独列，不改动卡片页用的 REF_UI_SELECTORS。
  const DETAIL_REF_TAIL_SELECTORS = REF_UI_SELECTORS.concat([
    ".dltracker-language-entry",
    ".dltracker-language-entry-detail",
    ".dltracker-language-entry-button",
    ".dltracker-deal-detail",
    ".dltracker-deal-compact",
  ]);

  // ---------------------------------------------------------------- 工具

  const now = () => Date.now();

  // 备注弹窗左下角显示的时间：本地时间，精确到分钟。
  function formatNoteTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "尚未保存";
    const date = new Date(value);
    const pad = (number) => ("0" + number).slice(-2);
    return date.getFullYear() + "年" + pad(date.getMonth() + 1) + "月" +
      pad(date.getDate()) + "日 " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function normId(value) {
    return String(value || "").toUpperCase();
  }

  function validId(value) {
    return ID_RE.test(normId(value));
  }

  function matchesIdFrom(text) {
    const matched = String(text || "").match(/([RBV]J\d{6,})/i);
    return matched ? normId(matched[1]) : null;
  }

  function unique(list) {
    return [...new Set(list.filter(Boolean))];
  }

  function firstBySelectors(selectors, root) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function isTouchPath() {
    return /-touch\//i.test(location.href);
  }

  function isNarrowViewport() {
    try {
      return window.matchMedia("(max-width: 900px)").matches;
    } catch (_) {
      return window.innerWidth <= 900;
    }
  }

  // 作品页肯定有购买区；列表页只有作品卡价格，不会有这些容器。
  function hasProductContainer() {
    return Boolean(
      firstBySelectors(PRODUCT_PRICE_HOST_SELECTORS, document) ||
      document.querySelector(".c-purchaseBox") ||
      document.querySelector(".c-purchaseBox__inner") ||
      document.querySelector(".c-purchaseBox__purchase") ||
      document.querySelector("#work_buy")
    );
  }

  // 少数落地页 / SPA 会把地址栏里的 product_id 改写掉，这时从页面自身的
  // 规范链接或唯一作品编号补一个 id，避免整页双键都不渲染。
  function detailIdFromDocument() {
    const sources = [
      document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      document.querySelector('input[name="product_id"]')?.getAttribute("value"),
      document.querySelector('meta[name="twitter:url"]')?.getAttribute("content"),
    ];
    for (const source of sources) {
      const id = matchesIdFrom(source);
      if (id) return id;
    }
    if (!hasProductContainer()) return null;
    const ids = unique([...document.querySelectorAll("[data-product_id], [data-workno]")]
      .map((node) => matchesIdFrom(
        node.getAttribute("data-product_id") || node.getAttribute("data-workno"))));
    return ids.length === 1 ? ids[0] : null;
  }

  function isProductPage() {
    return /\/product_id\/[RBV]J\d+/i.test(location.href) ||
      Boolean(detailIdFromDocument()) ||
      hasProductContainer();
  }

  function isCartPage() {
    return /\/cart(?:[/?#]|$)/i.test(location.href);
  }

  function idFromUrl() {
    const matched = location.href.match(URL_ID_RE) ||
      location.href.match(/([RBV]J\d{6,})/i);
    return matched ? normId(matched[1]) : detailIdFromDocument();
  }

  // 一键一行」
  function shouldStack() {
    if (isTouchPath()) return true;
    try {
      const query = window.matchMedia("(hover: none) and (pointer: coarse)");
      if (typeof query?.matches === "boolean") return query.matches;
    } catch (_) { /* 老内核没有 matchMedia */ }
    return Number(window.navigator?.maxTouchPoints || 0) > 0;
  }

  function productIdFromNode(node) {
    const values = [
      node?.getAttribute?.("data-workno"),
      node?.getAttribute?.("data-list_item_product_id"),
      node?.getAttribute?.("data-product_id"),
      node?.getAttribute?.("data-product-id"),
      node?.id,
      node?.querySelector?.('a[href*="product_id/"]')?.getAttribute("href"),
    ];
    return matchesIdFrom(values.filter(Boolean).join(" "));
  }

  // ---------------------------------------------------------------- 数据层

  function emptyState() {
    return { v: 1, items: {}, families: {}, familyFails: {}, updatedAt: 0 };
  }

  let state = emptyState();

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return emptyState();
      return {
        v: 1,
        items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
        families: parsed.families && typeof parsed.families === "object" ? parsed.families : {},
        familyFails: parsed.familyFails && typeof parsed.familyFails === "object" ? parsed.familyFails : {},
        updatedAt: Number(parsed.updatedAt) || 0,
      };
    } catch (_) {
      return emptyState();
    }
  }

  function saveState() {
    state.updatedAt = now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("[DLsite 双键] 本地存储写入失败：", error);
      toast("保存失败：浏览器存储空间不足，请先导出备份", true);
    }
  }

  // 家族 id 可能链式指向另一个家族（后解析出原作时才收敛），跟随解析。
  function familyKey(id) {
    let key = normId(id);
    const visited = new Set();
    for (let i = 0; i < 6; i += 1) {
      if (visited.has(key)) break;
      visited.add(key);
      const next = normId(state.families[key]);
      if (!next || next === key || !validId(next)) break;
      key = next;
    }
    return key;
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== "object") return null;
    return {
      note: typeof record.note === "string" ? record.note : "",
      listened: record.listened === true,
      updatedAt: Number(record.updatedAt) || 0,
    };
  }

  // 两条记录按「较新者为准」合并，用于：家族收敛 / 导入备份 / 跨标签同步。
  function mergeRecord(a, b) {
    const left = normalizeRecord(a);
    const right = normalizeRecord(b);
    if (!left) return right;
    if (!right) return left;
    // 备注与试听属于同一份记录：一律「后操作的胜出」，
    // 这样主动清空备注 / 取消试听都能生效，不会被旧备份复活。
    // 时间相同时保留已有记录，避免同一毫秒内的旧备份把新数据顶掉。
    const newer = right.updatedAt > left.updatedAt ? right : left;
    return {
      note: newer.note,
      listened: newer.listened,
      updatedAt: Math.max(left.updatedAt, right.updatedAt),
    };
  }

  function getItem(id) {
    return normalizeRecord(state.items[familyKey(id)]) ||
      { note: "", listened: false, updatedAt: 0 };
  }

  function setItem(id, patch) {
    const key = familyKey(id);
    const current = getItem(id);
    state.items[key] = {
      note: typeof patch.note === "string" ? patch.note : current.note,
      listened: typeof patch.listened === "boolean" ? patch.listened : current.listened,
      updatedAt: now(),
    };
    saveState();
    refreshAll();
  }

  // 把散落在「各语言版本自身编号为 key」的记录收敛到家族 key。
  function normalizeAllItems() {
    let changed = false;
    for (const key of Object.keys(state.items)) {
      const target = familyKey(key);
      if (!target || target === key) continue;
      const merged = mergeRecord(state.items[target], state.items[key]);
      if (merged) state.items[target] = merged;
      delete state.items[key];
      changed = true;
    }
    if (changed) saveState();
  }

  // 登记一组同作品的多语言编号。登记前后都做一次数据收敛，
  // 这样「先写备注、后识别出语言家族」也不会丢数据。
  function registerFamily(ids, familyId) {
    let canonical = normId(familyId);
    if (!validId(canonical)) return false;
    const resolved = familyKey(canonical);
    if (validId(resolved)) canonical = resolved;
    const group = unique([...ids, canonical].map(normId)).filter(validId);
    if (group.length < 2) return false;

    const before = new Map();
    for (const id of group) before.set(id, familyKey(id));

    for (const id of group) {
      state.families[id] = canonical;
      delete state.familyFails[id];
    }
    state.families[canonical] = canonical;

    for (const id of group) {
      const oldKey = before.get(id);
      const newKey = familyKey(id);
      if (oldKey === newKey || !state.items[oldKey]) continue;
      const merged = mergeRecord(state.items[newKey], state.items[oldKey]);
      if (merged) state.items[newKey] = merged;
      delete state.items[oldKey];
    }
    normalizeAllItems();
    saveState();
    refreshAll();
    return true;
  }

  // ---------------------------------------------------------------- 语言家族识别

  function parseTranslationInfo(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(String(raw).replace(/&quot;/g, '"'));
    } catch (_) {
      return null;
    }
  }

  // 翻译版 → original_workno（原作编号）；原作 → 自身；其余 → parent_workno。
  function familyFromInfo(id, info) {
    const own = normId(id);
    const original = normId(info?.original_workno);
    const parent = normId(info?.parent_workno);
    if (validId(original)) return original;
    if (info?.is_original) return own;
    if (info?.is_child && validId(parent)) return parent;
    if (validId(parent)) return parent;
    return own;
  }

  function recordsFromPayload(payload) {
    const map = new Map();
    const push = (key, value) => {
      if (!value || typeof value !== "object") return;
      const id = matchesIdFrom([key, value.product_id, value.workno, value.id]
        .filter(Boolean).join(" "));
      if (id && !map.has(id)) map.set(id, value);
    };
    if (Array.isArray(payload)) {
      payload.forEach((value, index) => push(String(index), value));
    } else if (Array.isArray(payload?.products)) {
      payload.products.forEach((value, index) => push(String(index), value));
    } else if (payload?.products && typeof payload.products === "object") {
      Object.entries(payload.products).forEach(([key, value]) => push(key, value));
    } else if (payload && typeof payload === "object") {
      Object.entries(payload).forEach(([key, value]) => push(key, value));
    }
    return map;
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      if (typeof fetch === "function") {
        const controller = typeof AbortController === "function"
          ? new AbortController() : null;
        const timer = setTimeout(() => {
          try { controller?.abort(); } catch (_) { /* noop */ }
          reject(new Error("请求超时"));
        }, FETCH_TIMEOUT_MS);
        fetch(url, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
          ...(controller ? { signal: controller.signal } : {}),
        }).then(async (response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          resolve(await response.text());
        }).catch(reject).finally(() => clearTimeout(timer));
        return;
      }
      // 极老 WebView 没有 fetch 时的兜底，主功能完全不受影响。
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.timeout = FETCH_TIMEOUT_MS;
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
          ? resolve(xhr.responseText) : reject(new Error("HTTP " + xhr.status));
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.ontimeout = () => reject(new Error("请求超时"));
        xhr.send();
      } catch (error) {
        reject(error);
      }
    });
  }

  let familyFetchRunning = false;

  async function ensureFamilies(ids) {
    const pending = unique(ids.map(normId)).filter((id) => {
      if (!validId(id) || state.families[id]) return false;
      const failedAt = Number(state.familyFails[id]) || 0;
      return !failedAt || now() - failedAt > FAMILY_RETRY_MS;
    });
    if (!pending.length || familyFetchRunning) return;
    familyFetchRunning = true;
    try {
      for (let start = 0; start < pending.length; start += BATCH_SIZE) {
        const batch = pending.slice(start, start + BATCH_SIZE);
        let parsed = null;
        try {
          const url = new URL(INFO_API, location.origin);
          url.searchParams.set("product_id", batch.join(","));
          parsed = JSON.parse(await requestText(url.href));
        } catch (_) {
          for (const id of batch) state.familyFails[id] = now();
          continue;
        }
        const records = recordsFromPayload(parsed);
        for (const id of batch) {
          const record = records.get(id);
          if (!record) {
            state.familyFails[id] = now();
            continue;
          }
          const info = parseTranslationInfo(record.translation_info) || {};
          const familyId = familyFromInfo(id, info);
          const children = Array.isArray(info.child_worknos)
            ? info.child_worknos
            : String(info.child_worknos || "").split(/[,\s]+/);
          const group = unique([id, familyId, ...children].map(normId)).filter(validId);
          if (group.length > 1) registerFamily(group, familyId);
          else {
            state.families[id] = familyId;
            delete state.familyFails[id];
          }
        }
        normalizeAllItems();
        saveState();
        refreshAll();
      }
    } finally {
      familyFetchRunning = false;
    }
  }

  // 详情页 DOM 里的语言版本选择器，零请求、可离线建立映射。
  function readEditionsFromDocument() {
    const selector = document.querySelector(
      '[data-vue-component="language-edition-selector"][data-language-editions]',
    );
    let editions = [];
    try {
      editions = JSON.parse(
        (selector?.getAttribute("data-language-editions") || "[]")
          .replace(/&quot;/g, '"'),
      );
    } catch (_) { /* noop */ }
    if (!Array.isArray(editions)) return;
    const entries = editions.map((item) => ({
      id: normId(item?.workno || item?.product_id || item?.parentId),
      lang: String(item?.lang || "").toUpperCase(),
    })).filter((item) => validId(item.id));
    if (entries.length < 2) return;
    const japanese = entries.find((item) => /JPN|JA\b/.test(item.lang));
    const familyId = japanese?.id || [...entries.map((item) => item.id)].sort()[0];
    registerFamily(entries.map((item) => item.id), familyId);
  }

  // ---------------------------------------------------------------- 样式

  // ---------------------------------------------------------------- 更新自检实现

  function versionTuple(value) {
    return String(value || "")
      .replace(/^v/i, "")
      .trim()
      .split(".")
      .map((part) => {
        const number = Number.parseInt(part, 10);
        return Number.isFinite(number) ? number : 0;
      });
  }

  function versionIsNewer(candidate, baseline) {
    const left = versionTuple(candidate);
    const right = versionTuple(baseline);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const a = left[index] || 0;
      const b = right[index] || 0;
      if (a !== b) return a > b;
    }
    return false;
  }

  async function fetchLatestPublishedVersion() {
    let newest = "";
    for (const source of UPDATE_LATEST_SOURCES) {
      try {
        const json = JSON.parse(await requestText(source.url));
        const version = String(source.pick(json) || "").replace(/^v/i, "").trim();
        if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
        // 任一源被缓存到旧版都不能当结论：取两个源里更大的那个。
        if (!newest || versionIsNewer(version, newest)) newest = version;
      } catch (error) {
        console.warn("[DLsite 双键] 更新检查失败：", source.url, error);
      }
    }
    return newest;
  }

  function getDismissedUpdateVersion() {
    try {
      return String(localStorage.getItem(UPDATE_DISMISSED_VERSION_KEY) || "");
    } catch (_) { return ""; }
  }

  function setDismissedUpdateVersion(version) {
    try { localStorage.setItem(UPDATE_DISMISSED_VERSION_KEY, String(version)); }
    catch (_) { /* noop */ }
  }

  function getLastUpdateCheck() {
    try { return Number(localStorage.getItem(UPDATE_CHECK_STORAGE_KEY) || 0); }
    catch (_) { return 0; }
  }

  function setLastUpdateCheck(stamp) {
    try { localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, String(stamp)); }
    catch (_) { /* noop */ }
  }

  // 「去更新」指向钉死版本的安装地址：脚本头部 updateURL 走 latest 自动升级，
  // 这条手动链接钉死到版本 tag，避免 latest 解析缓存导致装到旧版。
  function updateInstallUrl(version) {
    return `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@v${version}/userscript/dlsite-note-listen.user.js`;
  }

  function showUpdateBanner(version, force) {
    if (!versionIsNewer(version, APP_VERSION)) return false;
    if (!force && getDismissedUpdateVersion() === version) return false;
    if (document.querySelector("." + UPDATE_BANNER_CLASSNAME)) return false;
    injectStyle();
    const bar = document.createElement("div");
    bar.className = UPDATE_BANNER_CLASSNAME;
    const text = document.createElement("span");
    text.textContent = `有新版本 v${version}（当前 v${APP_VERSION}）`;
    const link = document.createElement("a");
    link.href = updateInstallUrl(version);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "去更新";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => {
      setDismissedUpdateVersion(version);
      bar.remove();
    });
    bar.append(text, link, close);
    (document.body || document.documentElement).appendChild(bar);
    return true;
  }

  // 成功后才记时间戳，失败不记：网络恢复后下次打开页面还能重试。
  // force=true 时忽略 6 小时节流，供「检查更新」按钮手动触发并给出结果反馈。
  async function checkForNewVersion(force) {
    const stamp = getLastUpdateCheck();
    if (!force && Number.isFinite(stamp) && Date.now() - stamp < UPDATE_CHECK_INTERVAL_MS) return;
    const version = await fetchLatestPublishedVersion();
    if (!version) {
      if (force) toast("检查更新失败：暂时读不到版本信息，请稍后重试", true);
      return;
    }
    setLastUpdateCheck(Date.now());
    const shown = showUpdateBanner(version, force);
    if (force && !shown) toast("已是最新版本 v" + APP_VERSION);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
/* ===== 宿主：与 dltracker-*-host 同规格，保证「顶格」 ===== */
.${HOST_CLASS} {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  clear: both;
  container-type: inline-size;
  overflow: hidden;
}
.n_work_item > .${HOST_CLASS},
dl > .${HOST_CLASS} {
  grid-column: 1 / -1;
  width: auto;
  max-width: 100%;
  align-self: stretch;
}

/* ===== 详情页专用：宿主只做「独占一行的兄弟节点」 =====
   绝不进入 .c-purchaseBox__purchase 之类原生按键容器：
   进去会触发 :first-child / flex gap，把加入购物车、收藏夹挤成一团，
   还会被站点样式隐藏。以下 !important 只作用于详情页宿主，其它页面不变。 */
.${HOST_CLASS}[data-mode="detail"] {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  position: static !important;
  float: none !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  width: 100% !important;
  max-width: 100% !important;
  flex: 0 0 100% !important;
  grid-column: 1 / -1 !important;
  margin: 0 0 10px !important;
  padding: 0 !important;
  clear: both !important;
}
.${HOST_CLASS}[data-mode="detail"] .dlwb-frame {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  min-height: 23px !important;
  height: auto !important;
  margin: 0 !important;
  padding: 2px 3px !important;
  border: 1px solid #d4dee4 !important;
  border-radius: 5px !important;
  background: #fff !important;
  color: #40515b !important;
  font-family: inherit !important;
  font-size: inherit !important;
  font-weight: 400 !important;
  line-height: 1.15 !important;
  text-align: center !important;
  white-space: nowrap !important;
  overflow: hidden !important;
}
.${HOST_CLASS}[data-mode="detail"] .dlwb-frame.is-note {
  border-color: #a8cbf0 !important; color: #24578f !important; background: #e4f0ff !important;
}
.${HOST_CLASS}[data-mode="detail"] .dlwb-frame.is-listened {
  border-color: #f0b7d1 !important; color: #9c3f6c !important; background: #ffe4ef !important;
}
.${HOST_CLASS}[data-mode="detail"] .dlwb-card.is-stacked .dlwb-frame { width: 100% !important; }

/* ===== 卡片容器：与 dltracker-lowest-price-card / browse-analysis 同规格 ===== */
.dlwb-card {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  max-width: 100%;
  box-sizing: border-box;
}
.dlwb-card.dlwb-analysis {
  width: 100%;
  max-width: 100%;
  margin: 5px 0 0;
  gap: 4px;
  color: #40515b;
  font-size: 8px;
}
.dlwb-card.dlwb-analysis.is-detail { margin: 2px 0 6px; }

/* ===== 排布：桌面两列，触屏一键一行 ===== */
.dlwb-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) max-content;
  align-items: stretch;
  gap: 2px;
  width: 100%;
  min-width: 0;
}
.dlwb-card.is-stacked .dlwb-grid {
  grid-template-columns: minmax(0, 1fr);
}

/* ===== 按键：与 dltracker-browse-analysis-frame 逐值一致 ===== */
.dlwb-frame {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  min-height: 23px;
  padding: 2px 3px;
  border: 1px solid #d4dee4;
  border-radius: 5px;
  box-sizing: border-box;
  color: #40515b;
  background: #fff;
  font: inherit;
  line-height: 1.15;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.dlwb-card.is-stacked .dlwb-frame { width: 100%; }
.dlwb-frame > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button.dlwb-frame:focus-visible { outline: 2px solid #4f7f9d; outline-offset: 1px; }
.dlwb-frame:active { filter: brightness(0.96); }

/* 已键入备注：明度与粉底相近的浅蓝 */
.dlwb-frame.is-note {
  border-color: #a8cbf0;
  color: #24578f;
  background: #e4f0ff;
}
/* 已试听：浅粉 */
.dlwb-frame.is-listened {
  border-color: #f0b7d1;
  color: #9c3f6c;
  background: #ffe4ef;
}

@media (max-width: 768px) {
  .dlwb-card { margin-top: 6px; gap: 5px; font-size: 12px; }
  .dlwb-card.dlwb-analysis { margin: 5px 0 0; gap: 4px; font-size: 8px; }
  .dlwb-card.dlwb-analysis.is-detail { margin: 2px 0 8px; }
}

/* ===== 备注输入 / 备份面板 ===== */
.dlwb-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(24, 34, 42, 0.42);
  box-sizing: border-box;
}
.dlwb-modal {
  width: 100%;
  max-width: min(94vw, 460px);
  max-height: 86vh;
  overflow: auto;
  padding: 14px;
  border: 1px solid #d5dfe5;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(20, 32, 42, 0.24);
  box-sizing: border-box;
  color: #34434c;
  font-size: 13px;
  line-height: 1.5;
}
.dlwb-modal h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  color: #2c4657;
}
.dlwb-modal p { margin: 0 0 10px; color: #6a7a84; font-size: 12px; }
.dlwb-textarea {
  display: block;
  width: 100%;
  min-height: 92px;
  padding: 8px 10px;
  border: 1px solid #bdc9d0;
  border-radius: 7px;
  background: #fff;
  color: #34434c;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}
.dlwb-modal p.dlwb-note-time {
  margin: 6px 0 0;
  font-size: 11px;
  color: #7a8790;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.dlwb-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.dlwb-actions button,
.dlwb-backup button,
.dlwb-file-label {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid #aebdc6;
  border-radius: 6px;
  background: #fff;
  color: #344b58;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  box-sizing: border-box;
}
.dlwb-actions button.is-primary {
  border-color: #2f6fa8;
  background: #e4f0ff;
  color: #24578f;
  font-weight: 700;
}
.dlwb-actions button:hover,
.dlwb-backup button:hover,
.dlwb-file-label:hover { border-color: #52758a; background: #f2f7fa; }
.dlwb-backup {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #d5dfe5;
}
.dlwb-backup > strong { display: block; margin-bottom: 4px; font-size: 12px; color: #4a5b66; }
.dlwb-backup-row { display: flex; flex-wrap: wrap; gap: 6px; }
.dlwb-backup-row button, .dlwb-file-label { min-height: 28px; padding: 3px 9px; font-size: 11px; }
.dlwb-hint { margin: 7px 0 0 !important; font-size: 11px !important; color: #88959d !important; }
.dlwb-file-input { display: none; }
.dlwb-toast {
  position: fixed;
  left: 50%;
  bottom: calc(48px + env(safe-area-inset-bottom, 0px));
  z-index: 2147483600;
  max-width: min(88vw, 460px);
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(38, 92, 130, 0.96);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  transform: translateX(-50%);
  pointer-events: none;
}
.dlwb-toast.is-error { background: rgba(178, 45, 45, 0.97); }

/* ===== 新版本提示条（与参考插件 update-banner 同款，右下角可关闭） ===== */
.${UPDATE_BANNER_CLASSNAME} {
  position: fixed;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 2147483600;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(90vw, 420px);
  padding: 9px 12px;
  border: 1px solid #b9d9f2;
  border-radius: 8px;
  background: #eef7ff;
  color: #24578f;
  font: 12px/1.5 system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
}
.${UPDATE_BANNER_CLASSNAME} a {
  color: #0b6cc4;
  font-weight: 700;
  text-decoration: underline;
  white-space: nowrap;
}
.${UPDATE_BANNER_CLASSNAME} button {
  border: 0;
  background: transparent;
  color: #7a90a4;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------- 定位

  function findRefUI(root) {
    const all = [...root.querySelectorAll(REF_UI_SELECTORS.join(","))]
      .filter((node) => !node.closest("." + HOST_CLASS));
    if (!all.length) return null;
    // 双键必须是购买区的兄弟节点，绝不能塞进它内部。
    const outermost = all.find((node) =>
      !all.some((other) => other !== node && other.contains(node)));
    return outermost || all[0];
  }

  function findTagAnchor(card) {
    const selectors = [
      ".work_genre", ".n_work_genre", ".work_tags", ".work_tag",
      ".work_deals", ".work_labels", ".search_tag",
      "[class*='genre_list']", "[class*='tag_list']",
    ];
    const found = selectors.flatMap((selector) =>
      [...card.querySelectorAll(selector)]
        .filter((node) => !node.closest("." + HOST_CLASS)));
    return found.at ? found.at(-1) : found[found.length - 1] || null;
  }

  // 部分作品页的价格容器类名不走标准命名，
  // 但带 price 的 id / class 且文案里有货币单位，仍然是购买区。
  function findPriceHostFuzzy() {
    const candidates = document.querySelectorAll('[id*="price"], [class*="price"]');
    for (const element of candidates) {
      if (element.closest("." + HOST_CLASS)) continue;
      const text = (element.textContent || "").replace(/\s+/g, " ");
      if (/円|jpy|rmb|¥/i.test(text)) return element;
    }
    return null;
  }

  // 详情用（卡片页逻辑完全不变）。
  function findDetailRefTail() {
    const all = [...document.querySelectorAll(DETAIL_REF_TAIL_SELECTORS.join(","))]
      .filter((node) => !node.closest("." + HOST_CLASS) &&
        !node.closest(CARD_SELECTORS.join(",")) &&
        !node.closest(".dltracker-reach-dialog, .dltracker-overlay"));
    if (!all.length) return null;
    const outer = all.filter((node) =>
      !all.some((other) => other !== node && other.contains(node)));

    const byParent = new Map();
    for (const node of outer) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(node);
    }
    let best = null;
    for (const list of byParent.values()) {
      if (!best || list.length > best.length) best = list;
    }
    return best ? best[best.length - 1] : null;
  }

  // 原生「加入购物车 / 立即购买 / 收藏夹」所在的容器：
  // 双键宿主绝不能成为它的子元素，只能做它的兄弟节点。
  function isDetailActionBlock(node) {
    if (!node || typeof node.matches !== "function") return false;
    const cls = String(node.className || "");
    if (/c-purchaseBox__purchase|purchaseBtn|buyBtn|cartBtn|btnArea|buttonArea|actionBtns/i.test(cls)) {
      return true;
    }
    return [...(node.children || [])].some((child) =>
      /加入购物车|立即购买|添加至收藏夹|カートに入れる|今すぐ購入/i.test(child.textContent || "") &&
      child.matches?.("button, a, input"));
  }

  function findLanguageBlock() {
    const label = /^\s*(语言选择|語言選擇|言語選択|言語を選択|Language(?:\s*Selection)?)\s*[:：]?\s*$/i;
    const zone = "#work_buy, #work_price, .c-purchaseBox, .work_buy_container, " +
      "[class*='purchaseBox'], [class*='work_buy']";
    let fallback = null;
    for (const node of document.querySelectorAll("h2,h3,h4,dt,legend,strong,label,p,div,span")) {
      if (node.children.length || !label.test(node.textContent || "")) continue;
      // 页头导航里的「语言选择」不是作品页那个语言版本区，跳过。
      if (node.closest("header, nav, footer, #header, #footer, .header, .footer")) continue;
      const inZone = Boolean(node.closest(zone));
      let block = node;
      for (let i = 0; i < 3 && block.parentElement; i++) {
        const parent = block.parentElement;
        if (parent === document.body ||
          parent.matches?.("#work_buy, .c-purchaseBox, #work_price") ||
          isDetailActionBlock(parent)) break;
        block = parent;
      }
      if (inZone) return block;
      if (!fallback) fallback = block;
    }
    return fallback || document.querySelector(
      '[data-vue-component="language-edition-selector"], .language-edition-selector, ' +
      '[class*="language_edition"], [class*="languageSelect"], [class*="language-select"]',
    );
  }

  function findDetailMount() {
    //    参考脚本在桌面端把 UI 挂进原生价格宿主（#work_price/.work_buy_container…），
    //    触屏端 prepend 进 .c-purchaseBox__purchase；双键都接在它后面。
    const ref = findDetailRefTail();
    if (ref?.parentElement && !isDetailActionBlock(ref.parentElement)) {
      return { parent: ref.parentElement, mode: "detail", before: ref.nextSibling };
    }
    if (ref?.parentElement && isDetailActionBlock(ref.parentElement)) {
      const block = ref.parentElement;
      if (block.parentElement) {
        return { parent: block.parentElement, mode: "detail", before: block };
      }
    }

    // 触屏 / 窄屏：把宿主 prepend 进 .c-purchaseBox__purchase，
    //    我们坐在该购买区上方那一行（同一购买区内、按键之上）。
    if (isTouchPath() || isNarrowViewport()) {
      const inner = document.querySelector(".c-purchaseBox__inner");
      const purchase = inner
        ? (inner.querySelector(":scope > .c-purchaseBox__purchase") ||
           inner.querySelector(".c-purchaseBox__purchase"))
        : document.querySelector(".c-purchaseBox__purchase");
      if (purchase?.parentElement) {
        return { parent: purchase.parentElement, mode: "detail", before: purchase };
      }
    }

    const priceHost = firstBySelectors(PRODUCT_PRICE_HOST_SELECTORS, document);
    if (priceHost && !isDetailActionBlock(priceHost)) {
      return { parent: priceHost, mode: "detail", before: null };
    }

    const lang = findLanguageBlock();
    if (lang?.parentElement && !isDetailActionBlock(lang.parentElement)) {
      return { parent: lang.parentElement, mode: "detail", before: lang };
    }

    const fuzzy = findPriceHostFuzzy();
    if (fuzzy?.parentElement && !isDetailActionBlock(fuzzy.parentElement)) {
      return { parent: fuzzy.parentElement, mode: "detail", before: fuzzy };
    }

    // 整块购买区（.c-purchaseBox / #work_buy）之前，绝不进原生按键容器。
    const box = document.querySelector(".c-purchaseBox") ||
      document.querySelector(".c-purchaseBox__inner") ||
      document.querySelector("#work_buy");
    if (box?.parentElement) {
      return { parent: box.parentElement, mode: "detail", before: box };
    }
    return null;
  }

  function findCardMount(card) {
    const ref = findRefUI(card);
    if (ref?.parentElement) {
      return { parent: ref.parentElement, mode: "card", before: ref };
    }

    // 购物车页独立运行
    // li.cart_list_item 内、.cart_list_item_inner 之后
    if (isCartPage()) {
      const cartInner =
        card.querySelector(".__buy_now_target .cart_list_item_inner") ||
        card.querySelector(".__buy_later_target .cart_list_item_inner") ||
        card.querySelector(".cart_list_item_inner");
      if (cartInner?.parentElement) {
        return { parent: cartInner.parentElement, mode: "card", before: cartInner.nextSibling };
      }
      const cartRoot = card.closest("li.cart_list_item, li.n_work_list_item");
      if (cartRoot) return { parent: cartRoot, mode: "card", before: null };
      // 购物车页中结构异常的卡片退回通用逻辑，不影响其它页面
    }

    const anchor = findTagAnchor(card);
    const parent = anchor?.parentElement || firstBySelectors([
      ".work_info", ".n_work_info", "dl.work_img_main", "dl",
    ], card) || card;
    return {
      parent,
      mode: "card",
      before: anchor?.parentElement === parent ? anchor.nextSibling : null,
    };
  }

  function collectCards() {
    const cards = [];
    const seen = new Set();
    const currentId = idFromUrl();
    // 只判一次：detailIdFromDocument 会扫全页，放进 add() 会被每张卡重复触发。
    const productPage = isProductPage();
    const add = (node) => {
      if (!node || seen.has(node) || node.closest("." + HOST_CLASS)) return;
      if (productPage && node.closest("#work_buy, .c-purchaseBox")) return;
      if (inRankingSection(node)) return;
      if (inCommentSection(node)) return;
      const id = productIdFromNode(node);
      if (!id || id === currentId) return;
      if (cards.some((entry) => entry.id === id &&
        (entry.node.contains(node) || node.contains(entry.node)))) return;
      seen.add(node);
      cards.push({ id, node });
    };
    for (const node of document.querySelectorAll(CARD_SELECTORS.join(","))) add(node);
    for (const link of document.querySelectorAll('a[href*="product_id/"]')) {
      const node = link.closest(LINK_PARENT_SELECTORS.join(","));
      if (!node || node.closest("#work_buy, .c-purchaseBox")) continue;
      const hasCardSignal = node.querySelector(
        '[class*="price"], [class*="genre"], [class*="tag"]',
      ) || node.matches?.(
        '[data-workno], [data-product_id], [data-product-id], .product-item, .wishlist_work_item',
      );
      if (!hasCardSignal) continue;
      add(node);
    }
    return cards;
  }

  // ---------------------------------------------------------------- 渲染

  function desiredTag(parent) {
    return parent?.tagName === "DL" ? "dd" : "div";
  }

  function createHost(parent, id, mode) {
    const host = document.createElement(desiredTag(parent));
    host.className = HOST_CLASS;
    host.dataset.id = id;
    host.dataset.mode = mode;

    const card = document.createElement("section");
    card.className = "dlwb-card dlwb-analysis" + (mode === "detail" ? " is-detail" : "");

    const grid = document.createElement("div");
    grid.className = "dlwb-grid";

    const note = document.createElement("button");
    note.type = "button";
    note.className = "dlwb-frame dlwb-note";
    note.appendChild(document.createElement("span"));

    const listen = document.createElement("button");
    listen.type = "button";
    listen.className = "dlwb-frame dlwb-listen";
    listen.appendChild(document.createElement("span"));

    grid.appendChild(note);
    grid.appendChild(listen);
    card.appendChild(grid);
    host.appendChild(card);

    note.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openNoteModal(host.dataset.id);
    });
    listen.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentId = host.dataset.id;
      const next = !getItem(currentId).listened;
      setItem(currentId, { listened: next });
      toast(next ? "已试听" : "已恢复为未试听");
    });
    return host;
  }

  function refreshAll() {
    for (const host of document.querySelectorAll("." + HOST_CLASS)) {
      const id = host.dataset.id;
      if (!id) continue;
      const item = getItem(id);
      const card = host.querySelector(".dlwb-card");
      if (card) card.classList.toggle("is-stacked", shouldStack());

      const note = host.querySelector(".dlwb-note");
      if (note) {
        const text = item.note.trim();
        const label = note.querySelector("span");
        label.textContent = text || "备注";
        note.classList.toggle("is-note", Boolean(text));
        note.title = text || "点击输入备注";
        note.setAttribute("aria-label", text ? "备注：" + text : "点击输入备注");
      }
      const listen = host.querySelector(".dlwb-listen");
      if (listen) {
        listen.querySelector("span").textContent = item.listened ? "已试听" : "未试听";
        listen.classList.toggle("is-listened", item.listened);
        listen.title = item.listened ? "点击改回未试听" : "点击标记为已试听";
      }
    }
  }

  function isHost(node) {
    return Boolean(node?.classList?.contains(HOST_CLASS));
  }

  // 同一个作品只留一个宿主；SPA 复用节点时优先沿用同编号的那个。
  function pickHost(root, id) {
    const all = [...root.querySelectorAll("." + HOST_CLASS)];
    const kept = all.find((node) => node.dataset.id === id) || all[0] || null;
    for (const node of all) if (node !== kept) node.remove();
    return kept;
  }

  // 计算「插在哪个兄弟之前」时跳过自己的宿主，避免每次扫描来回搬动。
  function normalizeBefore(before, parent) {
    let candidate = before;
    while (isHost(candidate)) candidate = candidate.nextSibling;
    if (!candidate) return null;
    if (candidate.parentElement === parent) return candidate;
    // 锚点在更深层级时，上溯到 parent 的直接子节点，
    // 保证插在「优惠券键所在那一行」前面，而不是掉到容器末尾。
    let node = candidate;
    while (node?.parentElement && node.parentElement !== parent) {
      node = node.parentElement;
    }
    return node?.parentElement === parent ? node : null;
  }

  function placeHost(target) {
    const mount = target.mode === "detail"
      ? findDetailMount()
      : findCardMount(target.node);
    if (!mount?.parent) return null;

    const parent = mount.parent;
    const root = target.mode === "detail" ? parent : target.node;
    const tag = desiredTag(parent);
    let host = pickHost(root, target.id);
    if (host && host.tagName.toLowerCase() !== tag) {
      host.remove();
      host = null;
    }
    if (!host) host = createHost(parent, target.id, target.mode);
    host.dataset.id = target.id;
    host.dataset.mode = target.mode;

    let before;
    if (target.mode === "detail") {
      // 详情页用 findDetailMount 算好的锚点；双保险：绝不进原生按键容器。
      if (isDetailActionBlock(parent)) return null;
      before = mount.before || null;
      // SPA 换页时旧位置的宿主可能残留在别处，全局只保留一个详情页宿主。
      for (const other of document.querySelectorAll("." + HOST_CLASS + '[data-mode="detail"]')) {
        if (other !== host) other.remove();
      }
    } else {
      before = mount.before || null;
    }
    before = normalizeBefore(before, parent);
    if (host.parentElement === parent && host.nextSibling === before) return host;
    parent.insertBefore(host, before);
    return host;
  }

  let suppressScan = false;
  let scanTimer = null;

  function scan() {
    if (!document.body) return;
    injectStyle();
    suppressScan = true;
    try {
      const targets = [];
      const detail = isProductPage() ? findDetailMount() : null;
      const detailId = idFromUrl();
      if (detail && detailId) targets.push({ id: detailId, node: detail.parent, mode: "detail" });
      for (const entry of collectCards()) targets.push({ ...entry, mode: "card" });

      const ids = [];
      for (const target of targets) {
        if (placeHost(target)) ids.push(target.id);
      }
      refreshAll();
      if (detailId) readEditionsFromDocument();
      if (ids.length) ensureFamilies(ids).catch(() => {});
    } catch (error) {
      console.warn("[DLsite 双键] 扫描失败：", error);
    } finally {
      suppressScan = false;
    }
  }

  function scheduleScan() {
    if (scanTimer || suppressScan) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 260);
  }

  // ---------------------------------------------------------------- 提示

  let toastTimer = null;
  function toast(message, isError) {
    document.querySelector(".dlwb-toast")?.remove();
    const box = document.createElement("div");
    box.className = "dlwb-toast" + (isError ? " is-error" : "");
    box.textContent = message;
    (document.body || document.documentElement).appendChild(box);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.remove(), 2000);
  }

  // ---------------------------------------------------------------- 备注弹窗

  function closeModal(mask) {
    if (mask?.__dlwbEsc) {
      document.removeEventListener("keydown", mask.__dlwbEsc);
      mask.__dlwbEsc = null;
    }
    mask?.remove();
  }

  function makeModal(title) {
    const mask = document.createElement("div");
    mask.className = "dlwb-mask";
    const onEsc = (event) => {
      if (event.key === "Escape") closeModal(mask);
    };
    mask.__dlwbEsc = onEsc;
    document.addEventListener("keydown", onEsc);
    const modal = document.createElement("div");
    modal.className = "dlwb-modal";
    const heading = document.createElement("h3");
    heading.textContent = title;
    modal.appendChild(heading);
    mask.appendChild(modal);
    mask.addEventListener("click", (event) => {
      if (event.target === mask) closeModal(mask);
    });
    (document.body || document.documentElement).appendChild(mask);
    return { mask, modal };
  }

  function openNoteModal(id) {
    closeModal(document.querySelector(".dlwb-mask"));
    const { mask, modal } = makeModal("备注 · " + familyKey(id));

    const record = getItem(id);
    const textarea = document.createElement("textarea");
    textarea.className = "dlwb-textarea";
    textarea.placeholder = "写点什么…支持中文输入法";
    textarea.value = record.note;
    modal.appendChild(textarea);

    // 输入框左下角：这条备注（或试听状态）最后一次保存的本地时间。
    const timeLine = document.createElement("p");
    timeLine.className = "dlwb-note-time";
    timeLine.textContent = "备注时间：" +
      (record.updatedAt > 0 ? formatNoteTime(record.updatedAt) : "尚未保存");
    modal.appendChild(timeLine);

    const actions = document.createElement("div");
    actions.className = "dlwb-actions";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "清空输入";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "is-primary";
    save.textContent = "保存";
    actions.appendChild(clear);
    actions.appendChild(cancel);
    actions.appendChild(save);
    modal.appendChild(actions);

    const backup = document.createElement("div");
    backup.className = "dlwb-backup";
    const backupTitle = document.createElement("strong");
    backupTitle.textContent = "数据备份（换设备用）";
    const backupRow = document.createElement("div");
    backupRow.className = "dlwb-backup-row";
    const openBackup = document.createElement("button");
    openBackup.type = "button";
    openBackup.textContent = "备份 / 恢复";
    backupRow.appendChild(openBackup);
    const checkUpdate = document.createElement("button");
    checkUpdate.type = "button";
    checkUpdate.textContent = "检查更新";
    backupRow.appendChild(checkUpdate);
    const hint = document.createElement("p");
    hint.className = "dlwb-hint";
    hint.textContent = "当前共记录 " + Object.keys(state.items).length + " 部作品";
    backup.appendChild(backupTitle);
    backup.appendChild(backupRow);
    backup.appendChild(hint);
    modal.appendChild(backup);

    clear.addEventListener("click", () => {
      textarea.value = "";
      textarea.focus();
    });
    cancel.addEventListener("click", () => closeModal(mask));
    save.addEventListener("click", () => {
      setItem(id, { note: textarea.value.trim() });
      closeModal(mask);
    });
    openBackup.addEventListener("click", () => {
      closeModal(mask);
      openBackupModal();
    });
    checkUpdate.addEventListener("click", () => {
      checkUpdate.disabled = true;
      checkUpdate.textContent = "检查中…";
      checkForNewVersion(true).catch(() => {
        toast("检查更新失败，请稍后重试", true);
      }).finally(() => {
        checkUpdate.disabled = false;
        checkUpdate.textContent = "检查更新";
      });
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        save.click();
      }
    });

    setTimeout(() => {
      try {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } catch (_) { /* noop */ }
    }, 30);
  }

  // ---------------------------------------------------------------- 备份 / 恢复

  // 仅用于兼容早期保存成 .txt 的「备份码」文件，新备份一律导出 .json。
  function base64ToText(base64) {
    const binary = atob(base64);
    const percent = [...binary].map((char) =>
      "%" + char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return decodeURIComponent(percent);
  }

  function exportPayload() {
    return {
      v: 1,
      app: "dlsite-note-listen",
      exportedAt: now(),
      items: state.items,
      families: state.families,
    };
  }

  function parseBackup(raw) {
    let text = String(raw || "").trim();
    if (!text) throw new Error("内容为空");
    if (text.startsWith(BACKUP_PREFIX)) text = text.slice(BACKUP_PREFIX.length);
    let json = text;
    if (!text.startsWith("{")) json = base64ToText(text);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || !parsed.items) {
      throw new Error("不是有效的双键备份");
    }
    return parsed;
  }

  function mergeBackup(payload) {
    let count = 0;
    for (const [key, record] of Object.entries(payload.items || {})) {
      const id = normId(key);
      if (!validId(id)) continue;
      const merged = mergeRecord(state.items[id], record);
      if (merged) state.items[id] = merged;
      count += 1;
    }
    for (const [id, family] of Object.entries(payload.families || {})) {
      if (validId(id) && validId(family)) state.families[normId(id)] = normId(family);
    }
    normalizeAllItems();
    saveState();
    refreshAll();
    return count;
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = "dlsite-note-listen-" + stamp + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function openBackupModal() {
    closeModal(document.querySelector(".dlwb-mask"));
    const { mask, modal } = makeModal("数据备份 / 恢复");

    const intro = document.createElement("p");
    intro.textContent = "换设备时：在旧设备点「下载文件」保存 .json 备份文件，把文件传到新设备（微信 / 网盘），" +
      "装上脚本后点「从文件恢复」选中它即可。数据只存在本机浏览器里，清理浏览器数据会丢失。";
    modal.appendChild(intro);

    const row = document.createElement("div");
    row.className = "dlwb-backup-row";
    row.style.marginTop = "10px";
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "下载文件";
    const label = document.createElement("label");
    label.className = "dlwb-file-label";
    label.textContent = "从文件恢复";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json,.txt,text/plain";
    fileInput.className = "dlwb-file-input";
    label.appendChild(fileInput);
    row.appendChild(download);
    row.appendChild(label);
    modal.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "dlwb-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    actions.appendChild(close);
    modal.appendChild(actions);

    const hint = document.createElement("p");
    hint.className = "dlwb-hint";
    hint.textContent = "当前共 " + Object.keys(state.items).length + " 部作品｜" +
      "恢复是合并，不会覆盖较新的记录";
    modal.appendChild(hint);

    download.addEventListener("click", () => {
      try {
        downloadBackup();
        toast("已生成备份文件（" + Object.keys(state.items).length + " 部作品）");
      } catch (_) {
        toast("文件下载失败，请检查浏览器的下载权限", true);
      }
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const count = mergeBackup(parseBackup(String(reader.result || "")));
          toast("文件恢复完成，已合并 " + count + " 部作品");
          hint.textContent = "当前共 " + Object.keys(state.items).length + " 部作品｜" +
            "恢复是合并，不会覆盖较新的记录";
        } catch (error) {
          toast("文件格式不对：" + (error?.message || error), true);
        }
        fileInput.value = "";
      };
      reader.onerror = () => {
        toast("文件读取失败，请重新选择", true);
        fileInput.value = "";
      };
      reader.readAsText(file);
    });
    close.addEventListener("click", () => closeModal(mask));
  }

  // ---------------------------------------------------------------- 启动

  function boot() {
    state = loadState();
    injectStyle();
    readEditionsFromDocument();
    scan();

    // 每 6 小时自检一次新版本，有新版右下角弹提示（失败静默，不影响主功能）。
    checkForNewVersion().catch(() => {});

    let observer = null;
    try {
      observer = new MutationObserver((mutations) => {
        // 忽略脚本自身造成的 DOM 变动，避免自激循环。
        const ownNode = (node) => node?.nodeType === 1 && (
          node.classList?.contains("dlwb-toast") ||
          node.classList?.contains("dlwb-mask") ||
          node.classList?.contains(UPDATE_BANNER_CLASSNAME) ||
          isHost(node)
        );
        const external = mutations.some((mutation) => {
          if (mutation.target?.closest?.("." + HOST_CLASS)) return false;
          if (mutation.target?.closest?.(".dlwb-mask")) return false;
          const changed = [...mutation.addedNodes, ...mutation.removedNodes];
          if (changed.length && changed.every(ownNode)) return false;
          return true;
        });
        if (external) scheduleScan();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* 老内核没有 MutationObserver，靠定时兜底 */ }

    // 参考插件是异步渲染的（几秒后才出现 host），定时复查保证双键始终紧跟其后。
    setInterval(() => {
      if (!document.hidden && !suppressScan) scan();
    }, 4000);
    window.addEventListener("pageshow", scheduleScan);
    window.addEventListener("resize", scheduleScan);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleScan();
    });

    // 其他标签页改动了同一份数据，本页立刻同步。
    window.addEventListener("storage", (event) => {
      if (event.key !== STORE_KEY) return;
      state = loadState();
      refreshAll();
    });

    // 支持 GM_registerMenuCommand 的脚本管理器里额外提供一个入口。
    try {
      if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("DLsite 双键：备份 / 恢复", openBackupModal);
      }
    } catch (_) { /* 无菜单 API 时，备注弹窗里同样能打开 */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
