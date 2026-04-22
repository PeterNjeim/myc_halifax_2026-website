import {
    createSignal,
    createMemo,
    For,
    onMount,
    createEffect,
    Show,
} from "solid-js";
import fallbackData from "./assets/schedule.json";
import logo from "./assets/img/MYC_Halifax_2026-Logo.svg";
import darkLogo from "./assets/img/MYC_Halifax_2026-Logo-Dark.svg";
import { Transition } from "solid-transition-group";

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
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const STORAGE_KEY = "schedule";
const LOCALE: string | string[] =
    navigator.language === "en-CA"
        ? Intl.DateTimeFormat().resolvedOptions().locale.startsWith("en")
            ? "en-CA"
            : []
        : [];

function getInlineData(): RawEvent[] | null {
    const el = document.getElementById("__SCHEDULE__");
    if (!el) return null;

    try {
        return JSON.parse(el.textContent || "");
    } catch {
        return null;
    }
}

function hashSchedule(data: RawEvent[]): string {
    return JSON.stringify(data);
}

function getStored(): RawEvent[] | null {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
    } catch {
        return null;
    }
}

function setStored(data: RawEvent[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeStyle: "short",
    timeZone: TIMEZONE,
});

const timeFormatterWithTZ = new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "numeric",
    timeZoneName: "short",
    timeZone: TIMEZONE,
});

const dayFormatter = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: TIMEZONE,
});

const keyFormatter = new Intl.DateTimeFormat("en-CA", {
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

function formatDuration(ms: number): string {
    const df = new Intl.DurationFormat([], {
        style: "narrow",
    });

    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    ms -= days * (1000 * 60 * 60 * 24);

    const hours = Math.floor(ms / (1000 * 60 * 60));
    ms -= hours * (1000 * 60 * 60);

    const minutes = Math.floor(ms / (1000 * 60));
    ms -= minutes * (1000 * 60);

    const seconds = Math.floor(ms / 1000);

    return df.format({
        days,
        hours,
        minutes,
        seconds,
    });
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
    const stored = getStored();

    const initialRaw: RawEvent[] = stored ?? inline ?? fallbackData ?? [];

    const [events, setEvents] = createSignal<Event[]>([]);
    onMount(() => {
        setEvents(processEvents(initialRaw));
    });
    let lastHash = hashSchedule(initialRaw);
    const [isFresh, setIsFresh] = createSignal(false);
    const [timedOut, setTimedOut] = createSignal(false);
    const [changedKeys, setChangedKeys] = createSignal<Set<string>>(new Set());
    const [showJump, setShowJump] = createSignal(false);
    const [isAbove, setIsAbove] = createSignal(false);
    const [now, setNow] = createSignal(new Date());
    const nowTime = () => now().getTime();
    let didScroll = false;

    function checkPosition() {
        const live =
            document.querySelector(".event.live") ??
            document.querySelector(".event:has(.countdown)");
        if (!live) return;

        const rect = live.getBoundingClientRect();

        const viewportLow = window.innerHeight / 1.618;
        const viewportHigh = window.innerHeight - viewportLow;

        if (rect.top > viewportLow) {
            setShowJump(true);
            setIsAbove(true); // live is below → scroll down
        } else if (rect.bottom < viewportHigh) {
            setShowJump(true);
            setIsAbove(false); // live is above → scroll up
        } else {
            setShowJump(false);
        }
    }

    async function load() {
        const res = await fetch(SHEET_URL, { cache: "no-store" });
        const data: RawEvent[] = await res.json();

        const incomingHash = data.length + ":" + data[0]?.start;
        const hasRealChange = incomingHash !== lastHash;

        if (hasRealChange) {
            const next = processEvents(data);
            setIsFresh(true);
            setTimedOut(false);

            setEvents((prev) => {
                const prevMap = new Map(prev.map((e) => [getKey(e), e]));

                const changed = new Set<string>();

                const merged = next.map((e) => {
                    const key = getKey(e);
                    const existing = prevMap.get(key);
                    if (
                        existing &&
                        existing.start.getTime() === e.start.getTime() &&
                        existing.end.getTime() === e.end.getTime()
                    ) {
                        return existing;
                    }
                    changed.add(key);
                    return e;
                });

                setChangedKeys(changed);

                if (changed.size > 0) {
                    setTimeout(() => setChangedKeys(new Set()), 1618);
                }

                return merged;
            });
            setStored(data);
            lastHash = incomingHash;
        }
    }

    onMount(() => {
        const startFetch = () => load();

        if ("requestIdleCallback" in window) {
            requestIdleCallback(startFetch);
        } else {
            setTimeout(startFetch, 0);
        }

        window.addEventListener("scroll", checkPosition);

        const fetchTimer = setInterval(load, 30000);
        const clockTimer = setInterval(() => setNow(new Date()), 1000);
        const timeout = setTimeout(() => {
            if (!isFresh()) setTimedOut(true);
        }, 6180);

        return () => {
            clearInterval(fetchTimer);
            clearInterval(clockTimer);
            clearTimeout(timeout);
            window.removeEventListener("scroll", checkPosition);
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
            <div class="header">
                <img
                    src={
                        window.matchMedia("(prefers-color-scheme: dark)")
                            .matches
                            ? darkLogo
                            : logo
                    }
                    alt="MYC Halifax 2026 logo"
                />
                <h1>Event Schedule</h1>
            </div>
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
                                                <span
                                                    classList={{
                                                        countdown: true,
                                                        timeout:
                                                            timedOut() &&
                                                            !isFresh() &&
                                                            e.end > now(),
                                                        updated:
                                                            isFresh() &&
                                                            changedKeys().has(
                                                                getKey(e),
                                                            ),
                                                    }}
                                                    dir={dir}
                                                >
                                                    {timedOut() && e.end > now()
                                                        ? "⚠ "
                                                        : " "}
                                                    {formatRelative(
                                                        e.start.getTime() -
                                                            now().getTime(),
                                                    )}
                                                </span>
                                            )}
                                        </span>
                                        {!isPast() && <br />}{" "}
                                        <span
                                            classList={{
                                                time: true,
                                                timeout:
                                                    timedOut() &&
                                                    !isFresh() &&
                                                    e.end > now(),
                                                updated:
                                                    isFresh() &&
                                                    changedKeys().has(
                                                        getKey(e),
                                                    ),
                                            }}
                                            dir={dir}
                                        >
                                            {timedOut() && e.end > now()
                                                ? "⚠ "
                                                : ""}
                                            {(USER_TZ === TIMEZONE
                                                ? timeFormatter
                                                : timeFormatterWithTZ
                                            ).formatRange(e.start, e.end)}
                                            <span class="duration">
                                                {" ("}
                                                {formatDuration(
                                                    e.end.getTime() -
                                                        e.start.getTime(),
                                                )}
                                                {")"}
                                            </span>
                                        </span>
                                    </div>
                                );
                            }}
                        </For>
                    </div>
                )}
            </For>
            <Transition name="jumps">
                <Show when={showJump()}>
                    <button
                        title="jump"
                        classList={{
                            jump: true,
                            upcoming: document.querySelector(".event.live")
                                ? false
                                : true,
                        }}
                        onClick={() => {
                            document.querySelector(".event.live")
                                ? document
                                      .querySelector(".event.live")
                                      ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                      })
                                : document
                                      .querySelector(".event:has(.countdown)")
                                      ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                      });
                        }}
                    >
                        <span class={isAbove() ? "down" : "up"}></span>
                    </button>
                </Show>
            </Transition>
        </div>
    );
}
