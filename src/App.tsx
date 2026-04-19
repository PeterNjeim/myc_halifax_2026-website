import { createSignal, createMemo, For, onMount, createEffect } from "solid-js";
import fallbackData from "./assets/schedule.json";

type RawEvent = {
    title: string;
    start: string;
    end?: string;
};

type Event = {
    title: string;
    start: Date;
    end: Date;
};

const SHEET_URL =
    "https://opensheet.elk.sh/1SFHHPSp4IFyQn2yODDC5XrIKQuutYc4XK2KTED4kQ8g/schedule";
const TIMEZONE = "America/Halifax";
const OFFSET = "-03:00";

function getInlineData(): RawEvent[] | null {
    const el = document.getElementById("__SCHEDULE__");
    if (!el) return null;

    try {
        return JSON.parse(el.textContent || "");
    } catch {
        return null;
    }
}

// --- Parsing ---
function parseADT(str?: string): Date | null {
    if (!str) return null;

    const match = str.match(
        /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (a\.m\.|p\.m\.)$/i,
    );
    if (!match) return null;

    let [, date, hourStr, minute, period] = match;

    let hour = parseInt(hourStr, 10);
    const isPM = period.toLowerCase().startsWith("p");

    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;

    return new Date(
        `${date}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}${OFFSET}`,
    );
}

// --- Formatters ---
const timeFormatter = Intl.DateTimeFormat([], {
    timeStyle: "short",
    timeZone: TIMEZONE,
});

const dayFormatter = Intl.DateTimeFormat([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: TIMEZONE,
});

const keyFormatter = Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

function formatRelative(ms: number): string {
    const rtf = new Intl.RelativeTimeFormat([], { numeric: "auto" });

    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);

    if (s < 60) return rtf.format(s, "second");
    if (m < 60) return rtf.format(m, "minute");
    if (h < 24) return rtf.format(h, "hour");
    return rtf.format(d, "days");
}

// --- Processing ---
function processEvents(raw: RawEvent[]): Event[] {
    const events: Event[] = raw
        .map((e) => ({
            title: e.title,
            start: parseADT(e.start),
            end: parseADT(e.end),
        }))
        .filter(
            (e): e is { title: string; start: Date; end: Date | null } =>
                !!e.start,
        )
        .map((e) => ({
            title: e.title,
            start: e.start,
            end: e.end ?? new Date(0), // temp
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let i = 0; i < events.length; i++) {
        if (events[i].end.getTime() === 0) {
            events[i].end =
                i < events.length - 1
                    ? events[i + 1].start
                    : new Date(events[i].start.getTime() + 3600000);
        }
    }

    return events;
}

function getKey(e: Event) {
    return `${e.start.getTime()}|${e.title}`;
}

const dir =
    new Intl.Locale(navigator.language).getTextInfo()?.direction || "ltr";

// --- Component ---
export default function App() {
    const inline = getInlineData();
    const cached = localStorage.getItem("schedule");

    const initialRaw: RawEvent[] =
        inline ?? (cached ? JSON.parse(cached) : fallbackData);

    const [events, setEvents] = createSignal<Event[]>([]);
    onMount(() => {
        setEvents(processEvents(initialRaw));
    });
    const [isFresh, setIsFresh] = createSignal(false);
    const [now, setNow] = createSignal(new Date());
    const nowTime = () => now().getTime();
    let didScroll = false;

    async function load() {
        const res = await fetch(SHEET_URL, { cache: "no-store" });
        const data: RawEvent[] = await res.json();

        localStorage.setItem("schedule", JSON.stringify(data));

        const next = processEvents(data);
        setIsFresh(true);

        setEvents((prev) => {
            const prevMap = new Map(prev.map((e) => [getKey(e), e]));

            let changed = false;

            const merged = next.map((e) => {
                const existing = prevMap.get(getKey(e));
                if (
                    existing &&
                    existing.start.getTime() === e.start.getTime() &&
                    existing.end.getTime() === e.end.getTime()
                ) {
                    return existing;
                }
                changed = true;
                return e;
            });

            if (merged.length !== prev.length) changed = true;

            return changed ? merged : prev;
        });
    }

    onMount(() => {
        const startFetch = () => load();

        if ("requestIdleCallback" in window) {
            requestIdleCallback(startFetch);
        } else {
            setTimeout(startFetch, 0);
        }

        const fetchTimer = setInterval(load, 30000);
        const clockTimer = setInterval(() => setNow(new Date()), 1000);

        return () => {
            clearInterval(fetchTimer);
            clearInterval(clockTimer);
        };
    });

    const nextEvent = createMemo(() =>
        events().find((e) => e.start.getTime() > nowTime()),
    );

    const grouped = createMemo(() => {
        const map = new Map<string, Event[]>();

        for (const e of events()) {
            const key = keyFormatter.format(e.start);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(e);
        }

        return Array.from(map.entries());
    });

    createEffect(() => {
        if (didScroll) return;

        const now = nowTime();
        const list = events();

        const target =
            list.find(
                (e) => now >= e.start.getTime() && now < e.end.getTime(),
            ) || list.find((e) => e.start.getTime() > now);

        if (!target) return;

        const key = getKey(target);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const el = document.querySelector(
                    `[data-key="${CSS.escape(key)}"]`,
                );

                if (el) {
                    el.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });
                    didScroll = true;
                }
            });
        });
    });

    return (
        <div class="container" dir={dir}>
            <For each={grouped()}>
                {([_, list]) => (
                    <div
                        class="day"
                        classList={{
                            past: list.every((e) => now() > e.end),
                        }}
                    >
                        <h2>{dayFormatter.format(list[0].start)}</h2>
                        <For each={list} fallback={null}>
                            {(e) => {
                                const isPast = () => now() > e.end;
                                const isLive = () =>
                                    now() >= e.start && now() < e.end;
                                const isNext = () => nextEvent() === e;

                                return (
                                    <div
                                        class="event"
                                        data-key={getKey(e)}
                                        classList={{
                                            past: isPast(),
                                            live: isLive(),
                                        }}
                                    >
                                        <span class="title">
                                            {isLive() && <span class="dot" />}

                                            <strong>{e.title}</strong>

                                            {isNext() && !isLive() && (
                                                <span class="countdown">
                                                    {" "}
                                                    {formatRelative(
                                                        e.start.getTime() -
                                                            now().getTime(),
                                                    )}
                                                </span>
                                            )}
                                        </span>
                                        {!isPast() && <br />}{" "}
                                        {!isFresh() && e.end > now() ? (
                                            <span
                                                class="time skeleton"
                                                dir={dir}
                                            />
                                        ) : (
                                            <span class="time">
                                                {timeFormatter.formatRange(
                                                    e.start,
                                                    e.end,
                                                )}
                                            </span>
                                        )}
                                    </div>
                                );
                            }}
                        </For>
                    </div>
                )}
            </For>
        </div>
    );
}
