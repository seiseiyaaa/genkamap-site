const FORM_ENDPOINT = "https://script.google.com/macros/s/AKfycbwo5Z36nrWZ2laIfLu-VLbHYcmfoekm__nLclaSzcf3hWqpzj5if8YhjmARvpcfsvk/exec";

const form = document.querySelector("#schedule-form");
const status = document.querySelector("#form-status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

// オンライン相談の枠。9:00〜18:00 の 1 時間刻み(GAS側 LeadForm.gs と対応)。
const CONSULT_START_HOUR = 9;
const CONSULT_END_HOUR = 18;
const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
let availabilityDays = [];

const timeValue = (hour) => `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`;
const timeLabel = (hour) => `${hour}:00〜${hour + 1}:00`;

function allHours() {
  const hours = [];
  for (let hour = CONSULT_START_HOUR; hour < CONSULT_END_HOUR; hour += 1) hours.push(hour);
  return hours;
}

// 空き情報が取れない場合でも、翌日以降の全時間帯を出して送信は止めない。
function fallbackDays() {
  const days = [];
  const base = new Date();
  for (let offset = 1; offset <= 10; offset += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    const pad = (num) => String(num).padStart(2, "0");
    days.push({
      date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
      label: `${day.getMonth() + 1}/${day.getDate()}(${WEEKDAY_JP[day.getDay()]})`,
      hours: allHours()
    });
  }
  return days;
}

function populateSelect(select, options, emptyLabel) {
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

// 日付を選ぶと、その日の空いている時間だけを時間プルダウンに出す。
function updateTimeSelect(n) {
  const dateSelect = form.elements[`preferredDate${n}`];
  const timeSelect = form.elements[`preferredTime${n}`];
  const day = availabilityDays.find((item) => item.date === dateSelect.value);

  if (!day) {
    const label = dateSelect.value === "consult" ? "日程は相談して決める" : "先に日付を選択";
    populateSelect(timeSelect, [], label);
    timeSelect.disabled = true;
    return;
  }
  populateSelect(
    timeSelect,
    day.hours.map((hour) => ({ value: timeValue(hour), label: timeLabel(hour) })),
    "時間を選択"
  );
  timeSelect.disabled = false;
}

function setupSlotPickers(days) {
  availabilityDays = days;
  const dateOptions = days
    .filter((day) => day.hours.length > 0)
    .map((day) => ({ value: day.date, label: day.label }));

  [1, 2, 3].forEach((n) => {
    const dateSelect = form.elements[`preferredDate${n}`];
    const options = n === 1
      // 候補が全て埋まっていても送信できるよう、相談用の選択肢を必ず末尾に残す。
      ? dateOptions.concat({ value: "consult", label: "合う日程がない(日程は相談して決める)" })
      : dateOptions;
    populateSelect(dateSelect, options, n === 1 ? "選択してください" : "指定なし");
    dateSelect.addEventListener("change", () => updateTimeSelect(n));
    updateTimeSelect(n);
  });
}

async function loadSlots() {
  let days = null;
  try {
    const response = await fetch(`${FORM_ENDPOINT}?action=availability`);
    const body = await response.json();
    if (body.ok && Array.isArray(body.days)) days = body.days;
  } catch (error) {
    console.warn("availability", error);
  }
  setupSlotPickers(days || fallbackDays());
}

// 無効化中の時間セレクトは FormData に含まれないため、常に日付とセットで解釈する。
function preferredParts(formData, n) {
  const date = String(formData.get(`preferredDate${n}`) || "");
  const time = String(formData.get(`preferredTime${n}`) || "");
  if (date === "consult") return { date: "", time: "日程相談希望" };
  if (!date || !time) return { date: "", time: "" };
  return { date, time };
}

function formPayload(formData) {
  return {
    company: String(formData.get("company") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    preferredDate1: preferredParts(formData, 1).date,
    preferredTime1: preferredParts(formData, 1).time,
    preferredDate2: preferredParts(formData, 2).date,
    preferredTime2: preferredParts(formData, 2).time,
    preferredDate3: preferredParts(formData, 3).date,
    preferredTime3: preferredParts(formData, 3).time,
    website: String(formData.get("website") || ""),
    source: "日程調整",
    pageUrl: window.location.href,
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
    // Apps Script WebアプリはCORSレスポンスを返さないため、書き込み専用のno-corsで送信する。
    await fetch(FORM_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    form.reset();
    [1, 2, 3].forEach((n) => updateTimeSelect(n));
    setStatus("ご希望を受け付けました。確定のご連絡をお送りしますので、少々お待ちください。");
  } catch (error) {
    console.error(error);
    setStatus("送信できませんでした。時間をおいてもう一度お試しください。", true);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "この日程で申し込む ";
  }
});

loadSlots();
