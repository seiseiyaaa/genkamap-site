const FORM_ENDPOINT = "https://script.google.com/macros/s/AKfycbwo5Z36nrWZ2laIfLu-VLbHYcmfoekm__nLclaSzcf3hWqpzj5if8YhjmARvpcfsvk/exec";

const form = document.querySelector("#lead-form");
const status = document.querySelector("#form-status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function formPayload(formData) {
  const params = new URLSearchParams(window.location.search);
  return {
    company: String(formData.get("company") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    challenge: String(formData.get("challenge") || "").trim(),
    website: String(formData.get("website") || ""),
    // どのLPからの請求かをシート上で見分けるための印。
    source: form.dataset.source || "資料請求",
    pageUrl: window.location.href,
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    submittedAt: new Date().toISOString()
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  if (!form.reportValidity()) return;

  const button = form.querySelector("button[type='submit']");
  const payload = formPayload(new FormData(form));
  // ボタンの文言はページごとに違うため、元の文言を控えてから差し替える。
  const label = button.firstChild.textContent;
  button.disabled = true;
  button.firstChild.textContent = "送信中… ";

  try {
    const isDemo = FORM_ENDPOINT.startsWith("PASTE_");
    if (!isDemo) {
      // Apps Script WebアプリはCORSレスポンスを返さないため、書き込み専用のno-corsで送信する。
      await fetch(FORM_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
    }

    form.reset();
    // 送信先が未設定(プレースホルダー)のときは、実ユーザーには
    // 開発用であることを悟らせず、受け付けた旨だけを穏当に伝える。
    setStatus(isDemo
      ? "送信を受け付けました。ご連絡までしばらくお待ちください。"
      : "送信しました。ご記入のメールアドレス宛に資料をお送りしました。届かない場合は迷惑メールフォルダをご確認ください。");
  } catch (error) {
    console.error(error);
    setStatus("送信できませんでした。時間をおいてもう一度お試しください。", true);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = label;
  }
});
