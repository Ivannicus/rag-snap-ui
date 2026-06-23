import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const COLUMN_ALIASES: Record<string, string> = {
  question: "question",
  answer: "answer",
  source: "source",
  rfpdate: "rfpDate",
  date: "rfpDate",
};

const REQUIRED_FIELDS = ["question", "answer", "source", "rfpDate"] as const;

function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function splitCSVIntoRecords(raw: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && raw[i + 1] === "\n") i++;
      if (current.trim()) records.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) records.push(current);
  return records;
}

function parseCSV(raw: string): Record<string, string>[] {
  const records = splitCSVIntoRecords(raw);
  if (records.length < 2) {
    throw new Error("CSV must have a header row and at least one data row.");
  }

  const rawHeaders = splitCSVLine(records[0]);
  const headers = rawHeaders.map((h) => {
    const key = h.toLowerCase().replace(/[^a-z]/g, "");
    return COLUMN_ALIASES[key] ?? h;
  });

  const missing = REQUIRED_FIELDS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `Missing required columns: ${missing.join(", ")}\nFound columns: ${rawHeaders.join(", ")}`
    );
  }

  return records.slice(1).map((line) => {
    const values = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/import-rfp-data.ts <path-to-csv>");
    process.exit(1);
  }

  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    process.argv[3];
  if (!serviceAccountPath) {
    console.error(
      "Set GOOGLE_APPLICATION_CREDENTIALS env var or pass service account path as second argument."
    );
    process.exit(1);
  }

  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    console.error("Set NEXT_PUBLIC_FIREBASE_DATABASE_URL env var.");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf-8"));
  initializeApp({ credential: cert(serviceAccount), databaseURL });
  const db = getDatabase();

  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(raw);
  console.log(`Parsed ${rows.length} rows from CSV.`);

  const importedAt = Date.now();
  const records: Record<string, Record<string, string | number>> = {};

  for (const row of rows) {
    const key = db.ref("rfpDatabase").push().key!;
    records[key] = {
      question: row.question,
      answer: row.answer,
      source: row.source,
      rfpDate: row.rfpDate,
      importedAt,
    };
  }

  await db.ref("rfpDatabase").set(records);
  console.log(
    `Imported ${rows.length} records to /rfpDatabase (replaced existing data).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
