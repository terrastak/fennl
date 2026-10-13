import { describe, expect, it } from "vitest";
import { PAGE_TEXT_CHARS, pageForAi } from "./pageText";

// Phase E8: a page without recipe data, made ready for the AI to read.

const BLOG = `<!DOCTYPE html><html><head>
<title>Grandma's Pound Cake | Kitchen Notes</title>
<meta property="og:title" content="Grandma's Pound Cake">
<meta property="og:site_name" content="Kitchen Notes">
<meta property="og:image" content="/photos/pound-cake.jpg">
<script>trackEverything()</script><style>body{}</style>
</head><body>
<header class="site-header"><nav><a href="/">Home</a> <a href="/recipes">Recipes</a></nav></header>
<div class="ad-slot">Buy our pans!</div>
<main>
  <article class="post">
    <h1>Grandma's Pound Cake</h1>
    <p>This cake has been in our family for <em>four</em> generations.</p>
    <img src="/photos/slice.jpg" width="800" height="600" alt="A slice">
    <img src="/icons/pin.png" width="24" height="24" alt="Pin it">
    <img data-src="https://cdn.example.com/lazy.jpg" src="data:image/gif;base64,R0lGOD" alt="">
    <div class="share-buttons">Share on Facebook</div>
    <h2>Ingredients</h2>
    <ul><li>1 cup butter</li><li>2 cups sugar</li><li>5 eggs</li></ul>
    <h2>Directions</h2>
    <ol><li>Cream the butter and sugar.</li><li>Bake at 325°F for 75 minutes.</li></ol>
    <table><tr><td>Prep</td><td>20 min</td></tr></table>
    <div class="newsletter-signup">Get recipes by email</div>
    <p hidden>Hidden text</p>
  </article>
  <section id="comments"><p>Looks great! Can I use margarine?</p></section>
</main>
<aside class="sidebar">Popular posts</aside>
<footer>© Kitchen Notes</footer>
</body></html>`;

describe("a page for the AI", () => {
  const page = pageForAi(BLOG, "https://kitchen.example.com/pound-cake");

  it("keeps the article's text, with headings and lists", () => {
    expect(page.text).toBe(
      [
        "## Grandma's Pound Cake",
        "This cake has been in our family for four generations.",
        "## Ingredients",
        "- 1 cup butter",
        "- 2 cups sugar",
        "- 5 eggs",
        "## Directions",
        "- Cream the butter and sugar.",
        "- Bake at 325°F for 75 minutes.",
        "Prep | 20 min |",
      ].join("\n"),
    );
    expect(page.cut).toBe(false);
  });

  it("leaves out menus, adverts, share buttons, comments, hidden text and scripts", () => {
    for (const gone of [
      "Home",
      "Buy our pans",
      "Share on Facebook",
      "margarine",
      "Get recipes by email",
      "Hidden text",
      "Popular posts",
      "Kitchen Notes",
      "trackEverything",
    ]) {
      expect(page.text, gone).not.toContain(gone);
      expect(page.snapshot, gone).not.toContain(gone);
    }
  });

  it("names the page and site, and picks the sharing image and article photos, not icons", () => {
    expect(page.title).toBe("Grandma's Pound Cake");
    expect(page.site).toBe("Kitchen Notes");
    expect(page.photos).toEqual([
      "https://kitchen.example.com/photos/pound-cake.jpg",
      "https://kitchen.example.com/photos/slice.jpg",
      "https://cdn.example.com/lazy.jpg",
    ]);
  });

  it("keeps a copy of the article that can't run anything", () => {
    expect(page.snapshot).toContain("1 cup butter");
    expect(page.snapshot).not.toMatch(/<script|<img[^>]*src|onerror/i);
  });

  it("reads the whole body when nothing marks the article, without its header and footer", () => {
    const plain = pageForAi(
      "<html><head><title>Lemonade</title></head><body><header>My Blog</header><h1>Lemonade</h1><p>Squeeze 4 lemons.</p><footer>Bye</footer></body></html>",
      null,
    );
    expect(plain.title).toBe("Lemonade");
    expect(plain.text).toBe("## Lemonade\nSqueeze 4 lemons.");
    expect(plain.photos).toEqual([]);
  });

  it("picks the longest article on a page of several", () => {
    const listing = pageForAi(
      "<body><article><p>Short teaser</p></article><article><h1>Soup</h1><p>A long recipe for soup, with stock and onions and time.</p></article></body>",
      null,
    );
    expect(listing.text).toContain("Soup");
    expect(listing.text).not.toContain("Short teaser");
  });

  it("never leaves out most of the article for a class name", () => {
    // A real site (nigella.com) wraps its whole recipe in "fixed-ad-container".
    const page = pageForAi(
      `<main><h1>Mughlai Chicken</h1><div class="fixed-ad-container"><ul><li>2 onions</li><li>8 chicken thighs</li></ul><p>Fry the onions until soft and golden.</p><div class="ad">Buy now</div></div></main>`,
      null,
    );
    expect(page.text).toContain("- 8 chicken thighs");
    expect(page.text).not.toContain("Buy now");
  });

  it("caps very long pages", () => {
    const long = pageForAi(`<main><p>${"word ".repeat(PAGE_TEXT_CHARS)}</p></main>`, null);
    expect(long.text).toHaveLength(PAGE_TEXT_CHARS);
    expect(long.cut).toBe(true);
  });
});
