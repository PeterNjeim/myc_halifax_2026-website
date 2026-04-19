const SHEET_URL = "https://opensheet.elk.sh/1Sbs6P_5nYPKJPacHhh5f12cRY8nByyOFLfkbhN6FPyw/schedule";

const TIMEZONE = "America/Halifax";
const OFFSET = "-03:00";
const REFRESH_MS = 30000;

// --- STATE ---
const dayMap = new Map(); // dayKey → { container, titleEl }
const eventMap = new Map(); // eventKey → { root, title, time, dot, countdown }
let currentEvents = [];

// --- HELPERS ---
function getEventKey(e) {
    return e.title + "|" + e.start.getTime();
}

function getNextEvent(events, now) {
    return events.find(e => e.start > now) || null;
}

function getDayKey(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function parseADT(str) {
    if (!str) return null;

    const iso = str.replace(" ", "T") + OFFSET;
    return new Date(iso);
}

// --- FORMAT (localized automatically) ---
function formatTime(date) {
    return date.toLocaleTimeString([], {
        timeStyle: "short",
        timeZone: TIMEZONE,
    });
}

function formatDay(date) {
    return date.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: TIMEZONE,
    });
}

function getNow() {
    return new Date();
}

function formatRelativeTime(ms) {
    const rtf = new Intl.RelativeTimeFormat([], { numeric: "auto" });

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (Math.abs(seconds) < 60) return rtf.format(seconds, "second");
    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    return rtf.format(days, "day");
}
// --- PROCESS ---
function processEvents(raw) {
    let events = raw
        .map((e) => ({
            title: e.title,
            start: parseADT(e.start),
            end: parseADT(e.end),
        }))
        .filter((e) => e.start)
        .sort((a, b) => a.start - b.start);

    for (let i = 0; i < events.length; i++) {
        if (!events[i].end) {
            if (i < events.length - 1) {
                events[i].end = events[i + 1].start;
            } else {
                events[i].end = new Date(events[i].start.getTime() + 60 * 60 * 1000);
            }
        }
    }

    return events;
}

// --- DOM CREATION ---
function createDaySection(dayKey, date) {
    const container = document.createElement("div");
    container.className = "day";

    const title = document.createElement("h2");
    title.textContent = formatDay(date);

    container.appendChild(title);

    document.getElementById("schedule").appendChild(container);

    dayMap.set(dayKey, { container, titleEl: title });

    return container;
}

function createEventElement(e) {
    const root = document.createElement("div");
    root.className = "event";

    const title = document.createElement("strong");
    title.textContent = e.title;

    const dot = document.createElement("span");
    dot.className = "live-dot";
    dot.style.display = "none";

    const countdown = document.createElement("span");
    countdown.className = "countdown";

    const br = document.createElement("br");

    const space = document.createTextNode(" ");

    const time = document.createElement("span");

    root.appendChild(dot);
    root.appendChild(title);
    root.appendChild(countdown);
    root.appendChild(br);
    root.appendChild(space);
    root.appendChild(time);

    return { root, title, dot, countdown, br, time };
}

// --- UPDATE ---
function updateEventElement(ref, e, now, isNext) {
    const isPast = e.end < now;
    const isLive = now >= e.start && now < e.end;

    const newState = isPast ? "past" : isLive ? "live" : "future";

    // if (ref._state !== newState) {
    ref._state = newState;

    ref.root.className = "event";
    if (isPast) ref.root.classList.add("past");
    if (isLive) ref.root.classList.add("live");

    // Live dot
    ref.dot.style.display = isLive ? "inline-block" : "none";

    ref.br.style.display = isPast ? "none" : "inline";

    // Time
    ref.time.textContent = `${formatTime(e.start)} - ${formatTime(e.end)}`;

    // Countdown
    if (isNext && !isLive) {
        const diff = e.start - now;
        ref.countdown.textContent =
            diff > 0 ? " " + formatRelativeTime(diff) : "";
    } else {
        ref.countdown.textContent = "";
    }
    // }
}

// --- RENDER ---
function render(events) {
    const now = getNow();

    // const upcoming = events.filter((e) => e.start > now);
    const nextEvent = getNextEvent(currentEvents, now);

    const seen = new Set();

    for (const e of events) {
        const key = getEventKey(e);
        seen.add(key);

        const dayKey = getDayKey(e.start);

        let daySection = dayMap.get(dayKey);
        if (!daySection) {
            daySection = { container: createDaySection(dayKey, e.start) };
        }

        let ref = eventMap.get(key);

        if (!ref) {
            ref = createEventElement(e);
            ref.root._event = e;
            daySection.container.appendChild(ref.root);
            eventMap.set(key, ref);
        } else {
            ref.root._event = e;
        }

        updateEventElement(ref, e, now, e === nextEvent);
    }

    // Cleanup removed events
    for (const [key, ref] of eventMap.entries()) {
        if (!seen.has(key)) {
            ref.root.remove();
            eventMap.delete(key);
        }
    }
}

// --- LOAD ---
async function loadSchedule() {
        const res = await fetch(SHEET_URL, {
        cache: "no-store",
        });
        const data = await res.json();

        const events = processEvents(data);
    currentEvents = events;
        render(events);
}

setInterval(() => {
    const now = getNow();

    if (!currentEvents.length) return;

    // Determine next event from source data (not DOM)
    let nextEvent = getNextEvent(currentEvents, now);

    for (const e of currentEvents) {
        if (e.start > now) {
            if (!nextEvent || e.start < nextEvent.start) {
                nextEvent = e;
            }
        }
    }

    // Update all DOM nodes based on real data
    for (const [, ref] of eventMap.entries()) {
        const e = ref.root._event;

        updateEventElement(ref, e, now, e === nextEvent);
    }

}, 1000);

// --- INIT ---
loadSchedule();
setInterval(loadSchedule, REFRESH_MS);
