import type { Entitlements } from "../../shared/entitlements";

/** "3 MB", "2 GB", "256 KB": sizes as people say them (1 MB = 1024 KB). */
export function formatBytes(bytes: number): string {
  const units = [
    { size: 1024 ** 3, name: "GB" },
    { size: 1024 ** 2, name: "MB" },
    { size: 1024, name: "KB" },
  ];
  for (const unit of units) {
    if (bytes >= unit.size) {
      const value = bytes / unit.size;
      return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit.name}`;
    }
  }
  return `${bytes} bytes`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** The plan's name, as shown on the Account page. */
export function planName(e: Entitlements): string {
  if (e.tier === "free") return "Free";
  const kind = e.tier === "household" ? "Household" : "Individual";
  if (e.trialing) return `Premium ${kind} (trial)`;
  return `Premium ${kind}`;
}

/** A sentence about the plan's state, when there's something to say. */
export function planStatus(e: Entitlements): string | null {
  if (e.past_due)
    return "Your last payment didn't go through. We'll try again; nothing changes meanwhile.";
  if (e.ends_at && e.source === "promo_code")
    return `Included with your code until ${formatDate(e.ends_at)}. After that you're on Free, and nothing is deleted.`;
  if (e.ends_at) return `Premium until ${formatDate(e.ends_at)}, then Free. Nothing is deleted.`;
  return null;
}

/** What the plan includes, as label and value pairs. */
export function planDetails(e: Entitlements): { label: string; value: string }[] {
  return [
    {
      label: "Recipes",
      value: e.max_recipes === null ? "Unlimited" : `Up to ${e.max_recipes}`,
    },
    {
      label: "Recipe text",
      value:
        e.max_text_bytes === null ? "Unlimited" : `Up to ${formatBytes(e.max_text_bytes)} in total`,
    },
    {
      label: "Devices",
      value:
        e.max_devices === null
          ? "Unlimited"
          : e.max_devices === 1
            ? "One at a time"
            : `Up to ${e.max_devices}, in sync`,
    },
    { label: "Household", value: e.max_members > 1 ? `Up to ${e.max_members} people` : "Just you" },
    {
      label: "Photos",
      value: !e.images_enabled
        ? "Not included"
        : e.image_quota_bytes === null
          ? "Included"
          : `Up to ${formatBytes(e.image_quota_bytes)}`,
    },
    {
      label: "Import",
      value: e.import_ai_enabled
        ? "Paprika, web pages, photos, PDFs and handwritten cards"
        : "Paprika files and recipe web pages (text only)",
    },
  ];
}
