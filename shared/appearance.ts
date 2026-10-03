/**
 * Appearance options chosen in phase A4. The values match the data-* attributes that
 * app/styles/tokens.css reads on the <html> element.
 *
 * The color scheme (and light/dark choice) are account-level settings: once accounts exist
 * (Stage B) they are stored with the user and follow them to every device. Text size stays
 * per device, because screens differ.
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

export interface Appearance {
  scheme: ColorScheme;
  mode: ColorMode;
  textSize: TextSize;
}

export const DEFAULT_APPEARANCE: Appearance = {
  scheme: DEFAULT_COLOR_SCHEME,
  mode: DEFAULT_COLOR_MODE,
  textSize: DEFAULT_TEXT_SIZE,
};

/**
 * Light-mode colors for the scheme picker's small previews. They must match tokens.css
 * (tokens.test.ts checks this).
 */
export const SCHEME_PREVIEW: Record<
  ColorScheme,
  { bg: string; surface: string; accent: string; onAccent: string; hand: string; text: string }
> = {
  harbor: {
    bg: "#f6f5f0",
    surface: "#ffffff",
    accent: "#24406b",
    onAccent: "#ffffff",
    hand: "#a8432b",
    text: "#1d211e",
  },
  heirloom: {
    bg: "#f5efe4",
    surface: "#fffaf1",
    accent: "#4f5d2f",
    onAccent: "#fffaf1",
    hand: "#9a3b4f",
    text: "#2a2320",
  },
};

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === "string" && (COLOR_SCHEMES as readonly string[]).includes(value);
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (COLOR_MODES as readonly string[]).includes(value);
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && (TEXT_SIZES as readonly string[]).includes(value);
}

/** Turns anything (for example a stored JSON value) into a valid Appearance, using defaults for gaps. */
export function parseAppearance(value: unknown): Appearance {
  const obj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    scheme: isColorScheme(obj.scheme) ? obj.scheme : DEFAULT_COLOR_SCHEME,
    mode: isColorMode(obj.mode) ? obj.mode : DEFAULT_COLOR_MODE,
    textSize: isTextSize(obj.textSize) ? obj.textSize : DEFAULT_TEXT_SIZE,
  };
}
