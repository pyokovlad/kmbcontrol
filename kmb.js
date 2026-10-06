"use strict";

/*
    URL опубликованного Google Apps Script.
    Если после нового развёртывания URL изменится —
    замените его здесь.
*/

const API_URL =
    "https://script.google.com/macros/s/AKfycbzHgnnwLnRL0P8HFdn0EB6l4JF3v40973lfMePXMQO6gAypTHfg304sT2tNhEP8k3IA/exec";


let password = localStorage.getItem("kmb_pw") || "";

let people = [];

let currentFilter = "urgent";


/* =========================
   API
========================= */

async function api(action, extra = {}) {
    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
            password,
            action,
            ...extra
        })
    });

    const raw = await response.text();

    if (!response.ok) {
        console.error(
            `Ошибка HTTP ${response.status} при выполнении "${action}":`,
            raw
        );

        throw new Error(
            `Ошибка сервера: HTTP ${response.status}.`
        );
    }

    let data;

    try {
        data = JSON.parse(raw);
    } catch (error) {
        console.error(
            `Google Apps Script вернул некорректный ответ для "${action}":`,
            raw
        );

        throw new Error(
            "Сервер вернул некорректный ответ."
        );
    }

    if (!data.ok) {
        throw new Error(
            data.error || "Неизвестная ошибка сервера."
        );
    }

    return data;
}


/* =========================
   DATE
========================= */

function parseDate(value) {

    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return value;
    }

    const str = String(value).trim();

    const match = str.match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
    );

    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);

    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);

    return new Date(
        year,
        month,
        day,
        hour,
        minute,
        0
    );
}


function formatDate(value) {

    const date = parseDate(value);

    if (!date) {
        return "—";
    }

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
}


function formatDateTime(value) {

    const date = parseDate(value);

    if (!date) {
        return "—";
    }

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");

    return `${day}.${month}.${year} ${hour}:${minute}`;
}


/* =========================
   TIME
========================= */

function levelOf(person) {

    if (!person.deadline) {
        return "ok";
    }

    const deadline = parseDate(person.deadline);

    if (!deadline) {
        return "ok";
    }

    const diff = deadline.getTime() - Date.now();

    if (diff <= 0) {
        return "late";
    }

    if (diff <= 24 * 60 * 60 * 1000) {
        return "soon";
    }

    return "ok";
}


function formatDuration(milliseconds) {

    if (!Number.isFinite(milliseconds)) {
        return "—";
    }

    if (milliseconds <= 0) {
        return "СРОК ВЫШЕЛ";
    }

    const totalMinutes =
        Math.floor(milliseconds / 60000);

    const days =
        Math.floor(totalMinutes / 1440);

    const hours =
        Math.floor(
            (totalMinutes % 1440) / 60
        );

    const minutes =
        totalMinutes % 60;

    if (days > 0) {
        return `${days} д. ${hours} ч.`;
    }

    if (hours > 0) {
        return `${hours} ч. ${minutes} мин.`;
    }

    return `${minutes} мин.`;
}


function remaining(person) {

    if (!person.deadline) {
        return "—";
    }

    const deadline = parseDate(person.deadline);

    if (!deadline) {
        return "—";
    }

    return formatDuration(
        deadline.getTime() - Date.now()
    );
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
        .replaceAll("'", "&#039;");
}


/* =========================
   STATUS
========================= */

function statusText(person) {

    if (person.status === "Без подразделения") {
        return "Без подразделения";
    }

    if (person.status === "КМБ") {
        return "КМБ";
    }

    if (person.status === "В подразделении") {
        return "В подразделении";
    }

    return person.status || "—";
}


function statusClass(person) {

    if (person.status === "Без подразделения") {
        return "status--nounit";
    }

    if (person.status === "КМБ") {
        return "status--kmb";
    }

    return "status--unit";
}


/* =========================
   RENDER
========================= */

function getFilteredPeople() {

    switch (currentFilter) {

        case "urgent":

            return people.filter(person => {

                const level = levelOf(person);

                return (
                    level === "late" ||
                    level === "soon"
                );
            });


        case "kmb":

            return people.filter(
                person =>
                    person.status === "КМБ"
            );


        case "nounit":

            return people.filter(
                person =>
                    person.status === "Без подразделения"
            );


        case "all":

            return [...people];


        default:

            return [];
    }
}


function render() {

    updateCounters();

    const body =
        document.getElementById("peopleBody");

    const empty =
        document.getElementById("emptyState");

    const list =
        getFilteredPeople();

    body.innerHTML = "";

    if (list.length === 0) {

        empty.classList.remove("hidden");

        return;
    }

    empty.classList.add("hidden");


    for (const person of list) {

        const tr =
            document.createElement("tr");

        const level =
            levelOf(person);

        const levelClass =
            level === "late"
                ? "deadline--late"
                : level === "soon"
                    ? "deadline--soon"
                    : "deadline--ok";


        const composerName =
            person.composerName || "—";

        const composerStatic =
            person.composerStatic || "—";


        tr.innerHTML = `

            <td>
                <div class="person-name">
                    ${escapeHtml(person.name)}
                </div>
            </td>

            <td>
                <span class="static">
                    ${escapeHtml(person.staticId)}
                </span>
            </td>

            <td>
                ${escapeHtml(person.rank || "—")}
            </td>

            <td>
                ${escapeHtml(person.unit || "—")}
            </td>

            <td>
                <div class="composer">
                    <div class="composer__name">
                        ${escapeHtml(composerName)}
                    </div>

                    <div class="composer__static">
                        ${escapeHtml(composerStatic)}
                    </div>
                </div>
            </td>

            <td>
                <span class="status ${statusClass(person)}">
                    ${escapeHtml(statusText(person))}
                </span>
            </td>

            <td>
                ${formatDateTime(person.enlisted)}
            </td>

            <td>
                <span class="deadline ${levelClass}">
                    ${formatDateTime(person.deadline)}
                </span>
            </td>

            <td>
                <span class="deadline ${levelClass}">
                    ${escapeHtml(remaining(person))}
                </span>
            </td>

            <td>

                <div class="action-buttons">

                    <button
                        data-action="edit"
                        data-static="${escapeHtml(person.staticId)}"
                    >
                        Изменить
                    </button>

                    <button
                        class="danger"
                        data-action="remove"
                        data-static="${escapeHtml(person.staticId)}"
                    >
                        Удалить
                    </button>

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

    let late = 0;
    let soon = 0;
    let ok = 0;

    for (const person of people) {

        const level = levelOf(person);

        if (level === "late") {
            late++;
        } else if (level === "soon") {
            soon++;
        } else {
            ok++;
        }
    }


    document.getElementById("lateCount").textContent =
        late;

    document.getElementById("soonCount").textContent =
        soon;

    document.getElementById("okCount").textContent =
        ok;

    document.getElementById("totalCount").textContent =
        people.length;


    document.getElementById("tabUrgentCount").textContent =
        late + soon;

    document.getElementById("tabKmbCount").textContent =
        people.filter(
            p => p.status === "КМБ"
        ).length;

    document.getElementById("tabNoUnitCount").textContent =
        people.filter(
            p => p.status === "Без подразделения"
        ).length;

    document.getElementById("tabAllCount").textContent =
        people.length;
}


/* =========================
   LOAD
========================= */

async function load() {
    try {
        const data = await api("list");

        people = Array.isArray(data.people)
            ? data.people
            : [];

        render();

        return true;

    } catch (error) {
        console.error(
            "Не удалось загрузить данные:",
            error
        );

        alert(
            "Не удалось загрузить данные:\n\n" +
            error.message
        );

        return false;
    }
}

async function silentLoad() {
    try {
        const data = await api("list");

        people = Array.isArray(data.people)
            ? data.people
            : [];

        render();

        return true;

    } catch (error) {
        console.warn(
            "Фоновое обновление данных не выполнено:",
            error
        );

        return false;
    }
}

/* =========================
   LOGIN
========================= */

async function login() {

    const input =
        document.getElementById("passwordInput");

    const error =
        document.getElementById("loginError");

    const value =
        input.value.trim();

    if (!value) {

        error.textContent =
            "Введите пароль.";

        return;
    }

    password = value;

    try {

        const data =
            await api("list");

        people =
            Array.isArray(data.people)
                ? data.people
                : [];

        localStorage.setItem(
            "kmb_pw",
            password
        );

        document
            .getElementById("loginPanel")
            .classList.add("hidden");

        document
            .getElementById("mainPanel")
            .classList.remove("hidden");

        error.textContent = "";

        render();

    } catch (err) {

        password = "";

        error.textContent =
            err.message ||
            "Неверный пароль.";
    }
}


/* =========================
   LOGOUT
========================= */

function logout() {

    password = "";

    localStorage.removeItem("kmb_pw");

    document
        .getElementById("mainPanel")
        .classList.add("hidden");

    document
        .getElementById("loginPanel")
        .classList.remove("hidden");

    document
        .getElementById("passwordInput")
        .value = "";
}


/* =========================
   INGEST
========================= */

async function ingest() {

    const text =
        document
            .getElementById("logInput")
            .value
            .trim();


    const today =
        document
            .getElementById("todayInput")
            .value;


    const result =
        document
            .getElementById("ingestResult");


    if (!text) {

        result.className =
            "result error";

        result.textContent =
            "Вставьте сообщения журнала.";

        result.classList.remove(
            "hidden"
        );

        return;
    }


    result.className =
        "result";

    result.textContent =
        "Обрабатываем журнал...";

    result.classList.remove(
        "hidden"
    );


    try {

        const data =
            await api(
                "ingest",
                {
                    text,
                    today
                }
            );


        let html = `

            <div class="ingest-summary">

                <h3>Обработка завершена</h3>

                <div class="ingest-stats">

                    <span>
                        <strong>${data.parsed ?? 0}</strong>
                        найдено событий
                    </span>

                    <span>
                        <strong>${data.added ?? 0}</strong>
                        добавлено
                    </span>

                    <span>
                        <strong>${data.changed ?? 0}</strong>
                        изменено
                    </span>

                    <span>
                        <strong>${data.removed ?? 0}</strong>
                        удалено
                    </span>

                    <span>
                        <strong>${data.transferred ?? 0}</strong>
                        переведено из КМБ
                    </span>

                    <span>
                        <strong>${data.duplicates ?? 0}</strong>
                        дубликатов
                    </span>

                    <span>
                        <strong>${data.ignored ?? 0}</strong>
                        проигнорировано
                    </span>

                </div>

            </div>

        `;


        const details =
            Array.isArray(data.details)
                ? data.details
                : [];


        /* =================================================
           ДОБАВЛЕНЫ
        ================================================= */

        const added =
            details.filter(
                item =>
                    item.processed ===
                    "added"
            );


        if (added.length) {

            html += `

                <div class="ingest-group ingest-group--success">

                    <h3>🟢 Добавлены</h3>

                    <div class="ingest-list">

                        ${added.map(item => `

                            <div class="ingest-item">

                                <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                </strong>

                                <code>
                                    ${escapeHtml(
                                        item.staticId
                                    )}
                                </code>

                                <div>
                                    Звание:
                                    ${escapeHtml(
                                        item.rank || "—"
                                    )}
                                </div>

                                <div>
                                    Подразделение:
                                    ${escapeHtml(
                                        item.unit || "—"
                                    )}
                                </div>

                            </div>

                        `).join("")}

                    </div>

                </div>

            `;
        }


        /* =================================================
           ИЗМЕНЕНЫ
        ================================================= */

        const changed =
            details.filter(
                item =>
                    [
                        "changed",
                        "promo_kmb",
                        "promoted_to_junior_sergeant",
                        "moved_to_no_unit",
                        "joined_kmb",
                        "joined_no_unit"
                    ].includes(
                        item.processed
                    )
            );


        if (changed.length) {

            html += `

                <div class="ingest-group ingest-group--warning">

                    <h3>🟡 Изменения</h3>

                    <div class="ingest-list">

                        ${changed.map(item => {

                            const changes =
                                item.changes || {};


                            let changesHtml =
                                "";


                            if (
                                changes.rank &&
                                (
                                    changes.rank.old !==
                                    changes.rank.new
                                )
                            ) {

                                changesHtml += `

                                    <div>
                                        Звание:
                                        <span class="old-value">
                                            ${escapeHtml(
                                                changes.rank.old || "—"
                                            )}
                                        </span>

                                        →

                                        <strong>
                                            ${escapeHtml(
                                                changes.rank.new || "—"
                                            )}
                                        </strong>
                                    </div>

                                `;
                            }


                            if (
                                changes.unit &&
                                (
                                    changes.unit.old !==
                                    changes.unit.new
                                )
                            ) {

                                changesHtml += `

                                    <div>
                                        Подразделение:
                                        <span class="old-value">
                                            ${escapeHtml(
                                                changes.unit.old || "—"
                                            )}
                                        </span>

                                        →

                                        <strong>
                                            ${escapeHtml(
                                                changes.unit.new || "—"
                                            )}
                                        </strong>
                                    </div>

                                `;
                            }


                            if (
                                changes.status &&
                                (
                                    changes.status.old !==
                                    changes.status.new
                                )
                            ) {

                                changesHtml += `

                                    <div>
                                        Статус:
                                        <span class="old-value">
                                            ${escapeHtml(
                                                changes.status.old || "—"
                                            )}
                                        </span>

                                        →

                                        <strong>
                                            ${escapeHtml(
                                                changes.status.new || "—"
                                            )}
                                        </strong>
                                    </div>

                                `;
                            }


                            return `

                                <div class="ingest-item">

                                    <strong>
                                        ${escapeHtml(
                                            item.name
                                        )}
                                    </strong>

                                    <code>
                                        ${escapeHtml(
                                            item.staticId
                                        )}
                                    </code>

                                    <div class="ingest-message">
                                        ${escapeHtml(
                                            item.message || ""
                                        )}
                                    </div>

                                    ${changesHtml}

                                </div>

                            `;

                        }).join("")}

                    </div>

                </div>

            `;
        }


        /* =================================================
           УВОЛЕНЫ
        ================================================= */

        const fired =
            details.filter(
                item =>
                    item.processed ===
                    "fired"
            );


        if (fired.length) {

            html += `

                <div class="ingest-group ingest-group--danger">

                    <h3>🔴 Уволены</h3>

                    <div class="ingest-list">

                        ${fired.map(item => `

                            <div class="ingest-item">

                                <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                </strong>

                                <code>
                                    ${escapeHtml(
                                        item.staticId
                                    )}
                                </code>

                                ${
                                    item.reason
                                        ? `
                                            <div>
                                                Причина:
                                                ${escapeHtml(
                                                    item.reason
                                                )}
                                            </div>
                                        `
                                        : ""
                                }

                            </div>

                        `).join("")}

                    </div>

                </div>

            `;
        }


        /* =================================================
           ПЕРЕВЕДЕНЫ ИЗ КМБ
        ================================================= */

        const transferred =
            details.filter(
                item =>
                    item.processed ===
                    "transferred_from_kmb"
            );


        if (transferred.length) {

            html += `

                <div class="ingest-group ingest-group--transfer">

                    <h3>🟠 Переведены из КМБ</h3>

                    <div class="ingest-list">

                        ${transferred.map(item => `

                            <div class="ingest-item">

                                <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                </strong>

                                <code>
                                    ${escapeHtml(
                                        item.staticId
                                    )}
                                </code>

                                <div>
                                    ${escapeHtml(
                                        item.message
                                    )}
                                </div>

                            </div>

                        `).join("")}

                    </div>

                </div>

            `;
        }


        /* =================================================
           ПРОИГНОРИРОВАНЫ
        ================================================= */

        const ignored =
            details.filter(
                item =>
                    [
                        "ignored_other_unit",
                        "ignored_unknown",
                        "ignored_old",
                        "ignored_invalid_transfer",
                        "ignore",
                        "ignored"
                    ].includes(
                        item.processed
                    )
            );


        if (ignored.length) {

            html += `

                <div class="ingest-group ingest-group--muted">

                    <h3>⚪ Проигнорированы</h3>

                    <div class="ingest-list">

                        ${ignored.map(item => `

                            <div class="ingest-item">

                                <strong>
                                    ${escapeHtml(
                                        item.name ||
                                        "Неизвестный военнослужащий"
                                    )}
                                </strong>

                                ${
                                    item.staticId
                                        ? `
                                            <code>
                                                ${escapeHtml(
                                                    item.staticId
                                                )}
                                            </code>
                                        `
                                        : ""
                                }

                                <div>
                                    ${escapeHtml(
                                        item.message ||
                                        "Событие проигнорировано"
                                    )}
                                </div>

                            </div>

                        `).join("")}

                    </div>

                </div>

            `;
        }


        /* =================================================
           ДУБЛИКАТЫ
        ================================================= */

        const duplicates =
            details.filter(
                item =>
                    item.processed ===
                    "duplicate"
            );


        if (
            duplicates.length
        ) {

            html += `

                <div class="ingest-group ingest-group--duplicate">

                    <h3>🟣 Дубликаты</h3>

                    <div class="ingest-list">

                        ${duplicates.map(item => `

                            <div class="ingest-item">

                                <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                </strong>

                                <code>
                                    ${escapeHtml(
                                        item.staticId
                                    )}
                                </code>

                                <div>
                                    Это событие уже было обработано ранее.
                                </div>

                            </div>

                        `).join("")}

                    </div>

                </div>

            `;
        }


        /* =================================================
           НЕРАСПОЗНАННЫЕ
        ================================================= */

        if (
            Array.isArray(data.bad) &&
            data.bad.length
        ) {

            html += `

                <div class="ingest-group ingest-group--danger">

                    <h3>❌ Нераспознанные события</h3>

                    <div class="ingest-list">

                        ${data.bad
                            .slice(0, 20)
                            .map(
                                item => `

                                    <div class="ingest-item">

                                        ${escapeHtml(
                                            item
                                        )}

                                    </div>

                                `
                            )
                            .join("")}

                    </div>

                </div>

            `;
        }


        /*
         * Если вообще никаких подробностей нет.
         */

        if (
            !details.length &&
            !(
                Array.isArray(data.bad) &&
                data.bad.length
            )
        ) {

            html += `

                <div class="ingest-empty">

                    Событий для изменения данных не найдено.

                </div>

            `;
        }


        result.className =
            "result success";

        result.innerHTML =
            html;


        await load();

    } catch (error) {

        result.className =
            "result error";

        result.textContent =
            error.message;
    }
}


/* =========================
   SEED
========================= */

async function seed() {

    const text =
        document.getElementById("seedInput")
            .value
            .trim();

    const result =
        document.getElementById("seedResult");


    if (!text) {

        result.className =
            "result error";

        result.textContent =
            "Введите список военнослужащих.";

        result.classList.remove("hidden");

        return;
    }


    try {

        const data =
            await api("seed", {
                text
            });


        result.className =
            "result success";

        result.textContent =
            `Импортировано: ${data.added ?? 0}.`;


        await load();


    } catch (error) {

        result.className =
            "result error";

        result.textContent =
            error.message;

        result.classList.remove("hidden");
    }
}


/* =========================
   DIGEST
========================= */

async function sendDigest() {

    try {

        const data =
            await api("digest");

        alert(
            data.message ||
            "Сводка отправлена."
        );

    } catch (error) {

        alert(
            "Ошибка отправки:\n\n" +
            error.message
        );
    }
}


/* =========================
   EDIT
========================= */

async function editPerson(staticId) {

    const person =
        people.find(
            p => p.staticId === staticId
        );

    if (!person) {
        return;
    }


    const enlisted =
        prompt(
            "Дата зачисления на КМБ:\nДД.ММ.ГГГГ ЧЧ:ММ",
            formatDateTime(person.enlisted)
        );


    if (enlisted === null) {
        return;
    }


    let noUnitStart = "";

    if (
        person.status ===
        "Без подразделения"
    ) {

        noUnitStart =
            prompt(
                "Дата начала срока без подразделения:\nДД.ММ.ГГГГ ЧЧ:ММ",
                formatDateTime(person.statusSince)
            );

        if (noUnitStart === null) {
            return;
        }
    }


    try {

        await api("update", {

            type: "setDates",

            staticId,

            enlisted,

            noUnitStart
        });


        await load();


    } catch (error) {

        alert(
            "Ошибка изменения:\n\n" +
            error.message
        );
    }
}


/* =========================
   REMOVE
========================= */

async function removePerson(staticId) {

    const person =
        people.find(
            p => p.staticId === staticId
        );

    if (!person) {
        return;
    }


    const confirmed =
        confirm(
            `Удалить ${person.name} (${staticId}) из учёта КМБ?`
        );


    if (!confirmed) {
        return;
    }


    try {

        await api("update", {

            type: "remove",

            staticId
        });


        await load();


    } catch (error) {

        alert(
            "Ошибка удаления:\n\n" +
            error.message
        );
    }
}


/* =========================
   EVENTS
========================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const today =
            document.getElementById("todayInput");

        const now =
            new Date();

        const yyyy =
            now.getFullYear();

        const mm =
            String(
                now.getMonth() + 1
            ).padStart(2, "0");

        const dd =
            String(
                now.getDate()
            ).padStart(2, "0");

        today.value =
            `${yyyy}-${mm}-${dd}`;


        document
            .getElementById("loginBtn")
            .addEventListener(
                "click",
                login
            );


        document
            .getElementById("passwordInput")
            .addEventListener(
                "keydown",
                event => {

                    if (
                        event.key === "Enter"
                    ) {
                        login();
                    }

                }
            );


        document
            .getElementById("logoutBtn")
            .addEventListener(
                "click",
                logout
            );


        document
            .getElementById("digestBtn")
            .addEventListener(
                "click",
                sendDigest
            );


        document
            .getElementById("ingestBtn")
            .addEventListener(
                "click",
                ingest
            );


        document
            .getElementById("seedBtn")
            .addEventListener(
                "click",
                seed
            );


        document
            .querySelectorAll(".tab")
            .forEach(tab => {

                tab.addEventListener(
                    "click",
                    () => {

                        document
                            .querySelectorAll(".tab")
                            .forEach(
                                x =>
                                    x.classList.remove(
                                        "active"
                                    )
                            );

                        tab.classList.add("active");

                        currentFilter =
                            tab.dataset.filter;

                        render();
                    }
                );

            });


        document
            .getElementById("peopleBody")
            .addEventListener(
                "click",
                event => {

                    const button =
                        event.target.closest(
                            "button[data-action]"
                        );

                    if (!button) {
                        return;
                    }

                    const action =
                        button.dataset.action;

                    const staticId =
                        button.dataset.static;


                    if (action === "edit") {
                        editPerson(staticId);
                    }

                    if (action === "remove") {
                        removePerson(staticId);
                    }

                }
            );


        if (password) {

            api("list")
                .then(data => {

                    people =
                        Array.isArray(data.people)
                            ? data.people
                            : [];

                    document
                        .getElementById("loginPanel")
                        .classList.add("hidden");

                    document
                        .getElementById("mainPanel")
                        .classList.remove("hidden");

                    render();

                })
                .catch(() => {

                    password = "";

                    localStorage.removeItem(
                        "kmb_pw"
                    );
                });
        }


        setInterval(
            () => {

                if (
                    !document
                        .getElementById("mainPanel")
                        .classList.contains("hidden")
                ) {
                    render();
                }

            },
            60 * 1000
        );


        setInterval(
          () => {
            if (
              !document.getElementById("mainPanel").classList.contains("hidden")
            ) {
              silentLoad();
            }
          },
          5 * 60 * 1000,
        );

    }
);
/* =========================================================
   ОТЧЁТЫ
========================================================= */

const generateNotificationReport =
    document.getElementById(
        "generateNotificationReport"
    );


const generateSeniorReport =
    document.getElementById(
        "generateSeniorReport"
    );


const reportResult =
    document.getElementById(
        "reportResult"
    );


const reportResultTitle =
    document.getElementById(
        "reportResultTitle"
    );


const reportText =
    document.getElementById(
        "reportText"
    );


const copyReportButton =
    document.getElementById(
        "copyReportButton"
    );


const reportCopyStatus =
    document.getElementById(
        "reportCopyStatus"
    );


async function loadReports() {

    const result =
        await api(
            "reports"
        );


    return result;
}


/**
 * Показывает отчёт.
 */
function showReport(
    title,
    text
) {

    reportResultTitle.textContent =
        title;


    reportText.value =
        text || "";


    reportResult.hidden =
        false;


    reportCopyStatus.textContent =
        "";


    /*
     * Прокручиваем страницу
     * к отчёту.
     */
    reportResult.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });


    /*
     * Автоматически выделяем текст.
     */
    reportText.focus();
    reportText.select();
}


/**
 * Отчёт оповещения.
 */
if (
    generateNotificationReport
) {

    generateNotificationReport
        .addEventListener(
            "click",
            async () => {

                try {

                    generateNotificationReport.disabled =
                        true;


                    generateNotificationReport.textContent =
                        "⏳ Формирование...";


                    const reports =
                        await loadReports();


                    showReport(
                        "📢 Отчёт оповещения",
                        reports.notification.text
                    );

                }

                catch (error) {

                    console.error(
                        error
                    );


                    alert(
                        "Не удалось сформировать отчёт:\n" +
                        error.message
                    );

                }

                finally {

                    generateNotificationReport.disabled =
                        false;


                    generateNotificationReport.textContent =
                        "📢 Сформировать отчёт оповещения";

                }

            }
        );

}


/**
 * Отчёт старшему составу.
 */
if (
    generateSeniorReport
) {

    generateSeniorReport
        .addEventListener(
            "click",
            async () => {

                try {

                    generateSeniorReport.disabled =
                        true;


                    generateSeniorReport.textContent =
                        "⏳ Формирование...";


                    const reports =
                        await loadReports();


                    showReport(
                        "📋 Отчёт старшему составу",
                        reports.senior.text
                    );

                }

                catch (error) {

                    console.error(
                        error
                    );


                    alert(
                        "Не удалось сформировать отчёт:\n" +
                        error.message
                    );

                }

                finally {

                    generateSeniorReport.disabled =
                        false;


                    generateSeniorReport.textContent =
                        "📋 Сформировать отчёт старшему составу";

                }

            }
        );

}


/**
 * Копирование отчёта.
 */
if (
    copyReportButton
) {

    copyReportButton
        .addEventListener(
            "click",
            async () => {

                const text =
                    reportText.value;


                if (!text) {
                    return;
                }


                try {

                    await navigator
                        .clipboard
                        .writeText(
                            text
                        );


                    reportCopyStatus.textContent =
                        "✓ Отчёт скопирован в буфер обмена.";


                }

                catch (error) {

                    /*
                     * Резервный способ
                     * для старых браузеров.
                     */
                    reportText.focus();
                    reportText.select();


                    document.execCommand(
                        "copy"
                    );


                    reportCopyStatus.textContent =
                        "✓ Отчёт скопирован.";

                }

            }
        );

}