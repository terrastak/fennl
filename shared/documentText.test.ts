import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { documentKind, documentText, docxText, plainText, rtfText } from "./documentText";

// Phase E18: a document's text, taken out on the device, from the owner's own examples
// (test-docs/) and small files made here.

const doc = async (name: string) =>
  new Uint8Array(await readFile(join(import.meta.dirname, "..", "test-docs", name)));

describe("which files are documents", () => {
  it("knows Word, Rich Text, text and Markdown, and the ones it can't read", () => {
    expect(documentKind("Cookies.DOCX")).toBe("docx");
    expect(documentKind("sauce.rtf")).toBe("rtf");
    expect(documentKind("notes.txt")).toBe("txt");
    expect(documentKind("README.md")).toBe("md");
    expect(documentKind("old.doc")).toBe("doc");
    expect(documentKind("menu.pages")).toBe("pages");
    expect(documentKind("menu.odt")).toBe("odt");
    expect(documentKind("photo.jpg")).toBeNull();
  });
});

describe("the owner's documents", () => {
  it("reads a Word file's text and its picture", async () => {
    const { text, pictures } = documentText(
      "docx",
      await doc("Cranberry Oatmeal Chocolate Christmas Cookies.docx"),
    );
    expect(text.split("\n")[0]).toBe("Oatmeal Cranberry Chocolate Christmas Cookies");
    expect(text).toContain("1 stick + 6T butter, softened");
    expect(text).toContain(
      "3. Combine flour, baking soda, cinnamon, salt; add to wet ingredients.",
    );
    expect(pictures.map((p) => p.name)).toEqual(["image1.png"]);
  });

  it("reads a Word file with no pictures", async () => {
    const { text, pictures } = documentText(
      "docx",
      await doc("Prime Rib - SPICY RIB EYE BEEF ROAST.docx"),
    );
    expect(text).toContain("1/3 - 1/2 C.  Coarse or cracked pepper (I used cracked)");
    expect(text).toContain("Combine pepper & cardamom.");
    expect(text.trim().split("\n").at(-1)).toBe(
      "I once used 7 lb roast for 10. Had some leftovers.",
    );
    expect(pictures).toEqual([]);
  });

  it("reads a Rich Text file from TextEdit, its list markers and formatting left out", async () => {
    const { text } = documentText("rtf", await doc("Beercheese sauce.rtf"));
    expect(text.split("\n")).toEqual([
      "Beer Cheese Sauce:",
      "4 tablespoons unsalted butter",
      "1 small onion, finely chopped",
      "4 tablespoons all-purpose flour",
      "2 cups light beer, such as lager",
      "1 1/2 cups heavy cream",
      "1 clove garlic, grated",
      "Kosher salt and freshly ground black pepper",
      "6 ounces grated sharp Cheddar",
      "6 ounces grated Swiss cheese",
    ]);
  });

  it("reads a text file", async () => {
    const { text } = documentText("txt", await doc("KFC Fried Chicken Recipe.txt"));
    expect(text.split("\n").slice(0, 2)).toEqual([
      "KFC Fried chicken",
      "http://www.chicagotribune.com/dining/recipes/ct-kfc-recipe-test-20160818-story.html",
    ]);
  });
});

describe("files made here", () => {
  it("turns Word headings and lists into lines Fennl's reader knows", () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Tea &amp; Scones</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">2 cups </w:t></w:r><w:r><w:t>flour</w:t></w:r></w:p>
      <w:p><w:r><w:t>Bake</w:t></w:r><w:r><w:tab/><w:t>12 min</w:t><w:br/><w:t>Cool.</w:t></w:r></w:p>
      <w:p/>
    </w:body></w:document>`;
    const file = zipSync({ "word/document.xml": strToU8(xml) });
    expect(docxText(file).text).toBe("## Tea & Scones\n- 2 cups flour\nBake\t12 min\nCool.");
  });

  it("turns away a file that isn't a Word document", () => {
    expect(() => docxText(strToU8("not a zip"))).toThrow("not_a_document");
    expect(() => docxText(zipSync({ "hello.txt": strToU8("hi") }))).toThrow("not_a_document");
    expect(() => rtfText("plain text")).toThrow("not_a_document");
  });

  it("reads Rich Text accents, Unicode characters and paragraphs", () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl\f0 Helvetica;}{\*\generator Word}\f0 Cr\'e8me br\u251\'3flée\par 2\tab eggs\line Bake}`;
    expect(rtfText(rtf)).toBe("Crème brûlée\n2\teggs\nBake");
  });

  it("reads text in UTF-8, UTF-16 or Windows' encoding", () => {
    expect(plainText(new TextEncoder().encode("Crème\r\nbrûlée"))).toBe("Crème\nbrûlée");
    expect(plainText(Uint8Array.from([0x43, 0x72, 0xe8, 0x6d, 0x65]))).toBe("Crème");
    expect(plainText(Uint8Array.from([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]))).toBe("Hi");
  });
});
