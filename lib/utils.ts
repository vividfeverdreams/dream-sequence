import { clsx, type ClassValue } from "clsx";
import { createHash } from "crypto";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function slugifyCode(input: string, maxLength = 18) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, maxLength)
    .replace(/(^-|-$)/g, "");
}

export function createSessionCode(base: string) {
  const slug = slugifyCode(base, 18) || "show";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
}

export function normalizePromptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function splitList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatRelativeTime(dateLike: Date | string) {
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  const diff = Date.now() - date.getTime();
  const seconds = Math.round(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
