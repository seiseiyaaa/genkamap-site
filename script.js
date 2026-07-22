const FORM_ENDPOINT = "https://script.google.com/macros/s/AKfycbwo5Z36nrWZ2laIfLu-VLbHYcmfoekm__nLclaSzcf3hWqpzj5if8YhjmARvpcfsvk/exec";

const form = document.querySelector("#lead-form");
const status = document.querySelector("#form-status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

// オンライン相談の枠。GAS側(LeadForm.gs)の CONSULT_SLOTS と対応させる。
const SLOT_LABELS = {
  am: "午前(10:00-11:00)",
  pm: "午後(14:00-15:00)",
  eve: "夕方(16:00-17:00)"
};
const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

// カレンダーの空き情報が取れない場合でも、翌日以降の平日枠を出して送信は止めない。
function fallbackSlots() {
  const slots = [];
  const base = new Date();
  for (let offset = 1; slots.length < 10 && offset <= 14; offset += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    const pad = (num) => String(num).padStart(2, "0");
    slots.push({
      date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
      label: `${day.getMonth() + 1}/${day.getDate()}(${WEEKDAY_JP[day.getDay()]})`,
      times: Object.keys(SLOT_LABELS).map((key) => ({ key, available: true }))
    });
  }
  return slots;
}

function populateSlotSelect(select, options, emptyLabel) {
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  select.replaceChildren(empty, ...options.map((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    return option;
  }));
}

async function loadSlots() {
  let slots = null;
  try {
    if (!FORM_ENDPOINT.startsWith("PASTE_")) {
      const response = await fetch(`${FORM_ENDPOINT}?action=availability`);
      const body = await response.json();
      if (body.ok && Array.isArray(body.slots)) slots = body.slots;
    }
  } catch (error) {
    console.warn("availability", error);
  }
  if (!slots) slots = fallbackSlots();

  const options = [];
  slots.forEach((day) => {
    (day.times || []).forEach((time) => {
      if (!time.available || !SLOT_LABELS[time.key]) return;
      options.push({ value: `${day.date}|${time.key}`, label: `${day.label} ${SLOT_LABELS[time.key]}` });
    });
  });
  // 候補が全て埋まっていても送信できるよう、相談用の選択肢を必ず末尾に残す。
  const consultOption = { value: "consult", label: "この中に合う日程がない(日程は相談して決める)" };
  populateSlotSelect(form.elements.preferredSlot1, options.concat(consultOption), "選択してください");
  populateSlotSelect(form.elements.preferredSlot2, options, "指定なし");
  populateSlotSelect(form.elements.preferredSlot3, options, "指定なし");
}

function slotParts(value) {
  if (value === "consult") return { date: "", time: "日程相談希望" };
  const [date, key] = String(value || "").split("|");
  return { date: date || "", time: SLOT_LABELS[key] || "" };
}

function formPayload(formData) {
  const params = new URLSearchParams(window.location.search);
  return {
    company: String(formData.get("company") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    teamSize: String(formData.get("teamSize") || "").trim(),
    challenge: String(formData.get("challenge") || "").trim(),
    preferredDate1: slotParts(formData.get("preferredSlot1")).date,
    preferredTime1: slotParts(formData.get("preferredSlot1")).time,
    preferredDate2: slotParts(formData.get("preferredSlot2")).date,
    preferredTime2: slotParts(formData.get("preferredSlot2")).time,
    preferredDate3: slotParts(formData.get("preferredSlot3")).date,
    preferredTime3: slotParts(formData.get("preferredSlot3")).time,
    website: String(formData.get("website") || ""),
    source: "landing-page",
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
    // 開発用であることを悟らせず、送信は受け付けない旨だけを穏当に伝える。
    setStatus(isDemo
      ? "送信を受け付けました。ご連絡までしばらくお待ちください。"
      : "送信しました。内容を確認のうえ、ご連絡します。");
  } catch (error) {
    console.error(error);
    setStatus("送信できませんでした。時間をおいてもう一度お試しください。", true);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "相談内容を送信する ";
  }
});

loadSlots();
