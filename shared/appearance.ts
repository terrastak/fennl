/**
 * Appearance options chosen in phase A4. The values match the data-* attributes that
 * app/styles/tokens.css reads on the <html> element.
 *
 * The color scheme is an account-level setting (it follows the user to every device).
 */
export const COLOR_SCHEMES = ["harbor", "heirloom"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const COLOR_MODES = ["light", "dark", "system"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const TEXT_SIZES = ["standard", "large", "larger", "largest"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const DEFAULT_COLOR_SCHEME: ColorScheme = "harbor";
export const DEFAULT_COLOR_MODE: ColorMode = "system";
export const DEFAULT_TEXT_SIZE: TextSize = "standard";

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === "string" && (COLOR_SCHEMES as readonly string[]).includes(value);
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (COLOR_MODES as readonly string[]).includes(value);
}
