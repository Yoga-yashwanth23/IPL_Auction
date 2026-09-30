import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Canonical money unit across the whole app is ₹ Lakh (matches the existing
 * `purse_total`/`base_price` columns, e.g. 10000 = ₹100 Cr, 50 = ₹50 L).
 * Display auto-picks the natural unit: ≥100 L shows as Cr, below that as L.
 */
const LAKHS_PER_CRORE = 100;

/** Format a money amount (stored in ₹ Lakh) as "₹100 Cr" or "₹50 L", whichever reads naturally. */
export function formatCr(amountInLakh: number): string {
  if (amountInLakh == null || Number.isNaN(amountInLakh)) return "—";
  if (amountInLakh >= LAKHS_PER_CRORE) {
    return `₹${(amountInLakh / LAKHS_PER_CRORE).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  }
  return `₹${amountInLakh.toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
}

/**
 * Bid increment brackets (all amounts in ₹ Lakh, matching the app's canonical unit):
 *   Up to ₹1 Cr (100L)        → ₹5 L
 *   ₹1 Cr – ₹2 Cr (100-200L)  → ₹10 L
 *   ₹2 Cr – ₹5 Cr (200-500L)  → ₹25 L
 *   ₹5 Cr – ₹10 Cr (500-1000L)→ ₹50 L
 *   ₹10 Cr – ₹20 Cr           → ₹1 Cr
 *   Above ₹20 Cr              → ₹2 Cr
 * `currentAmount` is the current bid (or the base price, before any bid is placed).
 */
export function getBidIncrement(currentAmount: number): number {
  if (currentAmount < 100) return 5; // ₹5 L
  if (currentAmount < 200) return 10; // ₹10 L
  if (currentAmount < 500) return 25; // ₹25 L
  if (currentAmount < 1000) return 50; // ₹50 L
  if (currentAmount < 2000) return 100; // ₹1 Cr
  return 200; // ₹2 Cr
}

/** Normalize a name/filename for fuzzy matching: lowercase, strip separators & special chars. */
export function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/\.[a-z0-9]+$/i, "") // strip file extension
    .replace(/[\s\-_]+/g, "") // collapse spaces/hyphens/underscores
    .replace(/[^a-z0-9]/g, ""); // strip everything else
}
