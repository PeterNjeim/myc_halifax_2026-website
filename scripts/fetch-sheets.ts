import fs from "fs/promises";

const SHEET_URL =
    "https://opensheet.elk.sh/1Sbs6P_5nYPKJPacHhh5f12cRY8nByyOFLfkbhN6FPyw/schedule";

const HTML_PATH = "./index.html";
const JSON_PATH = "./src/assets/schedule.json";

type RawEvent = {
    title: string;
    start?: string;
    end?: string;
};

async function fetchSchedule(): Promise<RawEvent[]> {
    const res = await fetch(SHEET_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return res.json();
}

async function updateJsonFile(json: string) {
    const old = await fs.readFile(JSON_PATH, "utf-8").catch(() => null);

    if (old === json) {
        console.log("No changes in schedule.json");
        return;
    }

    await fs.writeFile(JSON_PATH, json);
    console.log("Updated src/schedule.json");
}

async function injectIntoHtml(json: string) {
    let html = await fs.readFile(HTML_PATH, "utf-8");

    const updated = html.replace(
        /<script id="__SCHEDULE__" type="application\/json">[\s\S]*?<\/script>/,
        `<script id="__SCHEDULE__" type="application/json">${json}</script>`
    );

    await fs.writeFile(HTML_PATH, updated);
    console.log("Injected JSON into index.html");
}

function validate(data: unknown): asserts data is RawEvent[] {
    if (!Array.isArray(data)) throw new Error("Invalid data");

    for (const e of data) {
        if (Object.keys(e).length !== 0 && typeof e.title !== "string") {
            throw new Error("Invalid event format");
        }
    }
}

async function main() {
    console.log("Fetching schedule...");

    const data = await fetchSchedule();
    const json = JSON.stringify(data).replaceAll("</script>", "<\\/script>");

    await updateJsonFile(json);
    validate(data);
    await injectIntoHtml(json);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
