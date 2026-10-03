import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, parseAppearance } from "../../shared/appearance";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  loadAppearance,
  saveAppearance,
} from "./appearance";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

/** Just enough of an element for applyAppearance: attribute setters over a plain object. */
function fakeRoot() {
  const attributes: Record<string, string> = {};
  return {
    attributes,
    setAttribute: (name: string, value: string) => void (attributes[name] = value),
    removeAttribute: (name: string) => void Reflect.deleteProperty(attributes, name),
  };
}

describe("appearance", () => {
  it("uses defaults when nothing is stored, or storage is broken", () => {
    expect(loadAppearance(memoryStorage())).toEqual(DEFAULT_APPEARANCE);
    expect(loadAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: "{not json" }))).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it("ignores unknown values and keeps valid ones", () => {
    expect(parseAppearance({ scheme: "heirloom", mode: "purple", textSize: "larger" })).toEqual({
      scheme: "heirloom",
      mode: "system",
      textSize: "larger",
    });
    expect(parseAppearance("heirloom")).toEqual(DEFAULT_APPEARANCE);
  });

  it("saves and loads a choice", () => {
    const storage = memoryStorage();
    const choice = { scheme: "heirloom", mode: "dark", textSize: "large" } as const;
    saveAppearance(storage, choice);
    expect(loadAppearance(storage)).toEqual(choice);
  });

  it("sets data attributes for non-default choices and removes them for defaults", () => {
    const root = fakeRoot();
    applyAppearance(root, { scheme: "heirloom", mode: "dark", textSize: "largest" });
    expect(root.attributes).toEqual({
      "data-scheme": "heirloom",
      "data-mode": "dark",
      "data-text-size": "largest",
    });
    applyAppearance(root, DEFAULT_APPEARANCE);
    expect(root.attributes).toEqual({});
  });
});
