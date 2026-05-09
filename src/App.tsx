import {
    createSignal,
    createMemo,
    For,
    onMount,
    onCleanup,
    createEffect,
    createRenderEffect,
    Show,
    Match,
    Switch,
    lazy,
    Suspense,
} from "solid-js";
import fallbackData from "./assets/schedule.json";
import { Transition } from "solid-transition-group";

// Basic runtime constants and helpers (kept minimal so file compiles).
type RawEvent = {
    title?: string;
    start?: string;
    end?: string;
    location?: string;
    [k: string]: any;
};

type Event = {
    title: string;
    start: Date;
    end: Date;
    isExplicitEnd: boolean;
    location: string;
    honorific?: string;
    speakerTitle?: string;
    order?: string;
    [k: string]: any;
};

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

function RenderWithBreaks(props: { text?: string | null }) {
    const t = props.text ?? "";
    const parts = String(t).split("\\n");
    return (
        <>
            {parts.map((p, i) => (
                <>
                    {i > 0 && <br />} {p}
                </>
            ))}
        </>
    );
}

function abbreviateLocation(name: string): string {
    return name
        .replace("Our Lady of Lebanon", "OLOL")
        .replace("Cedar Event Centre", "CEC")
        .trim();
    // return name
    //     .split(/\s+/)
    //     .map((w) => w[0]?.toUpperCase())
    //     .join("");
}

function Location(props: {
    e: Event;
    timedOut: () => boolean;
    isFresh: () => boolean;
    isPast: () => boolean;
    changedKeys: () => Set<string>;
}) {
    const [open, setOpen] = createSignal(false);
    const [isAbbreviated, setIsAbbreviated] = createSignal(false);
    const [isDesktop, setIsDesktop] = createSignal(false);
    const abbr = abbreviateLocation(props.e.location);
    let timeout: NodeJS.Timeout;
    let locationEl: HTMLElement | undefined;
    let observer: MutationObserver | undefined;

    onMount(() => {
        const mq = window.matchMedia("(hover: hover)");
        setIsDesktop(mq.matches);
        if (
            props.e.location.includes("Our Lady of Lebanon") ||
            props.e.location.includes("Cedar Event Centre")
        ) {
            if (!locationEl) return;

            setIsAbbreviated(locationEl.textContent === abbr);

            observer = new MutationObserver(() => {
                if (!locationEl) return;
                setIsAbbreviated(locationEl.textContent === abbr);
            });

            observer.observe(locationEl, {
                childList: true,
            });
        }
    });

    onCleanup(() => observer?.disconnect());

    return (
        <span
            classList={{
                location: true,
                abbreviated: isAbbreviated(),
                timeout:
                    props.timedOut() && !props.isFresh() && !props.isPast(),
                updated:
                    props.isFresh() && props.changedKeys().has(getKey(props.e)),
            }}
            tabIndex={0}
            onMouseEnter={() => (isDesktop() ? setOpen(isAbbreviated()) : null)}
            onMouseLeave={() => (isDesktop() ? setOpen(false) : null)}
            onFocus={() => (isDesktop() ? setOpen(isAbbreviated()) : null)}
            onBlur={() => (isDesktop() ? setOpen(false) : null)}
            onTouchStart={(el) => {
                setOpen(isAbbreviated());
                if (open()) {
                    timeout = setTimeout(() => setOpen(false), 3236);
                } else {
                    clearTimeout(timeout);
                }
            }}
            aria-label={props.e.location}
            data-full={props.e.location}
            ref={(el) => (locationEl = el)}
        >
            {props.timedOut() && !props.isPast() ? "⚠ " : " "}
            {props.e.location}

            <Transition name="tooltips">
                <Show when={open()}>
                    <span class="tooltip">{props.e.location}</span>
                </Show>
            </Transition>
        </span>
    );
}

type FitToWidthElementArg =
    | string
    | HTMLElement
    | Array<HTMLElement>
    | NodeListOf<HTMLElement>;

interface FitToWidthConfig {
    targetWidth: number;
    elapsedTime?: number;
}

function normalizeElements(elements: FitToWidthElementArg): HTMLElement[] {
    if (typeof elements === "string") {
        return Array.from(document.querySelectorAll<HTMLElement>(elements));
    }

    if (elements instanceof HTMLElement) {
        return [elements];
    }

    return Array.from(elements).filter(
        (item): item is HTMLElement => item instanceof HTMLElement,
    );
}

function fitToWidth(
    elements: FitToWidthElementArg,
    targetWidth?: number,
): FitToWidthConfig {
    const startTime = performance.now();
    const elms = normalizeElements(elements);
    const config: FitToWidthConfig = {
        targetWidth: targetWidth ?? 0,
    };

    for (const el of elms) {
        const elParentStyle = window.getComputedStyle(el.parentElement!);
        const width =
            targetWidth ??
            el.parentElement!.clientWidth -
                parseFloat(elParentStyle.paddingInlineStart) -
                parseFloat(elParentStyle.paddingInlineEnd);

        el.style.whiteSpace = "nowrap";
        el.style.width = "100%";
        el.style.minWidth = "max-content";
        el.style.transform = "none";
        el.style.transformOrigin =
            window.getComputedStyle(el).direction === "rtl" ? "right" : "left";

        let currentWidth = el.clientWidth;
        if (currentWidth > 0) {
            if (el.querySelector(".location")) {
                const abbr = abbreviateLocation(
                    el.querySelector(".location")!.ariaLabel!,
                );
                if (
                    el.querySelector(".location")!.textContent !== abbr &&
                    width < currentWidth
                ) {
                    el.querySelector(".location")!.textContent = abbr;
                    currentWidth = el.clientWidth;
                }
                if (el.querySelector(".location")!.textContent === abbr) {
                    el.querySelector(".location")!.textContent =
                        el.querySelector(".location")!.ariaLabel;
                    currentWidth = el.clientWidth;
                    if (width < currentWidth) {
                        el.querySelector(".location")!.textContent = abbr;
                        currentWidth = el.clientWidth;
                    }
                }
            }
            if (width < currentWidth) {
                el.style.transform = `scale(${width / currentWidth}, 1)`;
            }
        }

        // el.style.width = `${width}px`;
        config.targetWidth = width;
    }

    config.elapsedTime = performance.now() - startTime;
    return config;
}

function processEvents(raw: RawEvent[]): Event[] {
    return raw
        .map((r) => {
            const start = parseADT(r.start ?? "") || new Date();
            const end =
                parseADT(r.end ?? "") ||
                new Date(start.getTime() + 60 * 60 * 1000);

            const base: Event = {
                title: String(r.title ?? "").trim(),
                start,
                end,
                location: String(r.location ?? "").trim(),
                isExplicitEnd: !!r.end,
            } as Event;

            // Copy through any extra sheet columns (honorific, order, speaker title, etc.)
            for (const k of Object.keys(r || {})) {
                if (
                    k === "title" ||
                    k === "start" ||
                    k === "end" ||
                    k === "location" ||
                    k.startsWith("__")
                )
                    continue;
                // keep values as strings if present
                base[k] = r[k];
            }

            // Normalize common names: if a sheet provided a 'title' column that is not the
            // displayed title (e.g. speakers have a separate name column mapped into
            // title by remapping), keep the original under speakerTitle when present.
            if (
                r.title &&
                typeof r.title === "string" &&
                base.title !== r.title
            ) {
                base.speakerTitle = String(r.title).trim();
            }

            return base;
        })
        .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function getKey(e: Event) {
    return `${e.title}::${e.location || ""}`;
}

function hashSchedule(data: any) {
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

const SHEET_BASE =
    "https://opensheet.elk.sh/1Sbs6P_5nYPKJPacHhh5f12cRY8nByyOFLfkbhN6FPyw";
const SHEET_URL = `${SHEET_BASE}/schedule`;
const dir =
    new Intl.Locale(navigator.language).getTextInfo()?.direction || "ltr";

function Home(props: { setView: (arg0: string) => void }) {
    return (
        <div class="home">
            <Tile
                label="Shuttle Schedule"
                onClick={() => props.setView("shuttles")}
            />
            <Tile label="Gala Seating" onClick={() => props.setView("gala")} />
            <Tile label="Schedule" onClick={() => props.setView("schedule")} />
            <Tile
                label="Emergency Contacts"
                onClick={() => props.setView("contact")}
            />
            <Tile
                label="Speaker Info"
                onClick={() => props.setView("speakers")}
            />
            <Tile label="Sponsors" onClick={() => props.setView("sponsors")} />
        </div>
    );
}

function Tile(props: { label: string; onClick?: () => void }) {
    return (
        <button class="tile" onClick={props.onClick}>
            {props.label}
        </button>
    );
}

// Inline a simple Sheet component and keep a lazy wrapper for Suspense testing.
function InlineSheet(props: { view: string; columns: string[] }) {
    const [rows, setRows] = createSignal<Record<string, any>[]>([]);
    const [loading, setLoading] = createSignal(true);

    const storageKey = `sheet:${props.view}`;

    function getInline(view: string) {
        const el = document.getElementById(`__${view.toUpperCase()}__`);
        if (!el) return null;
        try {
            return JSON.parse(el.textContent || "");
        } catch {
            return null;
        }
    }

    function getStored(key: string) {
        try {
            return JSON.parse(localStorage.getItem(key) || "");
        } catch {
            return null;
        }
    }

    function setStored(key: string, data: any) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch {}
    }

    function normalizeRows(data: any[]): Record<string, any>[] {
        return data.map((r) => {
            const out: Record<string, any> = {};
            for (const k of props.columns) {
                const raw = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
                out[k] = raw ?? "";
            }
            if (out.start) out.__startDate = parseADT(out.start) || null;
            if (out.end) out.__endDate = parseADT(out.end) || null;
            return out;
        });
    }

    async function load() {
        try {
            const res = await fetch(`${SHEET_BASE}/${props.view}`, {
                cache: "no-store",
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setRows(normalizeRows(data));
                setStored(storageKey, data);
            }
        } catch (err) {
            // keep existing rows
        } finally {
            setLoading(false);
        }
    }

    onMount(() => {
        const inline = getInline(props.view);
        const stored = getStored(storageKey);

        if (stored && Array.isArray(stored)) {
            setRows(normalizeRows(stored));
            setLoading(false);
        } else if (inline && Array.isArray(inline)) {
            setRows(normalizeRows(inline));
            setLoading(false);
        }

        const start = () => load();
        if ("requestIdleCallback" in window) {
            // // @ts-ignore
            requestIdleCallback(start);
        } else {
            setTimeout(start, 0);
        }
    });

    const titleMap: Record<string, string> = {
        shuttles: "Shuttle Schedule",
        gala: "Gala Seating",
        contact: "Emergency Contacts",
        speakers: "Speaker Info",
        sponsors: "Sponsors",
    };

    return (
        <div>
            <div class="header">
                <h1>{titleMap[props.view] ?? props.view}</h1>
            </div>

            <Show
                when={!loading() && rows().length > 0}
                fallback={
                    <div class="sheet-loading">
                        {loading() ? "Loading…" : "No items"}
                    </div>
                }
            >
                <div>
                    <table role="table" class="sheet-table">
                        <thead>
                            <tr>
                                <For each={props.columns}>
                                    {(c) => <th>{c}</th>}
                                </For>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={rows()}>
                                {(r) => (
                                    <tr>
                                        <For each={props.columns}>
                                            {(c) => (
                                                <td>
                                                    <Show
                                                        when={
                                                            c === "start" &&
                                                            r.__startDate
                                                        }
                                                        fallback={r[c]}
                                                    >
                                                        <span>
                                                            {(USER_TZ ===
                                                            TIMEZONE
                                                                ? timeFormatter
                                                                : timeFormatterWithTZ
                                                            ).format(
                                                                r.__startDate,
                                                            )}
                                                        </span>
                                                    </Show>
                                                    <Show
                                                        when={
                                                            c === "end" &&
                                                            r.__endDate
                                                        }
                                                    >
                                                        <span>
                                                            {"\u00A0—\u00A0"}
                                                            {(USER_TZ ===
                                                            TIMEZONE
                                                                ? timeFormatter
                                                                : timeFormatterWithTZ
                                                            ).format(
                                                                r.__endDate,
                                                            )}
                                                        </span>
                                                    </Show>
                                                </td>
                                            )}
                                        </For>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
        </div>
    );
}

// Keep lazy wrapper to preserve Suspense usage in the UI. Resolves to the inline component.
const SheetView = lazy(() => Promise.resolve({ default: InlineSheet }));

// --- Component ---
export default function App() {
    const [view, setView] = createSignal<
        | "home"
        | "schedule"
        | "shuttles"
        | "gala"
        | "contact"
        | "speakers"
        | "sponsors"
    >("home");
    const inline = getInlineData();
    const stored = getStored();

    const initialRaw: RawEvent[] =
        stored ?? inline ?? (fallbackData as RawEvent[]) ?? [];

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

    const locationSignature = createMemo(() =>
        events()
            .map((e) => e.location)
            .join("\n"),
    );

    const titleSignature = createMemo(() =>
        events()
            .map((e) => e.title)
            .join("\n"),
    );

    const liveSignature = createMemo(() =>
        events()
            .map((e) => now() >= e.start && now() < e.end)
            .join("\n"),
    );

    function runFit(classes?: string) {
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        requestAnimationFrame(() => {
            fitToWidth(classes ?? ".day h2, .title, .details");
            window.scrollTo(scrollX, scrollY);
        });
    }

    function checkPosition() {
        const live =
            document.querySelector(".event.live") ??
            document.querySelector(".event:has(.countdown)");
        if (!live) return;

        const rect = live.getBoundingClientRect();

        const viewportLow = window.innerHeight / 1.618;
        const viewportHigh = window.innerHeight - viewportLow;

        const scrollTop = window.scrollY;
        const maxScroll =
            document.documentElement.scrollHeight - window.innerHeight;

        const atTop = scrollTop <= 8;
        const atBottom = scrollTop >= maxScroll - 8;

        if (rect.top > viewportLow) {
            if (atBottom) {
                setShowJump(false);
            } else {
                setShowJump(true);
                setIsAbove(true);
            }
        } else if (rect.bottom < viewportHigh) {
            if (atTop) {
                setShowJump(false);
            } else {
                setShowJump(true);
                setIsAbove(false);
            }
        } else {
            setShowJump(false);
        }
    }

    // Generic sheet provider factory for non-schedule views
    function createSheetProvider(opts: {
        view: string;
        columns: string[];
        remap?: Record<string, string>;
        remapToEvent?: boolean;
    }) {
        const { view: sheetView, columns, remap, remapToEvent } = opts;
        const storageKey = `sheet:${sheetView}`;

        const [rows, setRows] = createSignal<Record<string, any>[]>([]);
        const [eventsLocal, setEventsLocal] = createSignal<Event[]>([]);
        const [loadingLocal, setLoadingLocal] = createSignal(true);
        const [isFreshLocal, setIsFreshLocal] = createSignal(false);
        const [timedOutLocal, setTimedOutLocal] = createSignal(false);
        const [changedKeysLocal, setChangedKeysLocal] = createSignal<
            Set<string>
        >(new Set());

        let lastHashLocal = "";
        let pollTimer: number | undefined;
        let timeoutTimer: number | undefined;

        function getInlineLocal() {
            const el = document.getElementById(
                `__${sheetView.toUpperCase()}__`,
            );
            if (!el) return null;
            try {
                return JSON.parse(el.textContent || "");
            } catch {
                return null;
            }
        }

        function getStoredLocal() {
            try {
                return JSON.parse(localStorage.getItem(storageKey) || "");
            } catch {
                return null;
            }
        }

        function setStoredLocal(data: any) {
            try {
                localStorage.setItem(storageKey, JSON.stringify(data));
            } catch {}
        }

        function normalizeRows(data: any[]): Record<string, any>[] {
            return data.map((r) => {
                const out: Record<string, any> = {};
                for (const k of columns) {
                    const raw =
                        r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
                    out[k] = raw ?? "";
                }
                if (out.start) out.__startDate = parseADT(out.start) || null;
                if (out.end) out.__endDate = parseADT(out.end) || null;
                return out;
            });
        }

        function rowsToRawEvents(rs: Record<string, any>[]): RawEvent[] {
            return rs
                .map((r) => {
                    const titleKey = remap?.title ?? "title";
                    const locKey = remap?.location ?? "location";

                    const base = {
                        title: String(r[titleKey] ?? "").trim(),
                        start: String(r.start ?? "").trim(),
                        end: String(r.end ?? "").trim(),
                        location: String(r[locKey] ?? "").trim(),
                    } as RawEvent & Record<string, any>;

                    const extras: Record<string, any> = {};
                    for (const k of Object.keys(r)) {
                        if (
                            k === titleKey ||
                            k === locKey ||
                            k === "start" ||
                            k === "end"
                        )
                            continue;
                        if (k.startsWith("__")) continue;
                        extras[k] = r[k];
                    }

                    // Preserve the original 'title' column under speakerTitle when
                    // remapping title from another column (e.g., name -> title)
                    if (
                        titleKey !== "title" &&
                        typeof r.title === "string" &&
                        r.title.trim()
                    ) {
                        extras.speakerTitle = String(r.title).trim();
                    }

                    return { ...extras, ...base } as RawEvent;
                })
                .filter((r) => r.start && (r.title || r.location));
        }

        async function loadLocal() {
            try {
                const res = await fetch(`${SHEET_BASE}/${sheetView}`, {
                    cache: "no-store",
                });
                const data = await res.json();
                if (!Array.isArray(data)) return;

                const incomingHash = JSON.stringify(data);
                const hasRealChange = incomingHash !== lastHashLocal;

                if (hasRealChange) {
                    const normalized = normalizeRows(data);
                    setIsFreshLocal(true);
                    setTimedOutLocal(false);

                    if (remapToEvent) {
                        const next = processEvents(rowsToRawEvents(normalized));
                        setEventsLocal((prev) => {
                            const prevMap = new Map(
                                prev.map((e) => [getKey(e), e]),
                            );
                            const changed = new Set<string>();

                            const merged = next.map((e) => {
                                const key = getKey(e);
                                const existing = prevMap.get(key);
                                if (
                                    existing &&
                                    existing.start.getTime() ===
                                        e.start.getTime() &&
                                    existing.end.getTime() === e.end.getTime()
                                ) {
                                    return existing;
                                }
                                changed.add(key);
                                return e;
                            });

                            setChangedKeysLocal(changed);
                            if (changed.size > 0) {
                                setTimeout(
                                    () =>
                                        setChangedKeysLocal(new Set<string>()),
                                    1618,
                                );
                            }

                            return merged;
                        });
                    } else {
                        setRows(normalized);
                    }

                    setStoredLocal(data);
                    lastHashLocal = incomingHash;
                }
            } catch (err) {
                // ignore
            } finally {
                setLoadingLocal(false);
            }
        }

        function init() {
            const inline = getInlineLocal();
            const stored = getStoredLocal();

            if (stored && Array.isArray(stored)) {
                const normalized = normalizeRows(stored);
                if (remapToEvent)
                    setEventsLocal(processEvents(rowsToRawEvents(normalized)));
                else setRows(normalized);
                setLoadingLocal(false);
            } else if (inline && Array.isArray(inline)) {
                const normalized = normalizeRows(inline);
                if (remapToEvent)
                    setEventsLocal(processEvents(rowsToRawEvents(normalized)));
                else setRows(normalized);
                setLoadingLocal(false);
            }

            const start = () => loadLocal();
            if ("requestIdleCallback" in window) {
                // // @ts-ignore
                requestIdleCallback(start);
            } else {
                setTimeout(start, 0);
            }

            pollTimer = window.setInterval(loadLocal, 30000);

            timeoutTimer = window.setTimeout(() => {
                if (!isFreshLocal()) setTimedOutLocal(true);
            }, 6180);
        }

        function cleanup() {
            if (pollTimer) clearInterval(pollTimer);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        }

        return {
            rows,
            events: eventsLocal,
            loading: loadingLocal,
            isFresh: isFreshLocal,
            timedOut: timedOutLocal,
            changedKeys: changedKeysLocal,
            init,
            cleanup,
            load: loadLocal,
        };
    }

    // Reusable schedule renderer — accepts an events accessor and provider flags
    function ScheduleRenderer(props: {
        title: string;
        events: () => Event[];
        timedOut: () => boolean;
        isFresh: () => boolean;
        changedKeys: () => Set<string>;
    }) {
        const nextEventLocal = createMemo(() =>
            props.events().find((e) => e.start.getTime() > nowTime()),
        );

        const groupedLocal = createMemo(() => {
            const map = new Map<string, Event[]>();
            for (const e of props.events()) {
                const key = keyFormatter.format(e.start);
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(e);
            }
            return Array.from(map.entries());
        });

        createRenderEffect(() => {
            if (props.events().length === 0) return;
            runFit();
        });

        // Auto-scroll to live/next event once
        createEffect(() => {
            if (didScroll) return;
            const now = nowTime();
            const list = props.events();

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
            <>
                <div class="header">
                    <img
                        src={
                            window.matchMedia("(prefers-color-scheme: dark)")
                                .matches
                                ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' id='Layer_1' data-name='Layer 1' viewBox='0 0 898.86 905.2'%3E%3Cdefs%3E%3Cstyle%3E.cls-1,.cls-2%7Bfill:%23ffa19e%7D.cls-3%7Bfill:%23c7ddff%7D%3C/style%3E%3C/defs%3E%3Cpath d='M898.86 478.33c-288.9 221.15-333.72-45.49-138.41-214.8 21.72-18.83 87.14-16.77 95.31-23.47 70.3-57.6-131.97-32.65-214.23 74.71-193.6 252.69 130.41 450.04 257.33 163.55Z' class='cls-3'/%3E%3Cpath d='M566.84 838.41c-48.15-149.32-58.76-289-31.55-415.17 1.9-8.81 3.99-17.54 6.26-26.19C596.92 183 750.62 64.47 839.15 92.17c.44-.14.72-.18 1.06-.18h3.01v.61c3.76-2.23-17.01-21.4-22.02-23.78-.12-.06-.23-.12-.35-.19-147.69-94.52-256.42 85.85-312.61 203.12-1.44 3-5.85 2.36-6.44-.92-29.62-166.7-190.18-298.62-299.97-90.95-1.65 3.12 1.95 6.36 4.9 4.44 40.24-26.17 78.6-39.15 102.46-33.35 209.84 51.04 16.87 488.52 255.07 690.25 2.59 2.19 6.37-.33 5.49-3.5z' class='cls-3'/%3E%3Cpath d='M162.1 557.49c35.83-38.33 50.97-93.42 89.05-129.78-58.86 152.36-22.83 214.55 82.7 66.16 4.09 38.37 18 96.25 97.08 126.51.15-.13-2.86-11.12-2.86-11.12-82.71-102.91 11.17-304.72-97.3-198.01-15.75 35.93-25.62 79.33-56.69 106.79 11.2-65.26 43.61-127.39 64.9-188.93 3.76-13.08 11.28-42.32-13.68-35.31-26.08 7.33-71.58 86.96-93.2 107.17 7.42-31.25 61.76-112.29 43.25-139.95-44.9-34.33-51.05-33.86-99.13-3.06C123.63 291.38-34.51 408.03 6.81 478.02c17.61 17.66 16.97-21.7 23.14-35.5 13.07-54.09 251.46-294.69 171.6-96.24-27.76 67.25-54.89 135.07-83.77 201.88-61.32 106.28-2.31 54.05 44.32 9.33' class='cls-3'/%3E%3Cpath d='M811.88 92c-27.73 0-59.27 11.26-91.2 32.58-33.44 22.32-65.84 54.82-93.71 94.01-48.68 68.44-168.92 272.69-57.28 618.9-5.67-36.52-31.83-181.55-32.29-218.65-4.53-141.42 48.62-323.71 146.57-419.1 25.4-26.99 63.05-65.54 154.09-103.91 8.21-3.46-10.48 5.2 0 0-8.08-2.54-16.88-3.83-26.19-3.83Z' class='cls-2'/%3E%3Ccircle cx='512' cy='77.61' r='77.61' class='cls-1'/%3E%3Cpath d='M375.81 199.73c-1.96.73-3.91 1.46-5.86 2.23-.02 0-.04.02-.06.02-31.75 12.52-61.12 29.03-87.71 49.21a371 371 0 0 0-6.67 5.17c.69.53 1.36 1.03 2.07 1.57s2.23 3.15 2.23 3.15l5.15-4c26.57-20.29 56.31-37.09 88.45-49.64l6.04-2.3c-1.18-1.86-2.4-3.66-3.65-5.42Z' class='cls-1'/%3E%3Cpath d='M442.44 625.58c-13.54-64.72-17.18-131.22-20.7-195.54-4.86-88.87-9.45-172.81-41.82-224.19l-2.64-4-6.57 1.32 3.83 6.07c31.49 49.98 36.04 133.12 40.85 221.14 2.96 54.16 6.01 109.87 14.97 164.89-30.62-44.74-30.86-106.81-31.04-152.82-.07-18.32-.13-34.14-2.12-45.85-1.24-7.34-3.14-12.68-5.97-16.8-3.98-5.79-9.92-8.98-16.73-8.98-12.01 0-27.22 9.93-50.86 33.19l-1.4 1.37-.79 1.79c-3.92 8.95-7.52 18.43-11 27.6-3.99 10.52-8.04 21.18-12.7 31.4 7.98-24.59 17.79-48.9 27.4-72.73 8.07-20 16.42-40.67 23.45-60.99l.09-.26.07-.26c4.25-14.8 7.55-31.32-.25-41.67-2.64-3.51-7.63-7.69-16.41-7.69-2.96 0-6.09.47-9.57 1.45-13.78 3.87-29 20.18-47.35 44.14 2.82-6.62 5.41-13.2 7.57-19.54 7.58-22.27 8.6-37.98 3.2-49.42l-2.78-5.9-5.05 4.21 2.08 4.4c10.07 21.35-9.34 61.85-26.46 97.58-3.88 8.09-7.65 15.97-10.78 23.06 5.36-6.96 11.29-15.15 17.39-23.59 21.62-29.91 46.13-63.81 63.92-68.81 2.87-.81 5.51-1.21 7.85-1.21 6.15 0 9.55 2.81 11.32 5.16 6.15 8.17 2.81 23.58-.78 36.09l-.03.1-.03.1c-6.98 20.17-15.29 40.77-23.33 60.69-15.13 37.49-30.73 76.13-39.08 115.49 17.22-19.46 26.86-44.86 36.22-69.52 3.45-9.1 7.02-18.5 10.88-27.3l.3-.67.52-.52c22.05-21.69 36.35-31.36 46.4-31.36 12.97 0 15.58 15.42 16.43 20.49 1.9 11.2 1.96 26.78 2.03 44.82.2 49.62.46 117.58 38.09 164.39l.5.62.21.76s.76 2.76 1.5 5.54c.37 1.4.74 2.81 1.01 3.87.53 2.14.99 3.98-.78 5.56l-1.73 1.55-2.17-.83c-35.66-13.65-62.1-34.44-78.57-61.81-12.34-20.5-17.33-41.69-19.73-58.16-37.55 51.34-68.14 78.4-88.72 78.4-6.88 0-12.61-3.06-16.58-8.85-12.89-18.8-7.27-66.33 14.88-128.98-13.14 16.13-23.6 34.72-33.79 52.83-12.23 21.74-24.88 44.22-42.16 62.71l-.07.08-.08.07-4.83 4.62-5.31 5.05 1.61 7.25 8.08-7.7c1.63-1.55 3.25-3.1 4.85-4.64l.2-.19.19-.2c17.81-19.05 30.64-41.87 43.06-63.93 3.13-5.57 6.23-11.07 9.36-16.45-3.25 12.42-5.67 24-7.19 34.52-3.96 27.31-1.96 47.01 5.96 58.55 5.14 7.49 12.89 11.61 21.83 11.61 21.26 0 49.83-23.28 85.08-69.27 3.14 14.17 8.46 30.21 17.93 45.95 17.23 28.61 44.73 50.31 81.75 64.47l2.61 1 6.74-1.95.32 1.52 6.11-1.85-.63-3.03ZM158.93 440.15l.11-.27c5.03-12.26 10.05-24.52 15.07-36.78.1-.24.2-.49.3-.73 7.72-18.88 15.71-38.4 23.6-57.53.95-2.36 1.83-4.62 2.68-6.83a331 331 0 0 0-24.63 44.75c-10.42 22.97-18.01 46.73-22.76 71.06 1.88-4.56 3.75-9.12 5.62-13.67ZM553.66 180.15c.4-.64.57-.91.65-1.05.28-.44.56-.9.84-1.34l-7.05-.71c-12.1-1.13-24.32-1.72-36.63-1.72-10.3 0-20.52.42-30.68 1.21-2.28.18-4.56.35-6.83.57.42.81.83 1.63 1.24 2.44h-.01l1.18 2.35c13.49 26.88 23.5 56.95 28.97 87.05 15.78-32.85 31.18-61.24 47.04-86.76l1.28-2.05Zm-45.92 69.44c-5.58-23.15-13.73-45.9-23.92-66.89 9.13-.66 18.34-1.01 27.65-1.01 11.09 0 22.06.5 32.9 1.42-12.34 20.15-24.41 42.04-36.63 66.48' class='cls-1'/%3E%3Cpath d='m443.08 628.61-.07-.34-.56-2.7-6.64-.78-262.31-.08a314 314 0 0 1-14.14-50.52l-2.2-6.69-2.55 2.43v-.03c-.73.68-1.45 1.36-2.16 2.03q.675 3.75 1.44 7.47c3.3 16.11 7.85 31.99 13.65 47.54l1.54 4.14h4.42l263.62.09h6.51c-.19-.85-.36-1.69-.54-2.54ZM651.79 516.3c10.63 27.59 33.48 42.17 66.08 42.17 39.01 0 90.46-21.24 148.78-61.42l1.94-1.36v.01c2.02-1.4 4.04-2.82 6.08-4.27-.18-2.41-.38-4.81-.61-7.21-3.37-35-12.46-69.01-27.18-101.45-18.37-40.49-44.65-76.84-78.12-108.04-.93-.86-1.86-1.72-2.8-2.57-1.56-1.42-3.14-2.83-4.72-4.23a377 377 0 0 0-4.58 4.07l-.21.19-.34.31c-95.47 86.41-125 190.11-104.31 243.8Zm15.32-109.42c12.83-32.26 39.42-80.94 93.26-129.67l.84-.76c60.18 54.72 99.75 129.03 106.84 211.9l-5 3.44c-57.26 39.45-107.46 60.3-145.17 60.3-29.75 0-50.54-13.17-60.15-38.09-10.39-26.96-6.97-66 9.39-107.13Z' class='cls-1'/%3E%3Cpath d='m872.45 534.07-.61.87c-20.49 29.62-44.42 52.33-71.13 67.5-24.62 13.98-50.57 21.07-77.13 21.07-55.18 0-104.86-31.19-129.65-81.41-15.05-30.49-19.88-66.21-13.97-103.31 6.66-41.82 26.36-84.32 58.55-126.34 19.81-25.85 48.64-49.49 83.41-68.38.19-.1.37-.21.56-.31l2.06-1.11h.02c.85-.44 1.71-.91 2.55-1.35-1.99-1.37-4.01-2.69-6.02-4.02-12.25-8.07-25.03-15.41-38.27-22.02l.02-.02h-.08c-1.93-.97-3.88-1.92-5.83-2.86-1.51 1.61-3.01 3.24-4.5 4.88s-.01.02-.02.02C581.03 318.63 537.2 492.73 541.24 618.69v.08c.02 1.77.1 3.79.24 6.04.12 1.95.28 4.08.48 6.36h6.21l.08.01 301.14.09h4.42l1.55-4.14c10.25-27.44 16.63-55.89 19.08-84.86.35-4.09.61-8.2.8-12.31-.91 1.38-1.84 2.74-2.77 4.09Zm-324.6 90.76-.02-.39c-.13-2.18-.21-4.1-.23-5.73v-.16c-3.78-117.85 35.16-292.32 129.55-397l1.23-1.36a363 363 0 0 1 36.38 20.59c-33.7 18.93-61.75 42.29-81.3 67.81-32.84 42.87-52.96 86.34-59.78 129.21-6.12 38.41-1.09 75.45 14.55 107.13 19.93 40.38 55.31 68.96 96.86 79.95l-137.23-.04Zm301.52.09-86.93-.03c14.12-3.65 27.96-9.29 41.4-16.93 23.27-13.22 44.45-31.95 63.15-55.78a312.6 312.6 0 0 1-17.62 72.73Z' class='cls-2'/%3E%3Cpath d='M145.4 905.19v-114h32.25v114zm29.8-44.46v-26.71h48.53v26.71zm46.25 44.46v-114h32.25v114zM262.82 905.19l50.33-114h31.76l50.49 114h-33.55l-39.41-98.21h12.7l-39.41 98.21h-32.9Zm27.52-22.31 8.31-23.62h55.7l8.31 23.62h-72.31ZM404.67 905.19v-114h32.25v88.44h54.23v25.57h-86.48ZM504.02 905.19v-114h32.25v114zM559.23 905.19v-114h89.25v25.08h-57v88.92zm29.8-39.09v-24.92h52.61v24.92zM645.55 905.19l50.33-114h31.76l50.49 114h-33.55l-39.41-98.21h12.7l-39.41 98.21h-32.9Zm27.52-22.31 8.31-23.62h55.7l8.31 23.62h-72.31Z' class='cls-1'/%3E%3Cpath d='m769.32 905.19 49.84-69.38-.16 22.96-47.88-67.59h36.32l30.46 44.14h-15.31l30.13-44.14h34.69l-47.72 66.45v-22.8l50.49 70.36h-37.13l-31.11-46.42h14.82l-30.62 46.42h-36.81ZM264.72 751.36l42.64-42.94c1.7-1.7 3.08-3.28 4.13-4.73s1.8-2.83 2.25-4.13.68-2.65.68-4.05c0-3.5-1.13-6.28-3.38-8.33s-5.28-3.08-9.08-3.08c-3.4 0-6.56 1.03-9.46 3.08s-6.01 5.53-9.31 10.43l-19.52-17.57c4.4-7 10.08-12.31 17.04-15.92 6.96-3.6 14.89-5.4 23.8-5.4 8.11 0 15.09 1.43 20.94 4.28 5.86 2.85 10.36 6.93 13.51 12.24s4.73 11.61 4.73 18.92c0 4.11-.55 7.96-1.65 11.56s-2.85 7.13-5.26 10.58c-2.4 3.45-5.51 6.98-9.31 10.58l-26.88 25.52-35.88-1.05Zm0 16.07v-16.07l24.92-8.56h56.3v24.62h-81.23ZM400.75 769.23c-9.21 0-17.39-2.38-24.55-7.13s-12.79-11.31-16.89-19.67c-4.11-8.36-6.16-17.89-6.16-28.6s2.03-20.22 6.08-28.53 9.63-14.81 16.74-19.52c7.11-4.7 15.26-7.06 24.47-7.06s17.54 2.35 24.7 7.06c7.15 4.71 12.76 11.21 16.82 19.52 4.05 8.31 6.08 17.87 6.08 28.68s-2.03 20.37-6.08 28.68-9.63 14.81-16.74 19.52-15.26 7.06-24.47 7.06Zm-.15-25.52c3.7 0 6.85-1.15 9.46-3.45 2.6-2.3 4.58-5.68 5.93-10.13s2.03-9.83 2.03-16.14-.68-11.66-2.03-16.06-3.33-7.78-5.93-10.13-5.81-3.53-9.61-3.53c-3.6 0-6.71 1.15-9.31 3.45s-4.58 5.66-5.93 10.06c-1.35 4.41-2.03 9.76-2.03 16.07s.68 11.69 2.03 16.14c1.35 4.46 3.33 7.86 5.93 10.21s5.75 3.53 9.46 3.53ZM589.47 751.36l42.64-42.94c1.7-1.7 3.08-3.28 4.13-4.73s1.8-2.83 2.25-4.13.68-2.65.68-4.05c0-3.5-1.13-6.28-3.38-8.33s-5.28-3.08-9.08-3.08c-3.4 0-6.56 1.03-9.46 3.08s-6.01 5.53-9.31 10.43l-19.52-17.57c4.4-7 10.08-12.31 17.04-15.92 6.96-3.6 14.89-5.4 23.8-5.4 8.11 0 15.09 1.43 20.94 4.28 5.86 2.85 10.36 6.93 13.51 12.24s4.73 11.61 4.73 18.92c0 4.11-.55 7.96-1.65 11.56s-2.85 7.13-5.26 10.58c-2.4 3.45-5.51 6.98-9.31 10.58l-26.88 25.52-35.88-1.05Zm0 16.07v-16.07l24.92-8.56h56.3v24.62h-81.23ZM718.44 769.23c-7.81 0-14.84-1.65-21.09-4.96-6.26-3.3-11.21-7.78-14.86-13.44-3.65-5.65-5.48-12.03-5.48-19.14 0-8.41 2.9-16.87 8.71-25.37l31.08-45.79h33.33l-35.88 49.55-11.26-2.4c1.7-2.5 3.33-4.65 4.88-6.46 1.55-1.8 3.45-3.2 5.71-4.2 2.25-1 5.23-1.5 8.93-1.5 7.01 0 13.31 1.63 18.92 4.88 5.6 3.25 10.08 7.61 13.44 13.06 3.35 5.46 5.03 11.54 5.03 18.24 0 7.11-1.83 13.49-5.48 19.14-3.65 5.66-8.58 10.13-14.79 13.44-6.21 3.3-13.26 4.96-21.17 4.96Zm0-24.92c2.5 0 4.73-.58 6.68-1.73s3.48-2.75 4.58-4.8 1.65-4.38 1.65-6.98-.55-4.93-1.65-6.98-2.63-3.65-4.58-4.8-4.18-1.73-6.68-1.73-4.73.58-6.68 1.73-3.48 2.75-4.58 4.8-1.65 4.38-1.65 6.98.55 4.93 1.65 6.98 2.63 3.65 4.58 4.8 4.18 1.73 6.68 1.73' class='cls-1'/%3E%3C/svg%3E"
                                : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' id='Layer_1' data-name='Layer 1' viewBox='0 0 898.86 905.2'%3E%3Cdefs%3E%3Cstyle%3E.cls-1,.cls-2%7Bfill:%23d30731%7D.cls-3%7Bfill:%230045b7%7D%3C/style%3E%3C/defs%3E%3Cpath d='M898.86 478.33c-288.9 221.15-333.72-45.49-138.41-214.8 21.72-18.83 87.14-16.77 95.31-23.47 70.3-57.6-131.97-32.65-214.23 74.71-193.6 252.69 130.41 450.04 257.33 163.55Z' class='cls-3'/%3E%3Cpath d='M566.84 838.41c-48.15-149.32-58.76-289-31.55-415.17 1.9-8.81 3.99-17.54 6.26-26.19C596.92 183 750.62 64.47 839.15 92.17c.44-.14.72-.18 1.06-.18h3.01v.61c3.76-2.23-17.01-21.4-22.02-23.78-.12-.06-.23-.12-.35-.19-147.69-94.52-256.42 85.85-312.61 203.12-1.44 3-5.85 2.36-6.44-.92-29.62-166.7-190.18-298.62-299.97-90.95-1.65 3.12 1.95 6.36 4.9 4.44 40.24-26.17 78.6-39.15 102.46-33.35 209.84 51.04 16.87 488.52 255.07 690.25 2.59 2.19 6.37-.33 5.49-3.5z' class='cls-3'/%3E%3Cpath d='M162.1 557.49c35.83-38.33 50.97-93.42 89.05-129.78-58.86 152.36-22.83 214.55 82.7 66.16 4.09 38.37 18 96.25 97.08 126.51.15-.13-2.86-11.12-2.86-11.12-82.71-102.91 11.17-304.72-97.3-198.01-15.75 35.93-25.62 79.33-56.69 106.79 11.2-65.26 43.61-127.39 64.9-188.93 3.76-13.08 11.28-42.32-13.68-35.31-26.08 7.33-71.58 86.96-93.2 107.17 7.42-31.25 61.76-112.29 43.25-139.95-44.9-34.33-51.05-33.86-99.13-3.06C123.63 291.38-34.51 408.03 6.81 478.02c17.61 17.66 16.97-21.7 23.14-35.5 13.07-54.09 251.46-294.69 171.6-96.24-27.76 67.25-54.89 135.07-83.77 201.88-61.32 106.28-2.31 54.05 44.32 9.33' class='cls-3'/%3E%3Cpath d='M811.88 92c-27.73 0-59.27 11.26-91.2 32.58-33.44 22.32-65.84 54.82-93.71 94.01-48.68 68.44-168.92 272.69-57.28 618.9-5.67-36.52-31.83-181.55-32.29-218.65-4.53-141.42 48.62-323.71 146.57-419.1 25.4-26.99 63.05-65.54 154.09-103.91 8.21-3.46-10.48 5.2 0 0-8.08-2.54-16.88-3.83-26.19-3.83Z' class='cls-2'/%3E%3Ccircle cx='512' cy='77.61' r='77.61' class='cls-1'/%3E%3Cpath d='M375.81 199.73c-1.96.73-3.91 1.46-5.86 2.23-.02 0-.04.02-.06.02-31.75 12.52-61.12 29.03-87.71 49.21a371 371 0 0 0-6.67 5.17c.69.53 1.36 1.03 2.07 1.57s2.23 3.15 2.23 3.15l5.15-4c26.57-20.29 56.31-37.09 88.45-49.64l6.04-2.3c-1.18-1.86-2.4-3.66-3.65-5.42Z' class='cls-1'/%3E%3Cpath d='M442.44 625.58c-13.54-64.72-17.18-131.22-20.7-195.54-4.86-88.87-9.45-172.81-41.82-224.19l-2.64-4-6.57 1.32 3.83 6.07c31.49 49.98 36.04 133.12 40.85 221.14 2.96 54.16 6.01 109.87 14.97 164.89-30.62-44.74-30.86-106.81-31.04-152.82-.07-18.32-.13-34.14-2.12-45.85-1.24-7.34-3.14-12.68-5.97-16.8-3.98-5.79-9.92-8.98-16.73-8.98-12.01 0-27.22 9.93-50.86 33.19l-1.4 1.37-.79 1.79c-3.92 8.95-7.52 18.43-11 27.6-3.99 10.52-8.04 21.18-12.7 31.4 7.98-24.59 17.79-48.9 27.4-72.73 8.07-20 16.42-40.67 23.45-60.99l.09-.26.07-.26c4.25-14.8 7.55-31.32-.25-41.67-2.64-3.51-7.63-7.69-16.41-7.69-2.96 0-6.09.47-9.57 1.45-13.78 3.87-29 20.18-47.35 44.14 2.82-6.62 5.41-13.2 7.57-19.54 7.58-22.27 8.6-37.98 3.2-49.42l-2.78-5.9-5.05 4.21 2.08 4.4c10.07 21.35-9.34 61.85-26.46 97.58-3.88 8.09-7.65 15.97-10.78 23.06 5.36-6.96 11.29-15.15 17.39-23.59 21.62-29.91 46.13-63.81 63.92-68.81 2.87-.81 5.51-1.21 7.85-1.21 6.15 0 9.55 2.81 11.32 5.16 6.15 8.17 2.81 23.58-.78 36.09l-.03.1-.03.1c-6.98 20.17-15.29 40.77-23.33 60.69-15.13 37.49-30.73 76.13-39.08 115.49 17.22-19.46 26.86-44.86 36.22-69.52 3.45-9.1 7.02-18.5 10.88-27.3l.3-.67.52-.52c22.05-21.69 36.35-31.36 46.4-31.36 12.97 0 15.58 15.42 16.43 20.49 1.9 11.2 1.96 26.78 2.03 44.82.2 49.62.46 117.58 38.09 164.39l.5.62.21.76s.76 2.76 1.5 5.54c.37 1.4.74 2.81 1.01 3.87.53 2.14.99 3.98-.78 5.56l-1.73 1.55-2.17-.83c-35.66-13.65-62.1-34.44-78.57-61.81-12.34-20.5-17.33-41.69-19.73-58.16-37.55 51.34-68.14 78.4-88.72 78.4-6.88 0-12.61-3.06-16.58-8.85-12.89-18.8-7.27-66.33 14.88-128.98-13.14 16.13-23.6 34.72-33.79 52.83-12.23 21.74-24.88 44.22-42.16 62.71l-.07.08-.08.07-4.83 4.62-5.31 5.05 1.61 7.25 8.08-7.7c1.63-1.55 3.25-3.1 4.85-4.64l.2-.19.19-.2c17.81-19.05 30.64-41.87 43.06-63.93 3.13-5.57 6.23-11.07 9.36-16.45-3.25 12.42-5.67 24-7.19 34.52-3.96 27.31-1.96 47.01 5.96 58.55 5.14 7.49 12.89 11.61 21.83 11.61 21.26 0 49.83-23.28 85.08-69.27 3.14 14.17 8.46 30.21 17.93 45.95 17.23 28.61 44.73 50.31 81.75 64.47l2.61 1 6.74-1.95.32 1.52 6.11-1.85-.63-3.03ZM158.93 440.15l.11-.27c5.03-12.26 10.05-24.52 15.07-36.78.1-.24.2-.49.3-.73 7.72-18.88 15.71-38.4 23.6-57.53.95-2.36 1.83-4.62 2.68-6.83a331 331 0 0 0-24.63 44.75c-10.42 22.97-18.01 46.73-22.76 71.06 1.88-4.56 3.75-9.12 5.62-13.67ZM553.66 180.15c.4-.64.57-.91.65-1.05.28-.44.56-.9.84-1.34l-7.05-.71c-12.1-1.13-24.32-1.72-36.63-1.72-10.3 0-20.52.42-30.68 1.21-2.28.18-4.56.35-6.83.57.42.81.83 1.63 1.24 2.44h-.01l1.18 2.35c13.49 26.88 23.5 56.95 28.97 87.05 15.78-32.85 31.18-61.24 47.04-86.76l1.28-2.05Zm-45.92 69.44c-5.58-23.15-13.73-45.9-23.92-66.89 9.13-.66 18.34-1.01 27.65-1.01 11.09 0 22.06.5 32.9 1.42-12.34 20.15-24.41 42.04-36.63 66.48' class='cls-1'/%3E%3Cpath d='m443.08 628.61-.07-.34-.56-2.7-6.64-.78-262.31-.08a314 314 0 0 1-14.14-50.52l-2.2-6.69-2.55 2.43v-.03c-.73.68-1.45 1.36-2.16 2.03q.675 3.75 1.44 7.47c3.3 16.11 7.85 31.99 13.65 47.54l1.54 4.14h4.42l263.62.09h6.51c-.19-.85-.36-1.69-.54-2.54ZM651.79 516.3c10.63 27.59 33.48 42.17 66.08 42.17 39.01 0 90.46-21.24 148.78-61.42l1.94-1.36v.01c2.02-1.4 4.04-2.82 6.08-4.27-.18-2.41-.38-4.81-.61-7.21-3.37-35-12.46-69.01-27.18-101.45-18.37-40.49-44.65-76.84-78.12-108.04-.93-.86-1.86-1.72-2.8-2.57-1.56-1.42-3.14-2.83-4.72-4.23a377 377 0 0 0-4.58 4.07l-.21.19-.34.31c-95.47 86.41-125 190.11-104.31 243.8Zm15.32-109.42c12.83-32.26 39.42-80.94 93.26-129.67l.84-.76c60.18 54.72 99.75 129.03 106.84 211.9l-5 3.44c-57.26 39.45-107.46 60.3-145.17 60.3-29.75 0-50.54-13.17-60.15-38.09-10.39-26.96-6.97-66 9.39-107.13Z' class='cls-1'/%3E%3Cpath d='m872.45 534.07-.61.87c-20.49 29.62-44.42 52.33-71.13 67.5-24.62 13.98-50.57 21.07-77.13 21.07-55.18 0-104.86-31.19-129.65-81.41-15.05-30.49-19.88-66.21-13.97-103.31 6.66-41.82 26.36-84.32 58.55-126.34 19.81-25.85 48.64-49.49 83.41-68.38.19-.1.37-.21.56-.31l2.06-1.11h.02c.85-.44 1.71-.91 2.55-1.35-1.99-1.37-4.01-2.69-6.02-4.02-12.25-8.07-25.03-15.41-38.27-22.02l.02-.02h-.08c-1.93-.97-3.88-1.92-5.83-2.86-1.51 1.61-3.01 3.24-4.5 4.88s-.01.02-.02.02C581.03 318.63 537.2 492.73 541.24 618.69v.08c.02 1.77.1 3.79.24 6.04.12 1.95.28 4.08.48 6.36h6.21l.08.01 301.14.09h4.42l1.55-4.14c10.25-27.44 16.63-55.89 19.08-84.86.35-4.09.61-8.2.8-12.31-.91 1.38-1.84 2.74-2.77 4.09Zm-324.6 90.76-.02-.39c-.13-2.18-.21-4.1-.23-5.73v-.16c-3.78-117.85 35.16-292.32 129.55-397l1.23-1.36a363 363 0 0 1 36.38 20.59c-33.7 18.93-61.75 42.29-81.3 67.81-32.84 42.87-52.96 86.34-59.78 129.21-6.12 38.41-1.09 75.45 14.55 107.13 19.93 40.38 55.31 68.96 96.86 79.95l-137.23-.04Zm301.52.09-86.93-.03c14.12-3.65 27.96-9.29 41.4-16.93 23.27-13.22 44.45-31.95 63.15-55.78a312.6 312.6 0 0 1-17.62 72.73Z' class='cls-2'/%3E%3Cpath d='M145.4 905.19v-114h32.25v114zm29.8-44.46v-26.71h48.53v26.71zm46.25 44.46v-114h32.25v114zM262.82 905.19l50.33-114h31.76l50.49 114h-33.55l-39.41-98.21h12.7l-39.41 98.21h-32.9Zm27.52-22.31 8.31-23.62h55.7l8.31 23.62h-72.31ZM404.67 905.19v-114h32.25v88.44h54.23v25.57h-86.48ZM504.02 905.19v-114h32.25v114zM559.23 905.19v-114h89.25v25.08h-57v88.92zm29.8-39.09v-24.92h52.61v24.92zM645.55 905.19l50.33-114h31.76l50.49 114h-33.55l-39.41-98.21h12.7l-39.41 98.21h-32.9Zm27.52-22.31 8.31-23.62h55.7l8.31 23.62h-72.31Z' class='cls-1'/%3E%3Cpath d='m769.32 905.19 49.84-69.38-.16 22.96-47.88-67.59h36.32l30.46 44.14h-15.31l30.13-44.14h34.69l-47.72 66.45v-22.8l50.49 70.36h-37.13l-31.11-46.42h14.82l-30.62 46.42h-36.81ZM264.72 751.36l42.64-42.94c1.7-1.7 3.08-3.28 4.13-4.73s1.8-2.83 2.25-4.13.68-2.65.68-4.05c0-3.5-1.13-6.28-3.38-8.33s-5.28-3.08-9.08-3.08c-3.4 0-6.56 1.03-9.46 3.08s-6.01 5.53-9.31 10.43l-19.52-17.57c4.4-7 10.08-12.31 17.04-15.92 6.96-3.6 14.89-5.4 23.8-5.4 8.11 0 15.09 1.43 20.94 4.28 5.86 2.85 10.36 6.93 13.51 12.24s4.73 11.61 4.73 18.92c0 4.11-.55 7.96-1.65 11.56s-2.85 7.13-5.26 10.58c-2.4 3.45-5.51 6.98-9.31 10.58l-26.88 25.52-35.88-1.05Zm0 16.07v-16.07l24.92-8.56h56.3v24.62h-81.23ZM400.75 769.23c-9.21 0-17.39-2.38-24.55-7.13s-12.79-11.31-16.89-19.67c-4.11-8.36-6.16-17.89-6.16-28.6s2.03-20.22 6.08-28.53 9.63-14.81 16.74-19.52c7.11-4.7 15.26-7.06 24.47-7.06s17.54 2.35 24.7 7.06c7.15 4.71 12.76 11.21 16.82 19.52 4.05 8.31 6.08 17.87 6.08 28.68s-2.03 20.37-6.08 28.68-9.63 14.81-16.74 19.52-15.26 7.06-24.47 7.06Zm-.15-25.52c3.7 0 6.85-1.15 9.46-3.45 2.6-2.3 4.58-5.68 5.93-10.13s2.03-9.83 2.03-16.14-.68-11.66-2.03-16.06-3.33-7.78-5.93-10.13-5.81-3.53-9.61-3.53c-3.6 0-6.71 1.15-9.31 3.45s-4.58 5.66-5.93 10.06c-1.35 4.41-2.03 9.76-2.03 16.07s.68 11.69 2.03 16.14c1.35 4.46 3.33 7.86 5.93 10.21s5.75 3.53 9.46 3.53ZM589.47 751.36l42.64-42.94c1.7-1.7 3.08-3.28 4.13-4.73s1.8-2.83 2.25-4.13.68-2.65.68-4.05c0-3.5-1.13-6.28-3.38-8.33s-5.28-3.08-9.08-3.08c-3.4 0-6.56 1.03-9.46 3.08s-6.01 5.53-9.31 10.43l-19.52-17.57c4.4-7 10.08-12.31 17.04-15.92 6.96-3.6 14.89-5.4 23.8-5.4 8.11 0 15.09 1.43 20.94 4.28 5.86 2.85 10.36 6.93 13.51 12.24s4.73 11.61 4.73 18.92c0 4.11-.55 7.96-1.65 11.56s-2.85 7.13-5.26 10.58c-2.4 3.45-5.51 6.98-9.31 10.58l-26.88 25.52-35.88-1.05Zm0 16.07v-16.07l24.92-8.56h56.3v24.62h-81.23ZM718.44 769.23c-7.81 0-14.84-1.65-21.09-4.96-6.26-3.3-11.21-7.78-14.86-13.44-3.65-5.65-5.48-12.03-5.48-19.14 0-8.41 2.9-16.87 8.71-25.37l31.08-45.79h33.33l-35.88 49.55-11.26-2.4c1.7-2.5 3.33-4.65 4.88-6.46 1.55-1.8 3.45-3.2 5.71-4.2 2.25-1 5.23-1.5 8.93-1.5 7.01 0 13.31 1.63 18.92 4.88 5.6 3.25 10.08 7.61 13.44 13.06 3.35 5.46 5.03 11.54 5.03 18.24 0 7.11-1.83 13.49-5.48 19.14-3.65 5.66-8.58 10.13-14.79 13.44-6.21 3.3-13.26 4.96-21.17 4.96Zm0-24.92c2.5 0 4.73-.58 6.68-1.73s3.48-2.75 4.58-4.8 1.65-4.38 1.65-6.98-.55-4.93-1.65-6.98-2.63-3.65-4.58-4.8-4.18-1.73-6.68-1.73-4.73.58-6.68 1.73-3.48 2.75-4.58 4.8-1.65 4.38-1.65 6.98.55 4.93 1.65 6.98 2.63 3.65 4.58 4.8 4.18 1.73 6.68 1.73' class='cls-1'/%3E%3C/svg%3E"
                        }
                        alt="MYC Halifax 2026 logo"
                    />

                    <h1>{props.title}</h1>
                </div>
                <For each={groupedLocal()}>
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
                                    const isNext = () => nextEventLocal() === e;

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
                                                {isLive() && (
                                                    <span class="dot" />
                                                )}

                                                {e.honorific ||
                                                e.speakerTitle ||
                                                e.order ? (
                                                    <>
                                                        {e.honorific && (
                                                            <div class="honorific">
                                                                <RenderWithBreaks
                                                                    text={
                                                                        e.honorific
                                                                    }
                                                                />
                                                            </div>
                                                        )}

                                                        <div class="name-line">
                                                            <strong class="name">
                                                                <RenderWithBreaks
                                                                    text={
                                                                        e.title
                                                                    }
                                                                />
                                                            </strong>
                                                            {e.order && (
                                                                <span class="order">
                                                                    {e.order}
                                                                </span>
                                                            )}

                                                            {isNext() &&
                                                                !isLive() && (
                                                                    <span
                                                                        classList={{
                                                                            countdown: true,
                                                                            timeout:
                                                                                props.timedOut() &&
                                                                                !props.isFresh() &&
                                                                                !isPast(),
                                                                            updated:
                                                                                props.isFresh() &&
                                                                                props
                                                                                    .changedKeys()
                                                                                    .has(
                                                                                        getKey(
                                                                                            e,
                                                                                        ),
                                                                                    ),
                                                                        }}
                                                                    >
                                                                        {props.timedOut() &&
                                                                        !isPast()
                                                                            ? "⚠ "
                                                                            : " "}
                                                                        {formatRelative(
                                                                            e.start.getTime() -
                                                                                now().getTime(),
                                                                        )}
                                                                    </span>
                                                                )}
                                                        </div>

                                                        {e.speakerTitle && (
                                                            <div class="speaker-title">
                                                                <RenderWithBreaks
                                                                    text={
                                                                        e.speakerTitle
                                                                    }
                                                                />
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        <strong>
                                                            {e.title}
                                                        </strong>

                                                        {isNext() &&
                                                            !isLive() && (
                                                                <span
                                                                    classList={{
                                                                        countdown: true,
                                                                        timeout:
                                                                            props.timedOut() &&
                                                                            !props.isFresh() &&
                                                                            !isPast(),
                                                                        updated:
                                                                            props.isFresh() &&
                                                                            props
                                                                                .changedKeys()
                                                                                .has(
                                                                                    getKey(
                                                                                        e,
                                                                                    ),
                                                                                ),
                                                                    }}
                                                                >
                                                                    {props.timedOut() &&
                                                                    !isPast()
                                                                        ? "⚠ "
                                                                        : " "}
                                                                    {formatRelative(
                                                                        e.start.getTime() -
                                                                            now().getTime(),
                                                                    )}
                                                                </span>
                                                            )}
                                                    </>
                                                )}
                                            </span>
                                            {!isPast() && <br />}{" "}
                                            <div class="details">
                                                <span
                                                    classList={{
                                                        time: true,
                                                        timeout:
                                                            props.timedOut() &&
                                                            !props.isFresh() &&
                                                            !isPast(),
                                                        updated:
                                                            props.isFresh() &&
                                                            props
                                                                .changedKeys()
                                                                .has(getKey(e)),
                                                    }}
                                                >
                                                    {props.timedOut() &&
                                                    !isPast()
                                                        ? "⚠ "
                                                        : " "}
                                                    {e.isExplicitEnd
                                                        ? (USER_TZ === TIMEZONE
                                                              ? timeFormatter
                                                              : timeFormatterWithTZ
                                                          ).formatRange(
                                                              e.start,
                                                              e.end,
                                                          )
                                                        : (USER_TZ === TIMEZONE
                                                              ? timeFormatter
                                                              : timeFormatterWithTZ
                                                          ).format(
                                                              e.start,
                                                          )}{" "}
                                                    {e.isExplicitEnd && (
                                                        <span class="duration">
                                                            {"("}
                                                            {formatDuration(
                                                                e.end.getTime() -
                                                                    e.start.getTime(),
                                                            )}
                                                            {")"}
                                                        </span>
                                                    )}
                                                </span>
                                                <Location
                                                    e={e}
                                                    timedOut={() =>
                                                        props.timedOut()
                                                    }
                                                    isFresh={() =>
                                                        props.isFresh()
                                                    }
                                                    isPast={() => now() > e.end}
                                                    changedKeys={() =>
                                                        props.changedKeys()
                                                    }
                                                />
                                            </div>
                                        </div>
                                    );
                                }}
                            </For>
                        </div>
                    )}
                </For>
                <Transition name="jumps">
                    <Show when={showJump()}>
                        <div
                            class="jump-hitbox"
                            onClick={() => {
                                document.querySelector(".event.live")
                                    ? document
                                          .querySelector(".event.live")
                                          ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "center",
                                          })
                                    : document
                                          .querySelector(
                                              ".event:has(.countdown)",
                                          )
                                          ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "center",
                                          });
                            }}
                        >
                            <button
                                classList={{
                                    jump: true,
                                    upcoming: document.querySelector(
                                        ".event.live",
                                    )
                                        ? false
                                        : true,
                                }}
                            >
                                <span class={isAbove() ? "down" : "up"}></span>
                            </button>
                        </div>
                    </Show>
                </Transition>
            </>
        );
    }

    // Views that reuse the schedule renderer
    function ShuttlesView() {
        const provider = createSheetProvider({
            view: "shuttles",
            columns: ["pickup", "dropoff", "start", "end"],
            remap: { title: "dropoff", location: "pickup" },
            remapToEvent: true,
        });

        onMount(() => provider.init());
        onCleanup(() => provider.cleanup());

        return (
            <div>
                {/* <div class="sheet-skeleton">
                    <Suspense fallback={<div>Loading…</div>}>
                        <SheetView
                            view="shuttles"
                            columns={["pickup", "dropoff", "start", "end"]}
                        />
                    </Suspense>
                </div> */}

                <ScheduleRenderer
                    title="Shuttles Schedule"
                    events={() => provider.events()}
                    timedOut={() => provider.timedOut()}
                    isFresh={() => provider.isFresh()}
                    changedKeys={() => provider.changedKeys()}
                />
            </div>
        );
    }

    function SpeakersView() {
        const provider = createSheetProvider({
            view: "speakers",
            columns: ["honorific", "name", "order", "title", "start", "end"],
            remap: { title: "name" },
            remapToEvent: true,
        });

        onMount(() => provider.init());
        onCleanup(() => provider.cleanup());

        return (
            <div>
                <div class="sheet-skeleton">
                    <Suspense fallback={<div>Loading…</div>}>
                        <SheetView
                            view="speakers"
                            columns={[
                                "honorific",
                                "name",
                                "order",
                                "title",
                                "start",
                                "end",
                            ]}
                        />
                    </Suspense>
                </div>

                <ScheduleRenderer
                    title="Speakers"
                    events={() => provider.events()}
                    timedOut={() => provider.timedOut()}
                    isFresh={() => provider.isFresh()}
                    changedKeys={() => provider.changedKeys()}
                />
            </div>
        );
    }

    // Simple editable skeletons for other sheets
    function GalaView() {
        const provider = createSheetProvider({
            view: "gala",
            columns: ["name", "table"],
        });
        onMount(() => provider.init());
        onCleanup(() => provider.cleanup());
        return (
            <div>
                <h1>
                    Gala Seating{" "}
                    {provider.timedOut() && !provider.isFresh() ? "⚠ " : ""}
                </h1>
                <Suspense fallback={<div>Loading…</div>}>
                    <SheetView view="gala" columns={["name", "table"]} />
                </Suspense>
                <div class="skeleton">Customize gala UI here.</div>
            </div>
        );
    }

    function ContactView() {
        const provider = createSheetProvider({
            view: "contact",
            columns: ["title", "name", "phone", "email"],
        });
        onMount(() => provider.init());
        onCleanup(() => provider.cleanup());
        return (
            <div>
                <h1>
                    Emergency Contacts{" "}
                    {provider.timedOut() && !provider.isFresh() ? "⚠ " : ""}
                </h1>
                <Suspense fallback={<div>Loading…</div>}>
                    <SheetView
                        view="contact"
                        columns={["title", "name", "phone", "email"]}
                    />
                </Suspense>
                <div class="skeleton">Customize contacts UI here.</div>
            </div>
        );
    }

    function SponsorsView() {
        const provider = createSheetProvider({
            view: "sponsors",
            columns: ["name", "level", "logo", "url"],
        });
        onMount(() => provider.init());
        onCleanup(() => provider.cleanup());
        return (
            <div>
                <h1>
                    Sponsors{" "}
                    {provider.timedOut() && !provider.isFresh() ? "⚠ " : ""}
                </h1>
                <Suspense fallback={<div>Loading…</div>}>
                    <SheetView
                        view="sponsors"
                        columns={["name", "level", "logo", "url"]}
                    />
                </Suspense>

                <div class="sponsors-grid">
                    <For each={provider.rows()}>
                        {(r) => (
                            <div class="sponsor">
                                <div class="level">{r.level}</div>
                                <a
                                    href={r.url || "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <img
                                        src={r.logo || ""}
                                        alt={r.name || "sponsor"}
                                    />
                                </a>
                            </div>
                        )}
                    </For>
                </div>
            </div>
        );
    }

    function ScheduleView() {
        const provider = createSheetProvider({
            view: "schedule",
            columns: ["title", "start", "end", "location"],
            remapToEvent: true,
        });

        onMount(() => provider.init());
        onCleanup(() => provider.cleanup());

        return (
            <div>
                {/* <div class="sheet-skeleton">
                    <Suspense fallback={<div>Loading…</div>}>
                        <SheetView
                            view="schedule"
                            columns={["title", "start", "end", "location"]}
                        />
                    </Suspense>
                </div> */}

                <ScheduleRenderer
                    title="Event Schedule"
                    events={() => provider.events()}
                    timedOut={() => provider.timedOut()}
                    isFresh={() => provider.isFresh()}
                    changedKeys={() => provider.changedKeys()}
                />
            </div>
        );
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
                    setTimeout(() => setChangedKeys(new Set<string>()), 1618);
                }

                return merged;
            });
            setStored(data);
            lastHash = incomingHash;
        }
    }

    onMount(() => {
        const hash = location.hash.replace("#", "");
        if (
            hash === "schedule" ||
            hash === "shuttles" ||
            hash === "gala" ||
            hash === "contact" ||
            hash === "speakers" ||
            hash === "sponsors"
        )
            setView(hash as any);

        const startFetch = () => load();

        if ("requestIdleCallback" in window) {
            requestIdleCallback(startFetch);
        } else {
            setTimeout(startFetch, 0);
        }

        window.addEventListener("scroll", checkPosition);

        let resizeTimer1: number | undefined;
        let resizeTimer2: number | undefined;
        let resizeTimer3: number | undefined;
        const handleWindowResize = () => {
            if (resizeTimer1) {
                window.clearTimeout(resizeTimer1);
            }
            if (resizeTimer2) {
                window.clearTimeout(resizeTimer2);
            }
            if (resizeTimer3) {
                window.clearTimeout(resizeTimer3);
            }
            resizeTimer1 = window.setTimeout(() => {
                runFit();
            }, 127);
            resizeTimer2 = window.setTimeout(() => {
                runFit();
            }, 255);
            resizeTimer3 = window.setTimeout(() => {
                runFit();
            }, 382);
        };

        window.addEventListener("resize", handleWindowResize);
        window.addEventListener("orientationchange", handleWindowResize);

        const container = document.querySelector(".container");
        let lastContainerWidth = container?.clientWidth ?? 0;
        const resizeObserver = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? 0;
            if (width && width !== lastContainerWidth) {
                lastContainerWidth = width;
                runFit();
            }
        });

        if (container) {
            resizeObserver.observe(container);
        }

        const fetchTimer = setInterval(load, 30000);
        const clockTimer = setInterval(() => setNow(new Date()), 1000);
        const timeout = setTimeout(() => {
            if (!isFresh()) setTimedOut(true);
        }, 6180);

        return () => {
            clearInterval(fetchTimer);
            clearInterval(clockTimer);
            clearTimeout(timeout);
            if (resizeTimer1) {
                window.clearTimeout(resizeTimer1);
            }
            if (resizeTimer2) {
                window.clearTimeout(resizeTimer2);
            }
            if (resizeTimer3) {
                window.clearTimeout(resizeTimer3);
            }
            window.removeEventListener("scroll", checkPosition);
            window.removeEventListener("resize", handleWindowResize);
            window.removeEventListener("orientationchange", handleWindowResize);
            resizeObserver.disconnect();
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

    createRenderEffect(() => {
        if (events().length === 0) return;
        locationSignature();
        titleSignature();
        liveSignature();
        window.setTimeout(() => {
            runFit();
        }, 127);
        window.setTimeout(() => {
            runFit();
        }, 255);
        window.setTimeout(() => {
            runFit();
        }, 382);
        // runFit();
    });

    createEffect(() => {
        history.replaceState(null, "", `#${view()}`);

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
            <button class="back" onClick={() => setView("home")}>
                ← Back
            </button>
            <Switch>
                <Match when={view() === "home"}>
                    <Home setView={setView} />
                </Match>
                <Match when={view() === "shuttles"}>
                    <ShuttlesView />
                </Match>
                <Match when={view() === "gala"}>
                    <GalaView />
                </Match>
                <Match when={view() === "contact"}>
                    <ContactView />
                </Match>
                <Match when={view() === "speakers"}>
                    <SpeakersView />
                </Match>
                <Match when={view() === "sponsors"}>
                    <SponsorsView />
                </Match>
                <Match when={view() === "schedule"}>
                    <ScheduleView />
                </Match>
            </Switch>
        </div>
    );
}
