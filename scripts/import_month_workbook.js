const { spawnSync } = require("child_process");
const path = require("path");

const PROD_CONVEX_URL = "https://colorful-mosquito-63.eu-west-1.convex.cloud";

function requireArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${flag}`);
  }
  return process.argv[index + 1];
}

function optionalFlag(flag) {
  return process.argv.includes(flag);
}

function optionalArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? "" : (process.argv[index + 1] || "");
}

function splitMulti(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseDateString(value) {
  const input = normalizeText(value);
  if (!input) {
    return "";
  }

  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return input;
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return input;
}

function parseLegacyTimestamp(value) {
  const input = normalizeText(value);
  if (!input) {
    return Date.now();
  }

  const match = input.match(/^(\d{1,2})\/([A-Za-z]+)\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i);
  if (!match) {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  const [, dayText, monthText, yearText, hourText, minuteText, secondText, meridiemText] = match;
  const monthIndex = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].indexOf(monthText.toLowerCase());
  if (monthIndex === -1) {
    return Date.now();
  }

  let hours = Number(hourText);
  const meridiem = meridiemText.toUpperCase();
  if (meridiem === "PM" && hours < 12) {
    hours += 12;
  }
  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  const date = new Date(
    Number(yearText),
    monthIndex,
    Number(dayText),
    hours,
    Number(minuteText),
    Number(secondText),
  );
  return date.getTime();
}

function parseWorkbook(workbookPath) {
  const scriptPath = path.join(__dirname, "read_workbook.ps1");
  const result = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Path", workbookPath],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to read workbook.");
  }

  return JSON.parse(result.stdout);
}

function ensureRows(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return [value];
  }
  return [];
}

function mapEvents(rows) {
  return rows.map((row) => ({
    itemId: normalizeText(row["Item ID (auto generated)"]),
    name: normalizeText(row["Name"] || row["Company / Event name"]),
    date: parseDateString(row["Date"]),
    hours: normalizeText(row["Hours"]),
    branch: splitMulti(row["Branch"]),
    products: splitMulti(row["Product/s"]),
    status: normalizeText(row["Status"]),
    location: normalizeText(row["Location"]),
    paymentStatus: normalizeText(row["Payment"] || row["Payment Status"]),
    accounts: normalizeText(row["Accounts"]),
    vinyl: normalizeText(row["Vinyl?"]),
    gsAi: normalizeText(row["GS / AI?"]),
    imagesSent: normalizeText(row["Images sent?"]),
    snappic: normalizeText(row["Snappic?"]),
    attendants: splitMulti(row["Attendant/s"]),
    exVat: normalizeText(row["Ex. vat"]),
    packageOnly: normalizeText(row["Package Only"]),
  })).filter((event) => event.itemId && event.name);
}

function mapUpdates(rows) {
  return rows.map((row) => ({
    itemId: normalizeText(row["Item ID"]),
    actorName: normalizeText(row["User"]),
    body: normalizeText(row["Update Content"]),
    createdAt: parseLegacyTimestamp(row["Created At"]),
  })).filter((entry) => entry.itemId && entry.body);
}

async function runImport({ workbookPath, workspaceYear, monthNumber, prod, deploymentUrl }) {
  const workbook = parseWorkbook(workbookPath);
  const allEvents = mapEvents(ensureRows(workbook.events));
  const allUpdates = mapUpdates(ensureRows(workbook.updates));
  const chunkSize = 20;

  for (let start = 0; start < allEvents.length; start += chunkSize) {
    const eventBatch = allEvents.slice(start, start + chunkSize);
    const itemIds = new Set(eventBatch.map((event) => event.itemId));
    const updateBatch = allUpdates.filter((update) => itemIds.has(update.itemId));
    const payload = {
      workspaceYear,
      monthNumber,
      events: eventBatch,
      updates: updateBatch,
    };
    const response = await fetch(`${deploymentUrl}/api/mutation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Convex-Client": "codex-import-script",
      },
      body: JSON.stringify({
        path: "imports:importMonthWorkbook",
        format: "convex_encoded_json",
        args: [payload],
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(result));
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

async function main() {
  const workbookPath = requireArg("--file");
  const workspaceYear = Number(requireArg("--year"));
  const monthNumber = Number(requireArg("--month"));
  const prod = optionalFlag("--prod");
  const deploymentUrl = optionalArg("--url") || (prod ? PROD_CONVEX_URL : "");
  if (!deploymentUrl) {
    throw new Error("Missing deployment URL. Pass --url or use --prod.");
  }

  await runImport({
    workbookPath,
    workspaceYear,
    monthNumber,
    prod,
    deploymentUrl,
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
