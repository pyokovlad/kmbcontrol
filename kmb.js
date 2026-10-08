"use strict";

/*
    URL опубликованного Google Apps Script.
    Если после нового развёртывания URL изменится — замените его здесь.
*/
const API_URL =
    "https://script.google.com/macros/s/AKfycbzHgnnwLnRL0P8HFdn0EB6l4JF3v40973lfMePXMQO6gAypTHfg304sT2tNhEP8k3IA/exec";

let password = localStorage.getItem("kmb_pw") || "";
let people = [];
let currentFilter = "urgent";
let unitFilter = "all";
let sortMode = "least"; // least = меньше времени первыми, most = больше времени первыми

const $ = id => document.getElementById(id);

/* =========================
   API
========================= */
async function api(action, extra = {}) {
    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ password, action, ...extra })
    });

    const raw = await response.text();

    if (!response.ok) {
        console.error(`Ошибка HTTP ${response.status} при выполнении "${action}":`, raw);
        throw new Error(`Ошибка сервера: HTTP ${response.status}.`);
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        console.error(`Google Apps Script вернул некорректный ответ для "${action}":`, raw);
        throw new Error("Сервер вернул некорректный ответ.");
    }

    if (!data.ok) {
        throw new Error(data.error || "Неизвестная ошибка сервера.");
    }
    return data;
}

/* =========================
   DATE
========================= */
function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;

    const match = String(value).trim().match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
    );
    if (!match) return null;

    return new Date(
        Number(match[3]), Number(match[2]) - 1, Number(match[1]),
        Number(match[4] || 0), Number(match[5] || 0), 0
    );
}

const pad = n => String(n).padStart(2, "0");

function formatDate(value) {
    const d = parseDate(value);
    if (!d) return "—";
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function formatDateTime(value) {
    const d = parseDate(value);
    if (!d) return "—";
    return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "dd.MM.yyyy HH:mm" -> "yyyy-MM-ddTHH:mm" (для datetime-local)
function toInputValue(value) {
    const d = parseDate(value);
    if (!d) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "yyyy-MM-ddTHH:mm" -> "dd.MM.yyyy HH:mm"
function fromInputValue(value) {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : "";
}

/* =========================
   TIME
========================= */
function deadlineMs(person) {
    if (Number.isFinite(person.deadlineTs)) return person.deadlineTs;
    const d = parseDate(person.deadline);
    return d ? d.getTime() : null;
}

function levelOf(person) {
    const ms = deadlineMs(person);
    if (ms === null) return "ok";

    const diff = ms - Date.now();
    if (diff <= 0) return "late";
    if (diff <= 24 * 60 * 60 * 1000) return "soon";
    return "ok";
}

function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "—";
    if (milliseconds <= 0) return "СРОК ВЫШЕЛ";

    const totalMinutes = Math.floor(milliseconds / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days} д. ${hours} ч.`;
    if (hours > 0) return `${hours} ч. ${minutes} мин.`;
    return `${minutes} мин.`;
}

function remaining(person) {
    const ms = deadlineMs(person);
    return ms === null ? "—" : formatDuration(ms - Date.now());
}

/* =========================
   ESCAPE HTML
========================= */
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/* =========================
   STATUS
========================= */
const isKmbStatus = p => p.status === "КМБ" || p.status === "УКМБ";
const isNoUnitStatus = p => p.status === "Без подразделения";

function statusText(person) {
    return person.status || "—";
}

function statusClass(person) {
    if (isNoUnitStatus(person)) return "status--nounit";
    if (person.status === "УКМБ") return "status--ukmb";
    if (person.status === "КМБ") return "status--kmb";
    return "status--unit";
}

/* =========================
   FILTER + SORT
========================= */
function sortPeople(list) {
    const dir = sortMode === "most" ? -1 : 1;

    return [...list].sort((a, b) => {
        const da = deadlineMs(a);
        const db = deadlineMs(b);
        if (da === null && db === null) return 0;
        if (da === null) return 1;   // без дедлайна всегда в конце
        if (db === null) return -1;
        return (da - db) * dir;
    });
}

function getFilteredPeople() {
    let list;

    switch (currentFilter) {
        case "urgent":
            list = people.filter(p => {
                const level = levelOf(p);
                return level === "late" || level === "soon";
            });
            break;
        case "kmb":
            list = people.filter(isKmbStatus);
            break;
        case "nounit":
            list = people.filter(isNoUnitStatus);
            break;
        case "all":
            list = [...people];
            break;
        default:
            list = [];
    }

    if (unitFilter !== "all") {
        const target = unitFilter.toLowerCase();
        list = list.filter(p => String(p.unit || "").trim().toLowerCase() === target);
    }

    return sortPeople(list);
}

/* =========================
   RENDER
========================= */
function render() {
    updateCounters();

    const body = $("peopleBody");
    const empty = $("emptyState");
    const list = getFilteredPeople();

    body.innerHTML = "";

    if (list.length === 0) {
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");

    for (const person of list) {
        const tr = document.createElement("tr");
        const level = levelOf(person);
        const levelClass =
            level === "late" ? "deadline--late" :
            level === "soon" ? "deadline--soon" : "deadline--ok";

        const noUnitDate = isNoUnitStatus(person)
            ? formatDateTime(person.noUnitSince || person.statusSince)
            : "—";

        tr.innerHTML = `
            <td><div class="person-name">${escapeHtml(person.name)}</div></td>
            <td><span class="static">${escapeHtml(person.staticId)}</span></td>
            <td>${escapeHtml(person.rank || "—")}</td>
            <td>${escapeHtml(person.unit || "—")}</td>
            <td>
                <div class="composer">
                    <div class="composer__name">${escapeHtml(person.composerName || "—")}</div>
                    <div class="composer__static">${escapeHtml(person.composerStatic || "—")}</div>
                </div>
            </td>
            <td><span class="status ${statusClass(person)}">${escapeHtml(statusText(person))}</span></td>
            <td>${formatDateTime(person.enlisted)}</td>
            <td>${noUnitDate}</td>
            <td><span class="deadline ${levelClass}">${formatDate(person.deadline)}</span></td>
            <td><span class="deadline ${levelClass}">${escapeHtml(remaining(person))}</span></td>
            <td>
                <div class="action-buttons">
                    <button data-action="edit" data-static="${escapeHtml(person.staticId)}">Изменить</button>
                    <button class="danger" data-action="remove" data-static="${escapeHtml(person.staticId)}">Удалить</button>
                </div>
            </td>
        `;
        body.appendChild(tr);
    }
}

/* =========================
   COUNTERS
========================= */
function updateCounters() {
    let late = 0, soon = 0, ok = 0;

    for (const person of people) {
        const level = levelOf(person);
        if (level === "late") late++;
        else if (level === "soon") soon++;
        else ok++;
    }

    $("lateCount").textContent = late;
    $("soonCount").textContent = soon;
    $("okCount").textContent = ok;
    $("totalCount").textContent = people.length;

    $("tabUrgentCount").textContent = late + soon;
    $("tabKmbCount").textContent = people.filter(isKmbStatus).length;
    $("tabNoUnitCount").textContent = people.filter(isNoUnitStatus).length;
    $("tabAllCount").textContent = people.length;
}

/* =========================
   LOAD
========================= */
async function load() {
    try {
        const data = await api("list");
        people = Array.isArray(data.people) ? data.people : [];
        render();
        return true;
    } catch (error) {
        console.error("Не удалось загрузить данные:", error);
        alert("Не удалось загрузить данные:\n\n" + error.message);
        return false;
    }
}

async function silentLoad() {
    try {
        const data = await api("list");
        people = Array.isArray(data.people) ? data.people : [];
        render();
        return true;
    } catch (error) {
        console.warn("Фоновое обновление данных не выполнено:", error);
        return false;
    }
}

/* =========================
   LOGIN / LOGOUT
========================= */
async function login() {
    const input = $("passwordInput");
    const error = $("loginError");
    const value = input.value.trim();

    if (!value) {
        error.textContent = "Введите пароль.";
        return;
    }

    password = value;

    try {
        const data = await api("list");
        people = Array.isArray(data.people) ? data.people : [];

        localStorage.setItem("kmb_pw", password);
        $("loginPanel").classList.add("hidden");
        $("mainPanel").classList.remove("hidden");
        error.textContent = "";
        render();
    } catch (err) {
        password = "";
        error.textContent = err.message || "Неверный пароль.";
    }
}

function logout() {
    password = "";
    localStorage.removeItem("kmb_pw");
    $("mainPanel").classList.add("hidden");
    $("loginPanel").classList.remove("hidden");
    $("passwordInput").value = "";
}

/* =========================
   INGEST
========================= */
function personHead(item) {
    return `
        <strong>${escapeHtml(item.name || "Неизвестный военнослужащий")}</strong>
        ${item.staticId ? `<code>${escapeHtml(item.staticId)}</code>` : ""}
    `;
}

function ingestGroup(cls, title, items, renderItem) {
    if (!items.length) return "";
    return `
        <div class="ingest-group ingest-group--${cls}">
            <h3>${title}</h3>
            <div class="ingest-list">
                ${items.map(item => `<div class="ingest-item">${renderItem(item)}</div>`).join("")}
            </div>
        </div>
    `;
}

function changesHtml(changes) {
    const fields = [["rank", "Звание"], ["unit", "Подразделение"], ["status", "Статус"]];
    let html = "";

    for (const [key, label] of fields) {
        const c = changes && changes[key];
        if (c && c.old !== c.new) {
            html += `
                <div>
                    ${label}:
                    <span class="old-value">${escapeHtml(c.old || "—")}</span>
                    →
                    <strong>${escapeHtml(c.new || "—")}</strong>
                </div>
            `;
        }
    }
    return html;
}

async function ingest() {
    const text = $("logInput").value.trim();
    const today = $("todayInput").value;
    const result = $("ingestResult");

    if (!text) {
        result.className = "result error";
        result.textContent = "Вставьте сообщения журнала.";
        result.classList.remove("hidden");
        return;
    }

    result.className = "result";
    result.textContent = "Обрабатываем журнал...";
    result.classList.remove("hidden");

    try {
        const data = await api("ingest", { text, today });

        const stat = (n, label) => `<span><strong>${n ?? 0}</strong> ${label}</span>`;

        let html = `
            <div class="ingest-summary">
                <h3>Обработка завершена</h3>
                <div class="ingest-stats">
                    ${stat(data.parsed, "найдено событий")}
                    ${stat(data.added, "добавлено")}
                    ${stat(data.changed, "изменено")}
                    ${stat(data.removed, "удалено")}
                    ${stat(data.transferred, "переведено из КМБ")}
                    ${stat(data.duplicates, "дубликатов")}
                    ${stat(data.ignored, "проигнорировано")}
                </div>
            </div>
        `;

        const details = Array.isArray(data.details) ? data.details : [];
        const by = list => details.filter(i => list.includes(i.processed));

        html += ingestGroup("success", "🟢 Добавлены", by(["added"]), item => `
            ${personHead(item)}
            <div>Звание: ${escapeHtml(item.rank || "—")}</div>
            <div>Подразделение: ${escapeHtml(item.unit || "—")}</div>
        `);

        html += ingestGroup("warning", "🟡 Изменения",
            by(["changed", "promo_kmb", "promoted_to_junior_sergeant", "moved_to_no_unit", "joined_kmb", "joined_no_unit"]),
            item => `
                ${personHead(item)}
                <div class="ingest-message">${escapeHtml(item.message || "")}</div>
                ${changesHtml(item.changes)}
            `);

        html += ingestGroup("danger", "🔴 Уволены", by(["fired"]), item => `
            ${personHead(item)}
            ${item.reason ? `<div>Причина: ${escapeHtml(item.reason)}</div>` : ""}
        `);

        html += ingestGroup("transfer", "🟠 Переведены из КМБ", by(["transferred_from_kmb"]), item => `
            ${personHead(item)}
            <div>${escapeHtml(item.message || "")}</div>
        `);

        html += ingestGroup("muted", "⚪ Проигнорированы",
            by(["ignored_other_unit", "ignored_unknown", "ignored_old", "ignored_invalid_transfer", "fire_not_found", "ignore", "ignored"]),
            item => `
                ${personHead(item)}
                <div>${escapeHtml(item.message || "Событие проигнорировано")}</div>
            `);

        html += ingestGroup("duplicate", "🟣 Дубликаты", by(["duplicate"]), item => `
            ${personHead(item)}
            <div>Это событие уже было обработано ранее.</div>
        `);

        const bad = Array.isArray(data.bad) ? data.bad : [];
        html += ingestGroup("danger", "❌ Нераспознанные события", bad.slice(0, 20), item => escapeHtml(item));

        if (!details.length && !bad.length) {
            html += `<div class="ingest-empty">Событий для изменения данных не найдено.</div>`;
        }

        result.className = "result success";
        result.innerHTML = html;

        await load();
    } catch (error) {
        result.className = "result error";
        result.textContent = error.message;
    }
}

/* =========================
   SEED
========================= */
async function seed() {
    const text = $("seedInput").value.trim();
    const result = $("seedResult");

    if (!text) {
        result.className = "result error";
        result.textContent = "Введите список военнослужащих.";
        result.classList.remove("hidden");
        return;
    }

    try {
        const data = await api("seed", { text });

        result.className = "result success";
        result.textContent =
            `Импортировано: ${data.added ?? 0}.` +
            (data.skipped ? ` Уже были в таблице (не изменены): ${data.skipped}.` : "");
        result.classList.remove("hidden");

        await load();
    } catch (error) {
        result.className = "result error";
        result.textContent = error.message;
        result.classList.remove("hidden");
    }
}

/* =========================
   DIGEST
========================= */
async function sendDigest() {
    try {
        const data = await api("digest");
        alert(data.message || "Сводка отправлена.");
    } catch (error) {
        alert("Ошибка отправки:\n\n" + error.message);
    }
}

/* =========================
   MODALS
========================= */
let modalStaticId = null;

function openModal(id) {
    $(id).classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeModals() {
    $("editModal").classList.add("hidden");
    $("removeModal").classList.add("hidden");
    document.body.classList.remove("modal-open");
    modalStaticId = null;
}

function findPerson(staticId) {
    return people.find(p => p.staticId === staticId);
}

/* ----- EDIT ----- */
function openEditModal(staticId) {
    const person = findPerson(staticId);
    if (!person) return;

    modalStaticId = staticId;

    $("editModalSubtitle").textContent = `${person.name} • ${person.staticId} • ${person.unit || "—"}`;
    $("editEnlisted").value = toInputValue(person.enlisted);
    $("editNote").value = person.note || "";
    $("editModalError").textContent = "";

    const noUnit = isNoUnitStatus(person);
    $("editNoUnitGroup").classList.toggle("hidden", !noUnit);
    $("editNoUnit").value = noUnit ? toInputValue(person.noUnitSince || person.statusSince) : "";

    openModal("editModal");
    $("editEnlisted").focus();
}

async function submitEdit() {
    const staticId = modalStaticId;
    const person = findPerson(staticId);
    if (!person) return;

    const btn = $("editSaveBtn");
    const error = $("editModalError");
    error.textContent = "";

    btn.disabled = true;
    btn.textContent = "Сохранение...";

    try {
        await api("update", {
            type: "setDates",
            staticId,
            enlisted: fromInputValue($("editEnlisted").value),
            noUnitSince: isNoUnitStatus(person) ? fromInputValue($("editNoUnit").value) : "",
            note: $("editNote").value
        });

        closeModals();
        await load();
    } catch (err) {
        error.textContent = "Ошибка изменения: " + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = "Сохранить";
    }
}

/* ----- REMOVE ----- */
function openRemoveModal(staticId) {
    const person = findPerson(staticId);
    if (!person) return;

    modalStaticId = staticId;

    $("removeModalText").textContent =
        `Удалить ${person.name} (${person.staticId}) из учёта КМБ? Запись будет удалена из таблицы.`;
    $("removeModalError").textContent = "";

    openModal("removeModal");
}

async function submitRemove() {
    const staticId = modalStaticId;
    if (!staticId) return;

    const btn = $("removeConfirmBtn");
    const error = $("removeModalError");
    error.textContent = "";

    btn.disabled = true;
    btn.textContent = "Удаление...";

    try {
        await api("update", { type: "remove", staticId });
        closeModals();
        await load();
    } catch (err) {
        error.textContent = "Ошибка удаления: " + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = "Удалить";
    }
}

/* =========================
   EVENTS
========================= */
document.addEventListener("DOMContentLoaded", () => {

    const now = new Date();
    $("todayInput").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    $("loginBtn").addEventListener("click", login);
    $("passwordInput").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
    $("logoutBtn").addEventListener("click", logout);
    $("digestBtn").addEventListener("click", sendDigest);
    $("ingestBtn").addEventListener("click", ingest);
    $("seedBtn").addEventListener("click", seed);

    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
            tab.classList.add("active");
            currentFilter = tab.dataset.filter;
            render();
        });
    });

    $("unitFilter").addEventListener("change", e => {
        unitFilter = e.target.value;
        render();
    });

    $("sortSelect").addEventListener("change", e => {
        sortMode = e.target.value;
        render();
    });

    $("peopleBody").addEventListener("click", event => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const staticId = button.dataset.static;
        if (button.dataset.action === "edit") openEditModal(staticId);
        if (button.dataset.action === "remove") openRemoveModal(staticId);
    });

    // Модальные окна
    document.querySelectorAll(".modal [data-close]").forEach(el => el.addEventListener("click", closeModals));
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeModals(); });
    $("editSaveBtn").addEventListener("click", submitEdit);
    $("removeConfirmBtn").addEventListener("click", submitRemove);

    if (password) {
        api("list")
            .then(data => {
                people = Array.isArray(data.people) ? data.people : [];
                $("loginPanel").classList.add("hidden");
                $("mainPanel").classList.remove("hidden");
                render();
            })
            .catch(() => {
                password = "";
                localStorage.removeItem("kmb_pw");
            });
    }

    setInterval(() => {
        if (!$("mainPanel").classList.contains("hidden")) render();
    }, 60 * 1000);

    setInterval(() => {
        if (!$("mainPanel").classList.contains("hidden")) silentLoad();
    }, 5 * 60 * 1000);
});

/* =========================================================
   ОТЧЁТЫ
========================================================= */
const reportResult = $("reportResult");
const reportResultTitle = $("reportResultTitle");
const reportText = $("reportText");
const copyReportButton = $("copyReportButton");
const reportCopyStatus = $("reportCopyStatus");

function showReport(title, text) {
    reportResultTitle.textContent = title;
    reportText.value = text || "";
    reportResult.hidden = false;
    reportCopyStatus.textContent = "";
    reportResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    reportText.focus();
    reportText.select();
}

function bindReportButton(buttonId, label, title, key) {
    const button = $(buttonId);
    if (!button) return;

    button.addEventListener("click", async () => {
        try {
            button.disabled = true;
            button.textContent = "⏳ Формирование...";
            const reports = await api("reports");
            showReport(title, reports[key].text);
        } catch (error) {
            console.error(error);
            alert("Не удалось сформировать отчёт:\n" + error.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    });
}

bindReportButton("generateNotificationReport", "📢 Сформировать отчёт оповещения", "📢 Отчёт оповещения", "notification");
bindReportButton("generateSeniorReport", "📋 Сформировать отчёт старшему составу", "📋 Отчёт старшему составу", "senior");

if (copyReportButton) {
    copyReportButton.addEventListener("click", async () => {
        const text = reportText.value;
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            reportCopyStatus.textContent = "✓ Отчёт скопирован в буфер обмена.";
        } catch (error) {
            reportText.focus();
            reportText.select();
            document.execCommand("copy");
            reportCopyStatus.textContent = "✓ Отчёт скопирован.";
        }
    });
}
