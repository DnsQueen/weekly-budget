// weekly-budget frontend: no framework, plain DOM + fetch.
// Locale: ?locale=en or ?locale=fa (default fa). Missing keys fall back
// to the default language (fa), never empty, never a raw key.
const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en" ? "en" : "fa";

let strings = {};
let fallback = {};

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function t(key) {
  if (strings[key] !== undefined) return strings[key];
  if (fallback[key] !== undefined) return fallback[key];
  return key;
}

function showError(message) {
  const el = document.getElementById("error");
  el.textContent = `${t("error")}: ${message}`;
  el.hidden = false;
}

function clearError() {
  document.getElementById("error").hidden = true;
}

async function loadStrings() {
  fallback = await (await fetch("/locales/fa.json")).json();
  strings = locale === "fa" ? fallback : await (await fetch("/locales/en.json")).json();
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  const datalist = document.getElementById("categories");
  datalist.innerHTML = "";
  for (const label of Object.values(strings.categories || fallback.categories || {})) {
    const option = document.createElement("option");
    option.value = label;
    datalist.appendChild(option);
  }
}

// The stored budget for the current week, if one was saved. The input
// defaults to 100; a stored budget replaces it before refresh() reads it,
// so a reload shows the summary for the budget that was actually saved.
async function loadBudget() {
  const week = document.getElementById("week").value;
  const res = await fetch("/api/v1/weeks");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? res.status);
  const row = json.data.find((r) => r.week === week);
  if (row && row.budget !== null) {
    document.querySelector("#budget-form input[name=amount]").value = String(row.budget);
  }
}

async function refresh() {
  const week = document.getElementById("week").value;
  const budgetInput = document.querySelector("#budget-form input[name=amount]");
  const budget = Number(budgetInput.value);
  try {
    const summaryRes = await fetch(
      `/api/v1/weekly-summary?week=${encodeURIComponent(week)}&budget=${budget}`,
    );
    const summaryJson = await summaryRes.json();
    if (!summaryRes.ok) throw new Error(summaryJson.error?.message ?? summaryRes.status);
    const s = summaryJson.data;
    document.getElementById("summary-total").textContent = String(s.total);
    document.getElementById("summary-remaining").textContent = String(s.remaining);
    document.getElementById("summary-warned").textContent = s.warned ? t("warnedYes") : t("warnedNo");
    document.getElementById("summary-percent").textContent = `${s.percent}%`;

    const listRes = await fetch(`/api/v1/spending?week=${encodeURIComponent(week)}&pageSize=100`);
    const listJson = await listRes.json();
    const list = document.getElementById("spending-list");
    list.innerHTML = "";
    document.getElementById("no-spending").hidden = listJson.data.length > 0;
    for (const row of listJson.data) {
      const li = document.createElement("li");
      li.textContent = `${row.category}: ${row.amount}`;
      list.appendChild(li);
    }
    // The API caps pageSize at 100; say how many of the week's entries
    // are shown, so a truncated list is never silent.
    document.getElementById("spending-count").textContent = t("showing")
      .replace("{shown}", String(listJson.data.length))
      .replace("{total}", String(listJson.pagination.totalItems));

    const weeksRes = await fetch("/api/v1/weeks");
    const weeksJson = await weeksRes.json();
    const body = document.getElementById("history-body");
    body.innerHTML = "";
    document.getElementById("no-history").hidden = weeksJson.data.length > 0;
    for (const row of weeksJson.data) {
      const tr = document.createElement("tr");
      for (const value of [row.week, row.total, row.budget ?? "—"]) {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    clearError();
  } catch (error) {
    showError(error.message);
  }
}

document.getElementById("week").value = isoWeek(new Date());

document.getElementById("spending-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    const res = await fetch("/api/v1/spending", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: Number(form.amount.value),
        category: form.category.value,
        week: form.week.value,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      showError(json.error?.message ?? res.status);
      return;
    }
    form.amount.value = "";
    form.category.value = "";
    await refresh();
  } catch (error) {
    showError(error.message);
  }
});

document.getElementById("budget-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const week = document.getElementById("week").value;
  try {
    const res = await fetch("/api/v1/budgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ week, amount: Number(form.amount.value) }),
    });
    const json = await res.json();
    if (!res.ok) {
      showError(json.error?.message ?? res.status);
      return;
    }
    await refresh();
  } catch (error) {
    showError(error.message);
  }
});

document.querySelector("#budget-form input[name=amount]").value = "100";
// A failed locale or budget fetch must not leave the page inert: the
// rejection reaches showError instead of dying unhandled.
loadStrings().then(loadBudget).then(refresh).catch((error) => showError(error.message));
