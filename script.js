const SHEET_URL = "YOUR_URL";

async function loadSchedule() {
    const res = await fetch(SHEET_URL);
    const data = await res.json();

    const now = new Date();

    const events = data
        .map(e => ({
            title: e.title,
            start: new Date(e.start),
            end: new Date(e.end),
            day: e.day
        }))
        .filter(e => e.end > now)
        .sort((a, b) => a.start - b.start);

    render(events, now);
}

function render(events, now) {
    const container = document.getElementById("schedule");
    container.innerHTML = "";

    const grouped = {};

    events.forEach(e => {
        if (!grouped[e.day]) grouped[e.day] = [];
        grouped[e.day].push(e);
    });

    Object.keys(grouped).forEach(day => {
        const dayDiv = document.createElement("div");
        dayDiv.className = "day";

        const title = document.createElement("h2");
        title.textContent = `Day ${day}`;
        dayDiv.appendChild(title);

        grouped[day].forEach(e => {
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
        });

        container.appendChild(dayDiv);
    });
}

function formatTime(date) {
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

loadSchedule();
setInterval(loadSchedule, 30000);
