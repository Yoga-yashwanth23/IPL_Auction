import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { DatasetError, ParsedDataset, RawPlayerRecord } from "@/types";

const REQUIRED_FIELDS = ["player_id", "name", "country", "role", "base_price"] as const;

function coerceRecord(raw: Record<string, unknown>, rowIndex: number, errors: DatasetError[]): RawPlayerRecord {
  // Normalize header casing/whitespace: "Player Id" / "PLAYER_ID" / " player_id " all map to player_id.
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, "_");
    normalized[cleanKey] = typeof value === "string" ? value.trim() : value;
  }

  for (const field of REQUIRED_FIELDS) {
    const value = normalized[field];
    if (value === undefined || value === null || value === "") {
      errors.push({ rowIndex, message: `Missing required field "${field}"` });
    }
  }

  if (normalized.base_price !== undefined && normalized.base_price !== "") {
    const asNumber = Number(normalized.base_price);
    if (Number.isNaN(asNumber)) {
      errors.push({ rowIndex, message: `base_price "${normalized.base_price}" is not a number` });
    } else {
      normalized.base_price = asNumber;
    }
  }

  if (normalized.age !== undefined && normalized.age !== "") {
    const asAge = Number(normalized.age);
    if (!Number.isNaN(asAge)) normalized.age = asAge;
  }

  // is_marquee arrives as TRUE/FALSE, true/false, 1/0, yes/no, or already boolean — normalize once here.
  if (normalized.is_marquee !== undefined && normalized.is_marquee !== "") {
    const raw = normalized.is_marquee;
    normalized.is_marquee =
      typeof raw === "boolean" ? raw : ["true", "1", "yes"].includes(String(raw).trim().toLowerCase());
  } else {
    normalized.is_marquee = false;
  }

  return normalized as RawPlayerRecord;
}

async function parseCsv(file: File): Promise<ParsedDataset> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: DatasetError[] = [];
        const records = results.data.map((row, i) => coerceRecord(row, i, errors));
        results.errors.forEach((e) =>
          errors.push({ rowIndex: e.row ?? -1, message: e.message })
        );
        resolve({ records, errors, sourceFileName: file.name });
      },
      error: (err) => {
        resolve({
          records: [],
          errors: [{ rowIndex: -1, message: err.message }],
          sourceFileName: file.name,
        });
      },
    });
  });
}

async function parseExcel(file: File): Promise<ParsedDataset> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const errors: DatasetError[] = [];
  const records = rows.map((row, i) => coerceRecord(row, i, errors));
  return { records, errors, sourceFileName: file.name };
}

async function parseJson(file: File): Promise<ParsedDataset> {
  const text = await file.text();
  const errors: DatasetError[] = [];
  try {
    const data = JSON.parse(text);
    const rows: Record<string, unknown>[] = Array.isArray(data) ? data : data.players ?? data.records ?? [];
    if (!Array.isArray(rows)) {
      errors.push({ rowIndex: -1, message: "JSON must be an array of player objects (or {\"players\": [...]})" });
      return { records: [], errors, sourceFileName: file.name };
    }
    const records = rows.map((row, i) => coerceRecord(row, i, errors));
    return { records, errors, sourceFileName: file.name };
  } catch (e) {
    errors.push({ rowIndex: -1, message: `Invalid JSON: ${(e as Error).message}` });
    return { records: [], errors, sourceFileName: file.name };
  }
}

/** Parses a player dataset file (CSV, XLSX/XLS, or JSON) into normalized records. */
export async function parseDatasetFile(file: File): Promise<ParsedDataset> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") return parseCsv(file);
  if (ext === "xlsx" || ext === "xls") return parseExcel(file);
  if (ext === "json") return parseJson(file);

  return {
    records: [],
    errors: [{ rowIndex: -1, message: `Unsupported file type ".${ext}". Use CSV, XLSX, or JSON.` }],
    sourceFileName: file.name,
  };
}
