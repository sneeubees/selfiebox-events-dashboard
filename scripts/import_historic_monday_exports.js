const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function requireArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${flag}`);
  }
  return process.argv[index + 1];
}

function optionalArg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function splitMulti(value) {
  return normalizeText(value)
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeBranchValue(value) {
  const raw = normalizeText(value);
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) {
    return "";
  }
  if (["dbn", "durban", "kzn", "kwazulunatal"].includes(key)) {
    return "KZN";
  }
  if (["gp", "gauteng"].includes(key)) {
    return "GP";
  }
  if (["ct", "capetown", "capetowncitycentre"].includes(key)) {
    return "CT";
  }
  return raw;
}

function parseDateString(value) {
  const input = normalizeText(value);
  if (!input) {
    return "";
  }

  const isoDateMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return input;
}

function parseWorkbook(workbookPath) {
  const scriptPath = path.join(__dirname, "read_historic_workbook.ps1");
  const result = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Path", workbookPath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to read workbook.");
  }

  return JSON.parse(result.stdout);
}

function monthNumberFromFileName(fileName) {
  const lower = fileName.toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => lower.includes(month.toLowerCase()));
  if (index === -1) {
    throw new Error(`Could not determine month from file name: ${fileName}`);
  }
  return index + 1;
}

function mapRowsToEvents(rows, year, monthNumber) {
  return rows
    .map((row, index) => {
      const rowNumber = Number(row.__rowNumber || (index + 4));
      const turnoverExclVat = normalizeText(row["Turnover Excl VAT"]);
      const exVatAmount = normalizeText(row["Ex VAT amount"]);
      const exclJc = normalizeText(row["Ex. vat"] || row["Ex. Vat"] || row["Ex. VAT"]);
      return {
        eventKey: `historic-${year}-${String(monthNumber).padStart(2, "0")}-${String(rowNumber).padStart(4, "0")}`,
        name: normalizeText(row["Name"] || row["Company / Event name"]),
        date: parseDateString(row["Date"]),
        hours: normalizeText(row["Hours"]),
        branch: splitMulti(row["Branch"]).map(normalizeBranchValue).filter(Boolean),
        products: splitMulti(row["Product/s"]),
        status: normalizeText(row["Status"]),
        location: normalizeText(row["Location"]),
        paymentStatus: normalizeText(row["Payment Status"] || row["Payment"]),
        attendants: splitMulti(row["Attendant/s"]),
        exVat: turnoverExclVat || exVatAmount,
        packageOnly: normalizeText(row["Package Only"]),
        exclJc,
        notes: normalizeText(row["Notes"]),
      };
    })
    .filter((event) => event.name && event.date);
}

async function postBatch({ deploymentUrl, workspaceYear, monthNumber, events }) {
  const response = await fetch(`${deploymentUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Convex-Client": "codex-historic-import",
    },
    body: JSON.stringify({
      path: "imports:importHistoricMonthWorkbook",
      format: "convex_encoded_json",
      args: [{
        workspaceYear,
        monthNumber,
        events,
      }],
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(result));
  }
  return result;
}

async function run() {
  const root = path.resolve(requireArg("--root"));
  const deploymentUrl = optionalArg("--url", "https://api.events.selfiebox.co.za/convex");
  const dryRun = hasFlag("--dry-run");
  const batchSize = Number(optionalArg("--batch-size", "25"));

  const files = fs.readdirSync(root, { recursive: true })
    .filter((entry) => entry.toLowerCase().endsWith(".xlsx"))
    .map((entry) => path.join(root, entry))
    .sort((left, right) => left.localeCompare(right));

  const summary = [];

  for (const workbookPath of files) {
    const year = Number(path.basename(path.dirname(workbookPath)));
    const monthNumber = monthNumberFromFileName(path.basename(workbookPath));
    const workbook = parseWorkbook(workbookPath);
    const events = mapRowsToEvents(workbook.rows || [], year, monthNumber);
    summary.push({
      file: workbookPath,
      year,
      monthNumber,
      events: events.length,
    });

    if (dryRun) {
      continue;
    }

    for (let start = 0; start < events.length; start += batchSize) {
      const batch = events.slice(start, start + batchSize);
      const result = await postBatch({
        deploymentUrl,
        workspaceYear: year,
        monthNumber,
        events: batch,
      });
      process.stdout.write(`${JSON.stringify({ file: workbookPath, batchStart: start, result })}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({ mode: dryRun ? "dry-run" : "import", files: summary }, null, 2)}\n`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
