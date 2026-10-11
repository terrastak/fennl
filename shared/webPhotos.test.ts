import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import { absoluteUrl, recipePhotos } from "./webPhotos";

// Phase E3: the photos a recipe page offers, each counted once in its largest size.

const doc = (head = "") => parseDocument(`<html><head>${head}</head><body></body></html>`);

describe("recipePhotos", () => {
  it("keeps the original of a photo given in several sizes", () => {
    const image = [
      "https://site.com/wp-content/uploads/2021/09/rolls.jpg",
      "https://site.com/wp-content/uploads/2021/09/rolls-500x500.jpg",
      "https://site.com/wp-content/uploads/2021/09/rolls-480x270.jpg",
    ];
    expect(recipePhotos({ image }, doc(), null)).toEqual([
      "https://site.com/wp-content/uploads/2021/09/rolls.jpg",
    ]);
  });

  it("keeps the widest crop when sizes are given", () => {
    const image = [
      {
        "@type": "ImageObject",
        url: "https://cdn.com/photos/abc/16:9/w_2000/pie.jpg",
        width: 2000,
      },
      { "@type": "ImageObject", url: "https://cdn.com/photos/abc/1:1/w_960/pie.jpg", width: 960 },
    ];
    expect(recipePhotos({ image }, doc(), null)).toEqual([
      "https://cdn.com/photos/abc/16:9/w_2000/pie.jpg",
    ]);
  });

  it("counts a folder of one photo's sizes as one photo", () => {
    const base = "https://static.com/images/2023/cake-ab12/cake-ab12";
    const image = [
      { url: `${base}-superJumbo.jpg`, width: 2048 },
      { url: `${base}-mediumSquareAt3X.jpg`, width: 1800 },
    ];
    const head = `<meta property="og:image" content="${base}-facebookJumbo.jpg">`;
    expect(recipePhotos({ image }, doc(head), null)).toEqual([`${base}-superJumbo.jpg`]);
  });

  it("keeps up to three different photos, the recipe's own first", () => {
    const image = ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"];
    const head = '<meta property="og:image" content="https://site.com/share.jpg">';
    expect(recipePhotos({ image }, doc(head), "https://site.com/recipe/")).toEqual([
      "https://site.com/a.jpg",
      "https://site.com/b.jpg",
      "https://site.com/c.jpg",
    ]);
  });

  it("uses the sharing image when the recipe has none, and skips placeholders", () => {
    const head = '<meta property="og:image" content="https://site.com/share.jpg">';
    expect(
      recipePhotos({ image: "https://cdn.com/Recipe_placeholder_mobile.png" }, doc(head), null),
    ).toEqual(["https://site.com/share.jpg"]);
  });
});

describe("absoluteUrl", () => {
  it("resolves addresses against the page, and refuses anything but http(s)", () => {
    expect(absoluteUrl("//mojo.com/a.jpeg", null)).toBe("https://mojo.com/a.jpeg");
    expect(absoluteUrl("/a.jpg", "https://site.com/x/")).toBe("https://site.com/a.jpg");
    expect(absoluteUrl("data:image/png;base64,AAAA", null)).toBeNull();
    expect(absoluteUrl("javascript:alert(1)", "https://site.com/")).toBeNull();
    expect(absoluteUrl("", null)).toBeNull();
  });
});
