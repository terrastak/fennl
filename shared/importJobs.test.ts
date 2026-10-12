import { describe, expect, it } from "vitest";
import { fetchableImageUrl, savedFromUrl } from "./importJobs";

describe("savedFromUrl", () => {
  it("reads the address Chrome and Edge record in a saved page", () => {
    expect(
      savedFromUrl(
        "<!DOCTYPE html>\n<!-- saved from url=(0038)https://cakes.example.com/sponge?x=1 -->\n<html>",
      ),
    ).toBe("https://cakes.example.com/sponge?x=1");
  });

  it("is null without one, or for anything but a web address", () => {
    expect(savedFromUrl("<html><head></head></html>")).toBeNull();
    expect(savedFromUrl("<!-- saved from url=(0014)about:internet -->")).toBeNull();
  });
});

describe("fetchableImageUrl", () => {
  const own = ["beta.fennl.example", "admin.fennl.example"];

  it("allows photos on the public web", () => {
    expect(fetchableImageUrl("https://images.example.com/cake.jpg?w=1200", own)?.href).toBe(
      "https://images.example.com/cake.jpg?w=1200",
    );
    expect(fetchableImageUrl("http://example.com/a.png", own)).not.toBeNull();
  });

  it.each([
    null,
    "not a url",
    "ftp://example.com/a.jpg",
    "data:image/png;base64,AAAA",
    "https://user:pass@example.com/a.jpg",
    "http://127.0.0.1/a.jpg",
    "http://10.0.0.1/a.jpg",
    "http://[::1]/a.jpg",
    "http://localhost/a.jpg",
    "http://intranet/a.jpg",
    "https://printer.local/a.jpg",
    "https://beta.fennl.example/api/images/abc",
    "https://admin.fennl.example/a.jpg",
    "https://x.beta.fennl.example/a.jpg",
  ])("refuses %s", (value) => {
    expect(fetchableImageUrl(value, own)).toBeNull();
  });
});
