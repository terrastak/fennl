import { describe, expect, it } from "vitest";
import { draftContent, draftIssues, type RecipeDraft } from "./importDraft";
import { readWebRecipes, WEB_IMPORTER } from "./webRecipe";

// Phase E3: reading recipes from web pages' structured data. The pages here are small made-up
// ones showing what real sites do; the quality test set (import-quality/) has 31 real pages.

const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

const lines = (draft: RecipeDraft, key: "ingredients" | "directions") =>
  draftContent(draft)[key].map((l) => (l.heading ? `## ${l.text}` : l.text));

function only(html: string, url: string | null = "https://example.com/pie"): RecipeDraft {
  const drafts = readWebRecipes(html, url);
  expect(drafts).toHaveLength(1);
  const draft = drafts[0] as RecipeDraft;
  expect(draftIssues(draft)).toEqual([]);
  return draft;
}

describe("readWebRecipes", () => {
  it("reads a JSON-LD recipe, with references filled in", () => {
    const html = page(
      [
        '<meta property="og:site_name" content="Pie Kitchen">',
        '<link rel="canonical" href="https://example.com/recipes/apple-pie/">',
        ld({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Person", "@id": "#author", name: "June Baker" },
            {
              "@type": "Recipe",
              name: "Apple Pie Recipe",
              author: { "@id": "#author" },
              description: "A <strong>flaky</strong> pie.",
              recipeYield: ["8", "1 pie"],
              prepTime: "PT30M",
              cookTime: "PT1H",
              totalTime: "PT1H30M",
              recipeIngredient: ["2 &frac12; cups flour", "6 apples"],
              recipeInstructions: [
                { "@type": "HowToStep", name: "Step 1", text: "Make the dough." },
                { "@type": "HowToStep", text: "Fill and bake." },
              ],
              suitableForDiet: "https://schema.org/VegetarianDiet",
              nutrition: { "@type": "NutritionInformation", calories: "410 kcal" },
            },
          ],
        }),
      ].join(""),
    );
    const draft = only(html);
    const content = draftContent(draft);
    expect(content.title).toBe("Apple Pie");
    expect(content.description).toBe("A flaky pie.");
    expect(lines(draft, "ingredients")).toEqual(["2 ½ cups flour", "6 apples"]);
    expect(lines(draft, "directions")).toEqual(["Make the dough.", "Fill and bake."]);
    expect(content.times).toEqual({
      prep: { minutes: 30, text: null },
      cook: { minutes: 60, text: null },
      total: { minutes: 90, text: null },
    });
    expect(content.servings).toEqual({ count: 8, yield: "1 pie" });
    expect(content.source).toEqual({
      kind: "website",
      name: "Pie Kitchen",
      url: "https://example.com/recipes/apple-pie/",
      author: "June Baker",
      page: null,
    });
    expect(content.nutrition?.perServing).toEqual({ calories: 410 });
    expect(draft.categories?.value).toEqual(["Diet › Vegetarian"]);
    expect(draft.categories?.confidence).toBe("high");
    expect(draft.source).toBe("website");
    expect(draft.externalId).toBe("https://example.com/recipes/apple-pie/");
    expect(draft.producer).toEqual({ importer: WEB_IMPORTER, model: null });
    expect(draft.fields.title?.from).toEqual([
      { kind: "structured_data", input: 0, detail: "name" },
    ]);
  });

  it("keeps the data's own sections and puts a step's name before it", () => {
    const html = page(
      ld({
        "@type": "Recipe",
        name: "Coconut Cream Pie",
        recipeIngredient: ["For the crust:", "1 cup crumbs", "--- Filling ---", "2 cups milk"],
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "Crust",
            itemListElement: [{ "@type": "HowToStep", text: "Press crumbs into a pan." }],
          },
          { "@type": "HowToStep", name: "Make the filling", text: "Heat the milk." },
        ],
      }),
    );
    const draft = only(html);
    expect(lines(draft, "ingredients")).toEqual([
      "## For the crust:",
      "1 cup crumbs",
      "## Filling",
      "2 cups milk",
    ]);
    expect(lines(draft, "directions")).toEqual([
      "## Crust",
      "Press crumbs into a pan.",
      "Make the filling: Heat the milk.",
    ]);
  });

  it("splits directions given as one string, and tidies what magazines add", () => {
    const html = page(
      ld({
        "@type": "Recipe",
        name: "Shortbread",
        recipeIngredient: ["1 cup butter", "2 cups flour"],
        recipeInstructions:
          "1. Cream the butter. 2. Add the flour. Do Ahead: Dough keeps 3 days. Editor’s note: This recipe was first published in 2012.",
      }),
    );
    expect(lines(only(html), "directions")).toEqual([
      "Cream the butter.",
      "Add the flour.",
      "Do Ahead: Dough keeps 3 days.",
    ]);
    // A number ending a sentence inside a step isn't a new step.
    const one = page(
      ld({
        "@type": "Recipe",
        name: "Lasagne",
        recipeInstructions: [
          { "@type": "HowToStep", text: "Repeat with layer 1. Then add the rest." },
        ],
      }),
    );
    expect(lines(only(one), "directions")).toEqual(["Repeat with layer 1. Then add the rest."]);
    // Two steps run together in the data, the second still numbered.
    const joined = page(
      ld({
        "@type": "Recipe",
        name: "Sheet Pan Chicken",
        recipeInstructions: [
          { "@type": "HowToStep", text: "Roast the chicken." },
          { "@type": "HowToStep", text: "Rest it 10 minutes. 3. Toss the salad." },
        ],
      }),
    );
    expect(lines(only(joined), "directions")).toEqual([
      "Roast the chicken.",
      "Rest it 10 minutes.",
      "Toss the salad.",
    ]);
  });

  it("puts back the section headings and fuller wording the page shows", () => {
    const html = page(
      ld({
        "@type": "Recipe",
        name: "Cinnamon Rolls",
        recipeIngredient: [
          "1 cup whole milk",
          "4 cups flour",
          "1/2 c. brown sugar",
          "2 tsp cinnamon",
        ],
        recipeInstructions: ["Make the dough.", "Fill and roll."],
      }),
      `<p>1 cup whole milk is the secret, says the story above the recipe.</p>
       <div class="wprm-recipe-container">
         <h3>Ingredients</h3>
         <div class="wprm-recipe-ingredient-group">
           <h4 class="wprm-recipe-group-name">For the dough</h4>
           <ul>
             <li><span class="wprm-checkbox sr-only">▢</span>1 cup (236 ml) whole milk</li>
             <li>4 cups flour</li>
           </ul>
         </div>
         <div class="cart" style="display: none"><h4>Cart Error</h4></div>
         <div class="wprm-recipe-ingredient-group">
           <h4 class="wprm-recipe-group-name">For the filling</h4>
           <ul><li>1/2 cup brown sugar</li><li>2 tsp cinnamon</li></ul>
         </div>
         <h3>Instructions</h3>
         <ol><li><strong>Step 1</strong> Make the dough.</li><li>Fill and roll.</li></ol>
         <div class="wprm-recipe-notes">Notes<br>Use whole milk.<br>Rolls freeze well.</div>
       </div>`,
    );
    const draft = only(html);
    expect(lines(draft, "ingredients")).toEqual([
      "## For the dough",
      "1 cup (236 ml) whole milk",
      "4 cups flour",
      "## For the filling",
      "1/2 cup brown sugar",
      "2 tsp cinnamon",
    ]);
    expect(lines(draft, "directions")).toEqual(["Make the dough.", "Fill and roll."]);
    expect(draft.lineConfidence.ingredients).toEqual([
      "medium",
      "high",
      "high",
      "medium",
      "high",
      "high",
    ]);
    expect(draft.fields.ingredients?.from.map((e) => e.kind)).toEqual([
      "structured_data",
      "page_text",
    ]);
    expect(draftContent(draft).notes).toBe("Use whole milk.\nRolls freeze well.");
  });

  it("reads a microdata recipe", () => {
    const html = page(
      "<title>Mughlai Chicken | Nigella</title>",
      `<div itemscope itemtype="https://schema.org/Recipe">
         <h1 itemprop="name">Mughlai Chicken</h1>
         <span itemprop="author">Nigella</span>
         <p>Some words about the dish, not part of the recipe.</p>
         <span itemprop="recipeYield">Serves: 8-10</span>
         <meta itemprop="totalTime" content="PT2H">
         <ul><li itemprop="recipeIngredient">2 onions</li><li itemprop="recipeIngredient">4 cloves</li></ul>
         <ol itemprop="recipeInstructions"><li>Fry the onions.</li><li>Add the cloves.</li></ol>
         <img itemprop="image" src="/images/mughlai.jpg">
       </div>`,
    );
    const draft = only(html, "https://www.nigella.com/recipes/mughlai-chicken");
    const content = draftContent(draft);
    expect(content.title).toBe("Mughlai Chicken");
    expect(lines(draft, "ingredients")).toEqual(["2 onions", "4 cloves"]);
    expect(lines(draft, "directions")).toEqual(["Fry the onions.", "Add the cloves."]);
    expect(content.servings).toEqual({ count: 8, yield: "Serves: 8-10" });
    expect(content.times.total).toEqual({ minutes: 120, text: null });
    expect(content.source.author).toBe("Nigella");
    expect(content.source.name).toBe("nigella.com");
    expect(draft.inputs[1]?.url).toBe("https://www.nigella.com/images/mughlai.jpg");
    expect(draft.fields.title?.from[0]?.detail).toBe("microdata name");
  });

  it("gives a draft for each recipe on the page, and none for a page without one", () => {
    const two = page(
      ld([
        { "@type": "Recipe", name: "Pancakes", recipeIngredient: ["1 egg"] },
        { "@type": "Recipe", name: "Syrup", recipeIngredient: ["1 cup sugar"] },
        { "@type": "Recipe", name: "Pancakes", recipeIngredient: ["1 egg"] },
      ]),
    );
    expect(readWebRecipes(two, null).map((d) => draftContent(d).title)).toEqual([
      "Pancakes",
      "Syrup",
    ]);
    expect(readWebRecipes(page(ld({ "@type": "Article", headline: "Our week" })), null)).toEqual(
      [],
    );
    expect(readWebRecipes("<p>Just a story about soup.</p>", null)).toEqual([]);
    expect(readWebRecipes("", null)).toEqual([]);
  });

  it("warns when the data has no ingredients or directions", () => {
    const draft = only(page(ld({ "@type": "Recipe", name: "Mystery" })));
    expect(draft.warnings).toEqual([
      "The page's recipe data has no ingredients.",
      "The page's recipe data has no directions.",
    ]);
  });

  it("reads JSON-LD that isn't quite JSON", () => {
    const html = page(
      `<script type="application/ld+json"><!--
        {"@type": "Recipe", "name": "Tea", "recipeIngredient": ["1 tea bag",],
         "recipeInstructions": "Steep
         for 3 minutes."}
      --></script>`,
    );
    expect(lines(only(html), "directions")).toEqual(["Steep for 3 minutes."]);
  });

  it("drops a site's stock description", () => {
    const html = page(
      ld({
        "@type": "Recipe",
        name: "Honey Mustard Sauce",
        description: "Make and share this Honey Mustard Sauce recipe from Food.com.",
      }),
    );
    expect(only(html).fields.description).toBeUndefined();
  });
});
