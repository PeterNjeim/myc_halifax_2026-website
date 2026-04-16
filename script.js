const SHEET_URL = "https://opensheet.elk.sh/1Sbs6P_5nYPKJPacHhh5f12cRY8nByyOFLfkbhN6FPyw/schedule";

// --- CONFIG ---
const TIMEZONE = "America/Halifax"; // ADT
const OFFSET = "-03:00"; // fallback for parsing
const REFRESH_MS = 30000;

// --- PARSE ---
function parseADT(str) {
    if (!str) return null;

    const iso = str.replace(" ", "T") + OFFSET;
    return new Date(iso);
}

// --- FORMAT (localized automatically) ---
function formatTime(date) {
    return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TIMEZONE
    }).format(date);
}

function formatDay(date) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: TIMEZONE
    }).format(date);
}

// --- "NOW" in ADT ---
function getNowInADT() {
    // Convert current time into ADT context
    const now = new Date();

    // Trick: re-interpret "now" in Halifax timezone
    return new Date(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: TIMEZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        })
            .format(now)
            .replace(",", "")
            .replace(" ", "T")
    );
}

// --- PROCESS ---
function processEvents(raw) {
    let events = raw
        .map(e => ({
            title: e.title,
            start: parseADT(e.start),
            end: parseADT(e.end)
        }))
        .filter(e => e.start)
        .sort((a, b) => a.start - b.start);

    // Fill missing end times
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

// --- RENDER ---
function render(events) {
    const container = document.getElementById("schedule");
    container.innerHTML = "";

    const now = getNowInADT();

    const upcoming = events.filter(e => e.end > now);

    const grouped = {};
    for (const e of upcoming) {
        const key = new Intl.DateTimeFormat("en-CA", {
            timeZone: TIMEZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(e.start);

        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(e);
    }

    for (const dayKey of Object.keys(grouped)) {
        const dayEvents = grouped[dayKey];

        const dayDiv = document.createElement("div");
        dayDiv.className = "day";

        const title = document.createElement("h2");
        title.textContent = formatDay(dayEvents[0].start);
        dayDiv.appendChild(title);

        for (const e of dayEvents) {
            const div = document.createElement("div");
            div.className = "event";

            if (now >= e.start && now <= e.end) {
                div.classList.add("live");
            }

            div.innerHTML = `
        <strong>${e.title}</strong><br/>
        ${formatTime(e.start)} - ${formatTime(e.end)}
      `;

            dayDiv.appendChild(div);
        }

        container.appendChild(dayDiv);
    }
}

// --- LOAD ---
async function loadSchedule() {
    try {
        const res = await fetch(SHEET_URL);
        const data = await res.json();

        const events = processEvents(data);
        render(events);

    } catch (err) {
        console.error("Failed to load schedule:", err);
    }
}

// --- INIT ---
loadSchedule();
setInterval(loadSchedule, REFRESH_MS);
