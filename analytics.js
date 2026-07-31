/**
 * LPのアクセス計測。問い合わせと同じGASへ送り、同じスプレッドシートの別シート
 * (LPアクセス)へ書き出す。外部の解析サービスは使わない。
 *
 * 氏名・メールなどの個人情報は送らない。識別子は端末内で作った乱数だけで、
 * 個人や会社を特定する用途には使えない。
 */
// script.js の FORM_ENDPOINT と同じURL。GASを再デプロイしたら両方そろえて直す。
const TRACK_ENDPOINT = "https://script.google.com/macros/s/AKfycbwo5Z36nrWZ2laIfLu-VLbHYcmfoekm__nLclaSzcf3hWqpzj5if8YhjmARvpcfsvk/exec";

const VISITOR_KEY = "gm_vid";
const SESSION_KEY = "gm_sid";
const OPTOUT_KEY = "gm_optout";
// 30分あいだが空いたら別セッションとして数える(一般的なアクセス解析と同じ基準)。
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const openedAt = Date.now();
let maxScrollPercent = 0;
let leaveSent = false;

function randomId() {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    return Math.random().toString(16).slice(2, 18);
  }
}

// プライベートブラウジング等で保存できない環境もあるため、失敗しても計測は止めない。
function readStore(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // 保存できない場合は毎回「新規訪問」として数えられる
  }
}

function visitor() {
  const saved = readStore(VISITOR_KEY);
  if (saved) return { id: saved, isNew: false };
  const id = randomId();
  writeStore(VISITOR_KEY, id);
  return { id, isNew: true };
}

function sessionId() {
  let saved = null;
  try {
    saved = JSON.parse(readStore(SESSION_KEY) || "null");
  } catch (error) {
    saved = null;
  }
  const now = Date.now();
  const id = saved && saved.id && now - saved.at < SESSION_TIMEOUT_MS ? saved.id : randomId();
  writeStore(SESSION_KEY, JSON.stringify({ id, at: now }));
  return id;
}

function deviceType() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

function referrerHost() {
  try {
    const host = new URL(document.referrer).hostname;
    // 同じサイト内の移動は流入元ではないので、参照元なし扱いにする。
    return host === location.hostname ? "" : host;
  } catch (error) {
    return "";
  }
}

const identity = visitor();

function baseEvent(event) {
  const params = new URLSearchParams(location.search);
  return {
    event,
    pagePath: location.pathname,
    pageTitle: document.title,
    referrer: document.referrer,
    referrerHost: referrerHost(),
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    visitorId: identity.id,
    sessionId: sessionId(),
    newVisitor: identity.isNew,
    device: deviceType(),
    screenWidth: window.screen ? window.screen.width : window.innerWidth,
    language: navigator.language || "",
    userAgent: navigator.userAgent.slice(0, 200),
    clientTime: new Date().toISOString()
  };
}

function send(payload) {
  const body = JSON.stringify(payload);
  try {
    // 離脱時でも送信が打ち切られないよう、使える環境ではsendBeaconを優先する。
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    if (navigator.sendBeacon && navigator.sendBeacon(TRACK_ENDPOINT, blob)) return;
  } catch (error) {
    // sendBeaconが使えない環境ではfetchで送る
  }
  // Apps ScriptはCORSレスポンスを返さないため、書き込み専用のno-corsで送る。
  fetch(TRACK_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body
  }).catch(() => {});
}

function updateScroll() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const percent = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 100;
  maxScrollPercent = Math.min(100, Math.max(maxScrollPercent, percent));
}

// 離脱時に一度だけ、滞在時間とスクロール到達率を送る。
// LPのどこで読むのをやめたかが分かると、直帰の多い節を直せる。
function sendLeave() {
  if (leaveSent) return;
  leaveSent = true;
  updateScroll();
  send(Object.assign(baseEvent("engagement"), {
    seconds: Math.round((Date.now() - openedAt) / 1000),
    scrollPercent: maxScrollPercent
  }));
}

// 自分たちの閲覧を数えたくない端末は ?notrack=1 を一度開いておく(?notrack=0 で解除)。
function isOptedOut() {
  const notrack = new URLSearchParams(location.search).get("notrack");
  if (notrack === "1") writeStore(OPTOUT_KEY, "1");
  if (notrack === "0") writeStore(OPTOUT_KEY, "");
  return readStore(OPTOUT_KEY) === "1";
}

function start() {
  if (location.protocol === "file:" || isOptedOut()) return;

  send(baseEvent("pageview"));

  window.addEventListener("scroll", updateScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendLeave();
  });
  window.addEventListener("pagehide", sendLeave);

  // data-track を付けたリンク・ボタンの押下だけを記録する(押した箇所の名前のみ)。
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-track]");
    if (target) send(Object.assign(baseEvent("click"), { label: target.dataset.track }));
  });
}

start();
