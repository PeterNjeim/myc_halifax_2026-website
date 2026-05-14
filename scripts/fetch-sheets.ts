import fs from "fs/promises";

const SHEET_BASE =
    "https://opensheet.elk.sh/1Sbs6P_5nYPKJPacHhh5f12cRY8nByyOFLfkbhN6FPyw";
const SHEET_VIEWS = [
    "schedule",
    "shuttles",
    "gala",
    "contact",
    "speakers",
    "sponsors",
] as const;

const HTML_PATH = "./index.html";

type SheetView = (typeof SHEET_VIEWS)[number];
type RawEvent = {
    title: string;
    start?: string;
    end?: string;
};

async function fetchSheet(sheetView: SheetView): Promise<unknown> {
    const res = await fetch(`${SHEET_BASE}/${sheetView}`, {
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`Fetch failed for ${sheetView}: ${res.status}`);
    return res.json();
}

async function injectIntoHtml(sheetView: SheetView, json: string) {
    let html = await fs.readFile(HTML_PATH, "utf-8");
    const tag = `<script id="__${sheetView.toUpperCase()}__" type="application/json">`;
    const regex = new RegExp(
        `<script id="__${sheetView.toUpperCase()}__" type="application/json">[\\s\\S]*?<\\/script>`,
    );
    const replacement = `${tag}${json}</script>`;

    if (regex.test(html)) {
        html = html.replace(regex, replacement);
    } else {
        html = html.replace("</head>", `${replacement}\n</head>`);
    }

    await fs.writeFile(HTML_PATH, html);
    console.log(`Injected ${sheetView} JSON into index.html`);
}

function validateScheduleData(data: unknown): asserts data is RawEvent[] {
    if (!Array.isArray(data)) throw new Error("Invalid schedule data");

    for (const e of data) {
        if (Object.keys(e).length !== 0 && typeof e.title !== "string") {
            throw new Error("Invalid schedule item format");
        }
    }
}

async function main() {
    console.log("Fetching sheets...");

    for (const sheetView of SHEET_VIEWS) {
        const data = await fetchSheet(sheetView);
        if (!Array.isArray(data)) {
            throw new Error(`Invalid data for ${sheetView}`);
        }

        const json = JSON.stringify(data).replaceAll("</script>", "<\\/script>");

        if (sheetView === "schedule") {
            validateScheduleData(data);
        }

        await injectIntoHtml(sheetView, json);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
