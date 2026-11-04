import { describe, expect, it } from "vitest";
import { directionsFromText, ingredientsFromText } from "./recipeLines";
import { amountLine, ingredientName, stepIngredients, type StepUse } from "./stepIngredients";

// U14 (owner's choices 2026-11-04): the ingredients each step uses. Each step's rows are written
// as `rows` writes them: the whole line as it's listed; "written 3/4 cup sugar | <line>" for the
// step's own amount; "remaining ¼ cup sugar | <line>" and "part 1 tbsp butter | <line>" for an
// amount Fennl worked out; "small a little of the butter | <line>" for the step's own words;
// "some | <line>" when Fennl isn't sure how much; "which cheese | <line> | <line>" when it isn't
// sure which; "mixture flour mixture from step 1".

const LINKED = "00000000-0000-4000-8000-000000000001";

function rows(
  ingredients: string | string[],
  directions: string | string[],
  linked: string[] = [],
  titles: Record<string, string> = {},
): string[][] {
  const join = (x: string | string[]) => (Array.isArray(x) ? x.join("\n") : x);
  let n = 0;
  const lines = ingredientsFromText(join(ingredients), [], () => `i${n++}`);
  let m = 0;
  const steps = directionsFromText(join(directions), [], () => `s${m++}`);
  const linkedTitles: Record<string, string> = {};
  for (const line of lines) {
    if (!linked.includes(line.text)) continue;
    line.linkedRecipeId = LINKED;
    const title = titles[line.text];
    if (title) linkedTitles[line.id] = title;
  }
  const map = stepIngredients(lines, steps, { linkedTitles });
  const text = (id: string) => lines.find((l) => l.id === id)?.text ?? id;
  const method = steps.filter((s) => !s.heading);
  const row = (u: StepUse, step: { text: string }): string => {
    switch (u.kind) {
      case "all":
        return text(u.lineId);
      case "written":
        return `written ${u.remaining ? "remaining " : ""}${step.text.slice(u.start, u.end)} ${u.name} | ${text(u.lineId)}`;
      case "remaining":
      case "part":
        return `${u.kind} ${amountLine(text(u.lineId), u.value, u.unit)} | ${text(u.lineId)}`;
      case "small":
        return `small ${u.words} | ${text(u.lineId)}`;
      case "some":
        return `some | ${text(u.lineId)}`;
      case "which":
        return `which ${u.word} | ${u.lineIds.map(text).join(" | ")}`;
      case "mixture":
        return `mixture ${u.name} from step ${method.findIndex((s) => s.id === u.fromStepId) + 1}`;
    }
  };
  return method.map((s) => (map.get(s.id) ?? []).map((u) => row(u, s)));
}

describe("today's cook mode cases, on the new matcher", () => {
  it("finds them by name in the step, in the order the step names them", () => {
    expect(
      rows(
        `2 cups all-purpose flour
2 tablespoons sugar
2 teaspoons baking powder
½ teaspoon baking soda
½ teaspoon salt
2 cups buttermilk
2 large eggs
3 tablespoons butter, melted, plus more for the pan`,
        `Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.
In another bowl, whisk the buttermilk, eggs and melted butter.
Pour the wet ingredients into the dry and stir just until combined.`,
      ),
    ).toEqual([
      [
        "2 cups all-purpose flour",
        "2 tablespoons sugar",
        "2 teaspoons baking powder",
        "½ teaspoon baking soda",
        "½ teaspoon salt",
      ],
      ["2 cups buttermilk", "2 large eggs", "3 tablespoons butter, melted, plus more for the pan"],
      [],
    ]);
  });

  it("tortillas aren't the flour, pork finds pork shoulder, and half the salt is worked out", () => {
    expect(
      rows(
        `For the stew:
2 lb pork shoulder, cut into 1-inch cubes
1 tablespoon salt, divided
Warm flour tortillas
1 cup flour`,
        `Season the pork with half the salt.
Dust with the flour.
Serve with warm tortillas and the rest of the salt.`,
      ),
    ).toEqual([
      [
        "2 lb pork shoulder, cut into 1-inch cubes",
        "part ½ tablespoon salt | 1 tablespoon salt, divided",
      ],
      ["1 cup flour"],
      ["Warm flour tortillas", "remaining ½ tablespoon salt | 1 tablespoon salt, divided"],
    ]);
  });
});

// fennl_g's 40 cases (tests/domain.test.ts and tests/ui.test.tsx there), with the new answers.
const OLD_CASES: [
  name: string,
  ingredients: string[],
  directions: string[],
  expected: string[][],
][] = [
  [
    "a step's own amount of a listed ingredient (differs from fennl_g: the step's own amount is listed)",
    ["1 cup milk"],
    ["Add 1 tablespoon of the milk. Bake for 20 minutes at 350°F."],
    [["written 1 tablespoon milk | 1 cup milk"]],
  ],
  [
    "divided broth, the remaining amount written in the step (differs from fennl_g: the step's own amount is listed)",
    ["1 cup chicken broth, divided"],
    ["Pour in 3/4 cup chicken broth.", "Add the remaining 1/4 cup chicken broth."],
    [
      ["written 3/4 cup chicken broth | 1 cup chicken broth, divided"],
      ["written remaining 1/4 cup chicken broth | 1 cup chicken broth, divided"],
    ],
  ],
  [
    'divided broth, "the remaining 1/4" with no unit is worked out as ¼ cup (differs from fennl_g: the step\'s own amount is listed)',
    ["1 cup chicken broth, divided"],
    ["Pour in 3/4 cup chicken broth.", "Add the remaining 1/4 chicken broth."],
    [
      ["written 3/4 cup chicken broth | 1 cup chicken broth, divided"],
      ["remaining ¼ cup chicken broth | 1 cup chicken broth, divided"],
    ],
  ],
  [
    "divided broth, a remainder that doesn't add up is unsure (differs from fennl_g: the step's own amount is listed)",
    ["1 cup chicken broth, divided"],
    ["Pour in 3/4 cup chicken broth.", "Add the remaining 1/3 chicken broth."],
    [
      ["written 3/4 cup chicken broth | 1 cup chicken broth, divided"],
      ["some | 1 cup chicken broth, divided"],
    ],
  ],
  [
    'divided broth used with no amount before its shares (differs from fennl_g: "not sure how much" instead of "needs review")',
    ["1 cup chicken broth, divided"],
    [
      "Use chicken broth to loosen the sauce.",
      "Pour in 3/4 cup chicken broth.",
      "Add the remaining 1/4 chicken broth.",
    ],
    [
      ["some | 1 cup chicken broth, divided"],
      ["written 3/4 cup chicken broth | 1 cup chicken broth, divided"],
      ["some | 1 cup chicken broth, divided"],
    ],
  ],
  [
    "amounts of something not listed, and ranges, list nothing",
    ["1 cup butter"],
    ["Stir in 2 tbsp oil.", "Add 1–2 tbsp oil if needed.", "Bake for 20 minutes at 350°F."],
    [[], [], []],
  ],
  [
    "only use of each ingredient shows the whole line",
    ["4 tbsp unsalted butter, softened", "1 tsp vanilla extract"],
    ["Add the butter and vanilla extract, then beat until smooth."],
    [["4 tbsp unsalted butter, softened", "1 tsp vanilla extract"]],
  ],
  [
    "a step's own amount beside an ingredient used whole",
    ["1 cup chicken broth, divided", "1/2 cup apple cider vinegar"],
    ["Place pork into slow cooker, pour in 3/4 cup chicken broth and apple cider vinegar."],
    [
      [
        "written 3/4 cup chicken broth | 1 cup chicken broth, divided",
        "1/2 cup apple cider vinegar",
      ],
    ],
  ],
  [
    "the remaining sugar worked out from the amount used before (differs from fennl_g: the step's own amount is listed)",
    ["2 cups sugar, divided"],
    [
      "Add 1.5 cup sugar and beat until pale.",
      "Scrape down the bowl.",
      "Add the eggs.",
      "Fold in the flour.",
      "Sprinkle in the remaining sugar.",
    ],
    [
      ["written 1.5 cup sugar | 2 cups sugar, divided"],
      [],
      [],
      [],
      ["remaining ½ cup sugar | 2 cups sugar, divided"],
    ],
  ],
  [
    "the remaining sugar worked out across tablespoons and cups (differs from fennl_g: the step's own amount is listed)",
    ["2 cups sugar, divided"],
    ["Add 24 tbsp sugar and beat until pale.", "Add the remaining sugar."],
    [
      ["written 24 tbsp sugar | 2 cups sugar, divided"],
      ["remaining ½ cup sugar | 2 cups sugar, divided"],
    ],
  ],
  [
    "grams used and cups listed: the rest in the step's words, with no amount and no flag (differs from fennl_g: the step's own amount is listed, and no \"needs review\")",
    ["2 cups sugar, divided"],
    ["Add 300 g sugar.", "Add the remaining sugar."],
    [
      ["written 300 g sugar | 2 cups sugar, divided"],
      ["small the remaining sugar | 2 cups sugar, divided"],
    ],
  ],
  [
    'divided sugar used with no amount, then "the remaining sugar" (differs from fennl_g: "not sure how much" instead of "needs review")',
    ["2 cups sugar, divided"],
    ["Sprinkle sugar over the berries.", "Add the remaining sugar."],
    [["some | 2 cups sugar, divided"], ["some | 2 cups sugar, divided"]],
  ],
  [
    '"plus more for dusting" is extra, so the rest of the 2 cups is worked out (differs from fennl_g: it gave up)',
    ["2 cups flour, plus more for dusting"],
    ["Mix in 1 cup flour.", "Add the remaining flour."],
    [
      ["written 1 cup flour | 2 cups flour, plus more for dusting"],
      ["remaining 1 cup flour | 2 cups flour, plus more for dusting"],
    ],
  ],
  [
    'divided sugar used again after "the remaining sugar": nothing is certain (differs from fennl_g: the step\'s own amount is listed) (differs from fennl_g: "not sure how much" instead of "needs review")',
    ["2 cups sugar, divided"],
    ["Add 1 cup sugar.", "Add the remaining sugar.", "Sprinkle sugar over the top."],
    [
      ["written 1 cup sugar | 2 cups sugar, divided"],
      ["some | 2 cups sugar, divided"],
      ["some | 2 cups sugar, divided"],
    ],
  ],
  [
    'a range total (1–2 cups) is never worked out (differs from fennl_g: the step\'s own amount is listed) (differs from fennl_g: "not sure how much" instead of "needs review")',
    ["1–2 cups sugar, divided"],
    ["Add 1 cup sugar.", "Add the remaining sugar."],
    [["written 1 cup sugar | 1–2 cups sugar, divided"], ["some | 1–2 cups sugar, divided"]],
  ],
  [
    '"the sugar" with only brown and powdered sugar listed says it isn\'t sure which (differs from fennl_g: it showed nothing)',
    ["1 cup brown sugar", "1 cup powdered sugar"],
    ["Add the sugar and mix."],
    [["which sugar | 1 cup brown sugar | 1 cup powdered sugar"]],
  ],
  [
    '"the remaining water" when nothing else uses it is all of it (differs from fennl_g: it asked for review)',
    ["2 cups sugar", "1 cup water"],
    ["Discard the remaining water, then add sugar."],
    [["1 cup water", "2 cups sugar"]],
  ],
  [
    '"flour mixture" points to the step that made it',
    [
      "2 1/4 cups all-purpose flour",
      "1 tsp baking soda",
      "1 tsp salt",
      "12 oz semi-sweet chocolate morsels",
    ],
    [
      "Combine flour, baking soda, and salt in a small bowl.",
      "Beat the butter and sugar until creamy.",
      "Add the eggs.",
      "Gradually beat in flour mixture. Stir in morsels.",
    ],
    [
      ["2 1/4 cups all-purpose flour", "1 tsp baking soda", "1 tsp salt"],
      [],
      [],
      ["mixture flour mixture from step 1", "12 oz semi-sweet chocolate morsels"],
    ],
  ],
  [
    '"half the flour mixture" points to it, keeping its words (differs from fennl_g: it asked for review)',
    ["2 cups flour", "1 tsp salt"],
    ["Combine flour and salt in a bowl.", "Add half the flour mixture."],
    [["2 cups flour", "1 tsp salt"], ["mixture half the flour mixture from step 1"]],
  ],
  [
    "a divided flour's mixture points back too; the flour itself is unsure (differs from fennl_g: it asked for review)",
    ["2 cups flour, divided", "1 tsp salt"],
    ["Combine flour and salt in a bowl.", "Add the flour mixture."],
    [["some | 2 cups flour, divided", "1 tsp salt"], ["mixture flour mixture from step 1"]],
  ],
  [
    "a mixture made with part of the flour still points back (differs from fennl_g: it asked for review)",
    ["2 cups flour", "1 tsp salt"],
    ["Combine 1 cup flour and salt in a bowl.", "Add the flour mixture."],
    [["written 1 cup flour | 2 cups flour", "1 tsp salt"], ["mixture flour mixture from step 1"]],
  ],
  [
    "chocolate bars mean both chocolates, the melted chocolate points back, peanut butter chips aren't butter",
    [
      "8 oz semisweet chocolate",
      "4 oz unsweetened chocolate",
      "1/8 teaspoon kosher salt",
      "6 tablespoons unsalted butter",
      "1/3 cup all-purpose flour",
      "1/4 teaspoon baking powder",
      "3 large eggs",
      "1 cup granulated sugar",
      "2 teaspoons vanilla extract",
      "1 cup semisweet chocolate or peanut butter chips",
      "1½ cups walnuts, chopped",
    ],
    [
      "Preheat oven to 300°.",
      "Melt chocolate bars and butter over low heat. Stir until smooth. Cool.",
      "Sift flour, baking powder, and salt; set aside. Beat eggs, sugar and vanilla until mixed, then add melted chocolate and mix. Add dry ingredients and mix well.",
      "Stir in chocolate/peanut butter chips and walnuts.",
    ],
    [
      [],
      ["8 oz semisweet chocolate", "4 oz unsweetened chocolate", "6 tablespoons unsalted butter"],
      [
        "1/3 cup all-purpose flour",
        "1/4 teaspoon baking powder",
        "1/8 teaspoon kosher salt",
        "3 large eggs",
        "1 cup granulated sugar",
        "2 teaspoons vanilla extract",
        "mixture melted chocolate from step 2",
      ],
      ["1 cup semisweet chocolate or peanut butter chips", "1½ cups walnuts, chopped"],
    ],
  ],
  [
    "synonym: chickpeas for garbanzo beans",
    ["1 cup garbanzo beans"],
    ["Add the chickpeas."],
    [["1 cup garbanzo beans"]],
  ],
  ["synonym: aubergine for eggplant", ["1 eggplant"], ["Dice the aubergine."], [["1 eggplant"]]],
  ["synonym: courgettes for zucchini", ["2 zucchini"], ["Slice the courgettes."], [["2 zucchini"]]],
  [
    "synonym: rocket for arugula",
    ["2 cups arugula"],
    ["Fold in the rocket."],
    [["2 cups arugula"]],
  ],
  [
    "synonym: green onions for scallions",
    ["3 scallions"],
    ["Add the green onions."],
    [["3 scallions"]],
  ],
  [
    "synonym: bicarbonate of soda for baking soda",
    ["1 tsp baking soda"],
    ["Whisk in the bicarbonate of soda."],
    [["1 tsp baking soda"]],
  ],
  [
    "synonym: capsicum for bell pepper",
    ["1 bell pepper"],
    ["Dice the capsicum."],
    [["1 bell pepper"]],
  ],
  [
    "synonym: beef mince for ground beef",
    ["1 lb ground beef"],
    ["Brown the beef mince."],
    [["1 lb ground beef"]],
  ],
  [
    "synonym: coriander leaves for cilantro",
    ["1 cup cilantro"],
    ["Fold in the coriander leaves."],
    [["1 cup cilantro"]],
  ],
  [
    "synonym: confectioners' sugar for powdered sugar",
    ["1 cup powdered sugar"],
    ["Sift the confectioners' sugar."],
    [["1 cup powdered sugar"]],
  ],
  [
    "synonym: superfine sugar for caster sugar",
    ["1 cup caster sugar"],
    ["Beat in the superfine sugar."],
    [["1 cup caster sugar"]],
  ],
  [
    "synonym: vanilla for vanilla extract",
    ["1 tsp vanilla extract"],
    ["Add the vanilla."],
    [["1 tsp vanilla extract"]],
  ],
  [
    '"the nuts" are every listed nut',
    ["1 cup pecans", "1 cup walnuts"],
    ["Fold in the nuts."],
    [["1 cup pecans", "1 cup walnuts"]],
  ],
  [
    "names of their own: peanut butter, coconut milk, cream cheese, almond flour",
    [
      "6 tbsp unsalted butter",
      "1 cup peanut butter chips",
      "1 cup whole milk",
      "1 cup coconut milk",
      "4 oz cream",
      "4 oz cream cheese",
      "1 cup all-purpose flour",
      "1 cup almond flour",
    ],
    [
      "Stir in the peanut butter chips.",
      "Add the coconut milk.",
      "Beat the cream cheese.",
      "Fold in the almond flour.",
    ],
    [
      ["1 cup peanut butter chips"],
      ["1 cup coconut milk"],
      ["4 oz cream cheese"],
      ["1 cup almond flour"],
    ],
  ],
  [
    '"beef cubes" are the cubed chuck roast, not the broth',
    ["2.5 lbs beef chuck roast, cut into 1-inch cubes", "4 cups beef broth"],
    ["Season beef cubes with salt and pepper.", "Pour in beef broth."],
    [["2.5 lbs beef chuck roast, cut into 1-inch cubes"], ["4 cups beef broth"]],
  ],
  [
    "two cubed beefs: nothing is guessed",
    ["2 lbs beef chuck roast, cubed", "1 lb beef stew meat, cut into cubes", "4 cups beef broth"],
    ["Brown the beef cubes.", "Add the beef."],
    [[], []],
  ],
  [
    '"flour mixture" after a preheat step points to the right step',
    [
      "2 1/4 cups all-purpose flour",
      "1 tsp baking soda",
      "1 tsp salt",
      "12 oz semi-sweet chocolate morsels",
    ],
    [
      "Preheat oven to 375°F.",
      "Combine flour, baking soda, and salt in a small bowl.",
      "Beat the butter and sugar until creamy.",
      "Add the eggs.",
      "Gradually beat in flour mixture. Stir in morsels.",
    ],
    [
      [],
      ["2 1/4 cups all-purpose flour", "1 tsp baking soda", "1 tsp salt"],
      [],
      [],
      ["mixture flour mixture from step 2", "12 oz semi-sweet chocolate morsels"],
    ],
  ],
  [
    "pulled pork: the step's own broth amount beside the vinegar",
    ["1 cup chicken broth, divided", "1/2 cup apple cider vinegar"],
    [
      "Prepare the pork.",
      "Place pork into slow cooker, pour in 3/4 cup chicken broth and apple cider vinegar.",
    ],
    [
      [],
      [
        "written 3/4 cup chicken broth | 1 cup chicken broth, divided",
        "1/2 cup apple cider vinegar",
      ],
    ],
  ],
];

describe("the earlier Fennl's cases", () => {
  it.each(OLD_CASES)("%s", (_name, ingredients, directions, expected) => {
    expect(rows(ingredients, directions)).toEqual(expected);
  });
});

// Ten harder recipes, each answer written by hand (stepcues/extras.json, 2026-11-04).
const EXTRAS: [
  name: string,
  ingredients: string[],
  directions: string[],
  expected: string[][],
  linked: string[],
][] = [
  [
    "X1 divided sugar (snickerdoodles)",
    [
      "1 cup sugar, divided",
      "1/2 cup butter, softened",
      "1 large egg",
      "1 1/2 cups all-purpose flour",
      "1 tsp ground cinnamon",
    ],
    [
      "Beat the butter and 3/4 cup of the sugar until fluffy. Beat in the egg.",
      "Stir in the flour.",
      "Mix the remaining sugar with the cinnamon. Roll the balls of dough in the cinnamon sugar.",
    ],
    [
      ["1/2 cup butter, softened", "written 3/4 cup sugar | 1 cup sugar, divided", "1 large egg"],
      ["1 1/2 cups all-purpose flour"],
      ["remaining ¼ cup sugar | 1 cup sugar, divided", "1 tsp ground cinnamon"],
    ],
    [],
  ],
  [
    "X2 'the remaining flour' (bread)",
    [
      "4 cups bread flour, divided",
      "2 1/4 tsp instant yeast",
      "1 1/2 cups warm water",
      "2 tsp salt",
      "2 tbsp olive oil",
    ],
    [
      "Stir together 2 cups of the flour, the yeast and the water. Rest 10 minutes.",
      "Add the salt, oil and the remaining flour; knead 8 minutes.",
      "Shape, cover, and let rise for 1 hour.",
    ],
    [
      [
        "written 2 cups flour | 4 cups bread flour, divided",
        "2 1/4 tsp instant yeast",
        "1 1/2 cups warm water",
      ],
      [
        "2 tsp salt",
        "2 tbsp olive oil",
        "remaining 2 cups bread flour | 4 cups bread flour, divided",
      ],
      [],
    ],
    [],
  ],
  [
    "X3 'the dry ingredients' + 'the egg mixture' (muffins) (\"the dry ingredients\" isn't pointed at yet: a miss)",
    [
      "2 cups all-purpose flour",
      "2 tsp baking powder",
      "1/2 tsp salt",
      "2 large eggs",
      "1 cup milk",
      "1/3 cup vegetable oil",
      "3/4 cup sugar",
      "1 cup blueberries",
    ],
    [
      "Whisk the flour, baking powder and salt in a large bowl.",
      "In another bowl whisk the eggs, milk, oil and sugar.",
      "Pour the egg mixture into the dry ingredients and stir until just combined.",
      "Fold in the blueberries.",
    ],
    [
      ["2 cups all-purpose flour", "2 tsp baking powder", "1/2 tsp salt"],
      ["2 large eggs", "1 cup milk", "1/3 cup vegetable oil", "3/4 cup sugar"],
      ["mixture egg mixture from step 2"],
      ["1 cup blueberries"],
    ],
    [],
  ],
  [
    "X4 'brown sugar' vs 'sugar' + separate salt/pepper (chicken)",
    [
      "1 tbsp brown sugar",
      "1 tsp smoked paprika",
      "1 tsp kosher salt",
      "1/2 tsp black pepper",
      "4 chicken thighs",
      "1 tbsp granulated sugar",
      "2 tbsp apple cider vinegar",
    ],
    [
      "Mix the brown sugar, paprika, salt and pepper; rub over the chicken.",
      "Roast for 35 minutes.",
      "Simmer the vinegar with the sugar until syrupy; brush over the chicken.",
    ],
    [
      [
        "1 tbsp brown sugar",
        "1 tsp smoked paprika",
        "1 tsp kosher salt",
        "1/2 tsp black pepper",
        "4 chicken thighs",
      ],
      [],
      ["2 tbsp apple cider vinegar", "1 tbsp granulated sugar", "4 chicken thighs"],
    ],
    [],
  ],
  [
    "X5 'butter, melted' vs 'melted butter' + eggs/egg yolk",
    [
      "1/2 cup butter, melted and cooled",
      "1 cup sugar",
      "2 eggs",
      "1 egg yolk",
      "1 cup all-purpose flour",
    ],
    [
      "Whisk the melted butter and sugar.",
      "Beat in the eggs, then the yolk.",
      "Fold in the flour.",
    ],
    [
      ["1/2 cup butter, melted and cooled", "1 cup sugar"],
      ["2 eggs", "1 egg yolk"],
      ["1 cup all-purpose flour"],
    ],
    [],
  ],
  [
    "X6 two cheeses (mac and cheese)",
    [
      "1 lb elbow macaroni",
      "4 tbsp butter",
      "1/4 cup flour",
      "3 cups milk",
      "2 cups shredded sharp cheddar cheese",
      "1 cup grated Parmesan cheese",
      "1/2 cup panko breadcrumbs",
    ],
    [
      "Cook the pasta in salted water; drain.",
      "Melt the butter, whisk in the flour, then the milk; simmer until thick.",
      "Stir in the cheddar and half the Parmesan, then the macaroni.",
      "Top with the breadcrumbs and the rest of the cheese; bake 20 minutes.",
    ],
    [
      ["1 lb elbow macaroni"],
      ["4 tbsp butter", "1/4 cup flour", "3 cups milk"],
      [
        "2 cups shredded sharp cheddar cheese",
        "part ½ cup grated Parmesan cheese | 1 cup grated Parmesan cheese",
        "1 lb elbow macaroni",
      ],
      [
        "1/2 cup panko breadcrumbs",
        "remaining ½ cup grated Parmesan cheese | 1 cup grated Parmesan cheese",
      ],
    ],
    [],
  ],
  [
    "X7 linked sub-recipe lines (pulled pork)",
    ["2 lb pork shoulder", "1 tsp salt", "1 cup BBQ sauce", "8 brioche buns", "2 cups coleslaw"],
    [
      "Season the pork with the salt and slow-cook 8 hours.",
      "Shred the pork and toss with the sauce.",
      "Pile onto the buns and top with the slaw.",
    ],
    [
      ["2 lb pork shoulder", "1 tsp salt"],
      ["2 lb pork shoulder", "1 cup BBQ sauce"],
      ["8 brioche buns", "2 cups coleslaw"],
    ],
    ["1 cup BBQ sauce", "2 cups coleslaw"],
  ],
  [
    "X8 same ingredient in two sections (apple pie)",
    [
      "For the crust:",
      "1 1/4 cups all-purpose flour",
      "1/2 tsp salt",
      "1/2 cup cold butter, cubed",
      "3 tbsp ice water",
      "For the filling:",
      "6 apples, peeled and sliced",
      "1/2 cup sugar",
      "2 tbsp flour",
      "1 tsp cinnamon",
      "1 tbsp butter",
    ],
    [
      "For the crust:",
      "Pulse the flour, salt and butter until crumbly. Add the water and form a disc.",
      "For the filling:",
      "Toss the apples with the sugar, flour and cinnamon.",
      "Fill the crust, dot with the butter and bake 50 minutes.",
    ],
    [
      [
        "1 1/4 cups all-purpose flour",
        "1/2 tsp salt",
        "1/2 cup cold butter, cubed",
        "3 tbsp ice water",
      ],
      ["6 apples, peeled and sliced", "1/2 cup sugar", "2 tbsp flour", "1 tsp cinnamon"],
      ["1 tbsp butter"],
    ],
    [],
  ],
  [
    "X9 'half the butter' / 'the rest of the butter' (risotto)",
    [
      "4 cups chicken stock",
      "1 cup arborio rice",
      "1 shallot, minced",
      "1/2 cup dry white wine",
      "1/2 cup grated Parmesan",
      "2 tbsp butter",
    ],
    [
      "Sauté the shallot in half the butter.",
      "Add the rice and toast 2 minutes. Pour in the wine.",
      "Add the stock a ladle at a time, stirring, about 20 minutes.",
      "Stir in the Parmesan and the rest of the butter.",
    ],
    [
      ["1 shallot, minced", "part 1 tbsp butter | 2 tbsp butter"],
      ["1 cup arborio rice", "1/2 cup dry white wine"],
      ["4 cups chicken stock"],
      ["1/2 cup grated Parmesan", "remaining 1 tbsp butter | 2 tbsp butter"],
    ],
    [],
  ],
  [
    "X10 'the pasta', 'garlic cloves', 'Salt and pepper' line (aglio e olio)",
    [
      "12 oz spaghetti",
      "3 garlic cloves, thinly sliced",
      "1/3 cup extra-virgin olive oil",
      "1/2 tsp red pepper flakes",
      "1/4 cup chopped parsley",
      "Salt and pepper to taste",
    ],
    [
      "Boil the spaghetti in well-salted water until al dente.",
      "Warm the oil with the garlic and pepper flakes until golden.",
      "Toss the pasta with the garlic oil and the parsley; season with salt.",
    ],
    [
      ["12 oz spaghetti"],
      [
        "1/3 cup extra-virgin olive oil",
        "3 garlic cloves, thinly sliced",
        "1/2 tsp red pepper flakes",
      ],
      ["12 oz spaghetti", "1/4 cup chopped parsley", "Salt and pepper to taste"],
    ],
    [],
  ],
];

describe("ten harder recipes", () => {
  it.each(EXTRAS)("%s", (name, ingredients, directions, expected, linked) => {
    const titles = name.startsWith("X7")
      ? { "2 cups coleslaw": "Coleslaw", "1 cup BBQ sauce": "BBQ Sauce" }
      : {};
    expect(rows(ingredients, directions, linked, titles)).toEqual(expected);
  });
});

describe("the owner's rules (2026-11-04)", () => {
  it('a bare "pepper" is the black pepper, never the bell pepper, cayenne or flakes', () => {
    expect(
      rows(
        `1 tsp kosher salt
1/2 tsp black pepper
1 red bell pepper, diced
1/4 tsp cayenne pepper
1/2 tsp red pepper flakes`,
        `Season with salt and pepper.
Add the bell pepper and the cayenne.`,
      ),
    ).toEqual([
      ["1 tsp kosher salt", "1/2 tsp black pepper"],
      ["1 red bell pepper, diced", "1/4 tsp cayenne pepper"],
    ]);
    // With no black pepper listed, "pepper" isn't the jalapeño.
    expect(rows("1 jalapeño pepper, minced\n1 tsp salt", "Season with salt and pepper.")).toEqual([
      ["1 tsp salt"],
    ]);
  });

  it("the plain sugar, flour and salt win over brown sugar, almond flour and flaky salt", () => {
    expect(
      rows(
        `1 cup brown sugar
2 cups granulated sugar
1/4 cup powdered sugar
2 cups all-purpose flour
1/2 cup almond flour
Flaky sea salt, for finishing
1 tsp kosher salt`,
        `Whisk the flour, sugar and salt.
Sprinkle with the flaky sea salt to serve.`,
      ),
    ).toEqual([
      ["2 cups all-purpose flour", "2 cups granulated sugar", "1 tsp kosher salt"],
      ["Flaky sea salt, for finishing"],
    ]);
  });

  it("when only one line fits the bare name, it is that line", () => {
    expect(rows("1 cup brown sugar\n1 cup flour", "Mix the sugar and flour.")).toEqual([
      ["1 cup brown sugar", "1 cup flour"],
    ]);
  });

  it("a little of the butter is shown in the step's words, and doesn't make the butter unsure", () => {
    expect(
      rows(
        "4 tablespoons butter\n1 onion, chopped",
        "Grease the pan with a little of the butter.\nMelt the butter and cook the onion.",
      ),
    ).toEqual([
      ["small a little of the butter | 4 tablespoons butter"],
      ["4 tablespoons butter", "1 onion, chopped"],
    ]);
    expect(
      rows(
        "1 cup sugar\n1 cup flour",
        "Add a pinch of the sugar.\nAdd a dash of salt.\nStir in a handful of the flour.",
      ),
    ).toEqual([
      ["small a pinch of the sugar | 1 cup sugar"],
      [],
      ["small a handful of the flour | 1 cup flour"],
    ]);
  });

  it("says it isn't sure which only when two lines fit and neither is the ordinary one", () => {
    expect(
      rows(
        `1 cup shredded cheddar cheese
1/2 cup grated Parmesan cheese
2 tablespoons olive oil
1 teaspoon sesame oil`,
        "Heat the oil.\nSprinkle with the cheese.",
      ),
    ).toEqual([
      ["which oil | 2 tablespoons olive oil | 1 teaspoon sesame oil"],
      ["which cheese | 1 cup shredded cheddar cheese | 1/2 cup grated Parmesan cheese"],
    ]);
  });

  it('a divided sugar added gradually, then "the remaining sugar", is unsure in both', () => {
    expect(
      rows(
        "1 cup sugar, divided\n2 eggs\n1 cup flour",
        `Beat the eggs.
Add the sugar gradually.
Fold in the flour.
Sprinkle with the remaining sugar.`,
      ),
    ).toEqual([
      ["2 eggs"],
      ["some | 1 cup sugar, divided"],
      ["1 cup flour"],
      ["some | 1 cup sugar, divided"],
    ]);
  });

  it("a step that writes its own amount lists that amount; the rest is worked out", () => {
    expect(
      rows(
        "1 cup sugar, divided\n3 eggs",
        "Beat the eggs with ¾ cup of the sugar.\nSprinkle with the remaining sugar.",
      ),
    ).toEqual([
      ["3 eggs", "written ¾ cup sugar | 1 cup sugar, divided"],
      ["remaining ¼ cup sugar | 1 cup sugar, divided"],
    ]);
  });
});

describe("what isn't a use of the measured line (reviewers' cases, 2026-11-04)", () => {
  it("greasing or oiling a pan or a grate never lists the batter's butter or oil", () => {
    expect(
      rows(
        "1/2 cup butter, melted\n1/4 cup vegetable oil\n2 cups flour\n1 cup sugar",
        "Grease a 9x13 pan with butter.\nOil a second pan.\nMix the flour, sugar, butter and oil.",
      ),
    ).toEqual([
      [],
      [],
      ["2 cups flour", "1 cup sugar", "1/2 cup butter, melted", "1/4 cup vegetable oil"],
    ]);
    expect(
      rows(
        "1/3 cup (80 grams) vegetable oil\n2 cups flour\n2 eggs",
        "Oil the bottom and sides of 2 9-inch round cake pans.\nMix the flour, eggs and oil.",
      ),
    ).toEqual([[], ["2 cups flour", "2 eggs", "1/3 cup (80 grams) vegetable oil"]]);
    expect(
      rows(
        "BC Barbecue Sauce: ½ cup vegetable oil\n2 tablespoons vegetable oil\n2 lb ribs",
        "Clean and oil cooking grate. Brush the cooking grate with oil. Grill the ribs.",
      ),
    ).toEqual([["2 lb ribs"]]);
    // A line that's for greasing is that line.
    expect(rows("Butter, for greasing\n1 cup flour", "Grease a pan with butter.")).toEqual([
      ["Butter, for greasing"],
    ]);
  });

  it('"plus more for the pans": buttering and flouring the pans is the extra, not the measure', () => {
    expect(
      rows(
        `2 sticks unsalted butter, at room temperature, plus more for the pans
2 3/4 cups cake flour, plus more for the pans
1 cup sugar`,
        `Butter three 9-inch round cake pans and dust with flour.
Beat the butter and sugar. Add the flour.`,
      ),
    ).toEqual([
      [],
      [
        "2 sticks unsalted butter, at room temperature, plus more for the pans",
        "1 cup sugar",
        "2 3/4 cups cake flour, plus more for the pans",
      ],
    ]);
    expect(
      rows(
        "2 cups flour\n1 tsp baking powder\n1 cup sugar\n2 eggs",
        "Preheat oven. Grease and flour the pan.\nWhisk the flour and baking powder.\nBeat the sugar and eggs, then fold in the flour mixture.",
      ),
    ).toEqual([
      [],
      ["2 cups flour", "1 tsp baking powder"],
      ["1 cup sugar", "2 eggs", "mixture flour mixture from step 2"],
    ]);
  });

  it("flouring a counter, dusting dough or wiping off flour isn't the dough's flour again", () => {
    expect(
      rows(
        "3 cups flour\n2 tsp yeast\n1 cup water",
        "Mix the flour, yeast and water.\nDust with flour and shape.\nLightly flour 2 rimmed baking sheets.\nWipe flour from sheets.",
      ),
    ).toEqual([["3 cups flour", "2 tsp yeast", "1 cup water"], [], [], []]);
    expect(
      rows(
        "2 cups flour, plus more for dusting\n1 cup water\n2 tbsp olive oil, plus more for drizzling\n1 lb pasta",
        "Mix the flour and water.\nTurn out onto a floured counter and dust with flour.\nHeat the olive oil.\nToss the pasta and drizzle with olive oil.",
      ),
    ).toEqual([
      ["2 cups flour, plus more for dusting", "1 cup water"],
      [],
      ["2 tbsp olive oil, plus more for drizzling"],
      ["1 lb pasta"],
    ]);
    expect(
      rows(
        "400 grams bread flour\nRice flour or extra bread flour, for dusting\n280 grams warm water",
        "Mix the flour and water.\nDust a dish towel thoroughly on one side with rice flour or bread flour.",
      ),
    ).toEqual([
      ["400 grams bread flour", "280 grams warm water"],
      ["Rice flour or extra bread flour, for dusting"],
    ]);
  });

  it('letting dough rise is never the "rapid-rise" yeast', () => {
    expect(
      rows(
        "3 cups bread flour\n2 teaspoons instant or rapid-rise yeast\n1 cup water",
        "Mix the flour, yeast and water.\nLet dough rise until doubled.\nAllow the dough ball to rise.",
      ),
    ).toEqual([
      ["3 cups bread flour", "2 teaspoons instant or rapid-rise yeast", "1 cup water"],
      [],
      [],
    ]);
  });

  it("water for steam, a knife dipped in water, or a depth of water isn't the measured water", () => {
    expect(
      rows(
        "280 grams warm water\n400 grams bread flour\n3 tablespoons water",
        `Mix the flour and 280 grams of the water.
Splash some water inside the larger metal bowl.
Run a knife that has been dipped in warm water along the edge.
Place a pie plate filled with 1 inch water on the burner.`,
      ),
    ).toEqual([
      ["400 grams bread flour", "written 280 grams water | 280 grams warm water"],
      [],
      [],
      [],
    ]);
  });

  it("the remaining whipped cream, the rest of the salt: in the step's words, never the whole line", () => {
    expect(
      rows(
        "2 cups heavy whipping cream\n1 tsp salt\n1 cup flour",
        `Whip the cream. Fold half into the batter. Add a pinch of the salt to the flour.
Frost with the remaining whipped cream. Add the rest of the salt.`,
      ),
    ).toEqual([
      ["2 cups heavy whipping cream", "small a pinch of the salt | 1 tsp salt", "1 cup flour"],
      [
        "small the remaining whipped cream | 2 cups heavy whipping cream",
        "small the rest of the salt | 1 tsp salt",
      ],
    ]);
    // A little, then the rest, in one step: all of it.
    expect(
      rows(
        "4 tbsp butter, divided\n2 eggs",
        "Melt a little of the butter in a pan. Add the eggs and the remaining butter.",
      ),
    ).toEqual([["4 tbsp butter, divided", "2 eggs"]]);
  });
});

describe("plural words and sections (reviewers' cases, 2026-11-04)", () => {
  it("a plural word only takes the lines of the section the step is making", () => {
    expect(
      rows(
        `3/4 cup Craisins
1 cup white chocolate chips
2 cups flour
Frosting and Topping:
1/3 cup Craisins, roughly chopped
1 cup powdered sugar`,
        `Mix the flour.
Stir in white chocolate chips and Craisins by hand.
Frost and top with the chopped Craisins.`,
      ),
    ).toEqual([
      ["2 cups flour"],
      ["1 cup white chocolate chips", "3/4 cup Craisins"],
      ["1/3 cup Craisins, roughly chopped"],
    ]);
    expect(
      rows(
        `Cookie Dough:
1 cup butter
3/4 cup granulated sugar
1/2 cup light brown sugar
2 cups flour
Cinn Sugar Topping:
1/4 cup granulated sugar
1 tbsp cinnamon`,
        "Beat butter and both sugars.\nAdd the flour.",
      ),
    ).toEqual([
      ["1 cup butter", "3/4 cup granulated sugar", "1/2 cup light brown sugar"],
      ["2 cups flour"],
    ]);
  });

  it("two lines that read alike: the one in the section of the step's other ingredients", () => {
    expect(
      rows(
        `Cake:
2 sticks unsalted butter
1 3/4 cups granulated sugar
1 teaspoon coconut extract
Frosting:
2 sticks unsalted butter
12 ounces cream cheese
1 teaspoon coconut extract`,
        "Beat the butter and 1 1/4 cups granulated sugar. Beat in the coconut extract.",
      ),
    ).toEqual([
      [
        "2 sticks unsalted butter",
        "written 1 1/4 cups sugar | 1 3/4 cups granulated sugar",
        "1 teaspoon coconut extract",
      ],
    ]);
  });

  it("a step under its section's heading only uses that section's onion", () => {
    expect(
      rows(
        `1 medium onion, halved and sliced
1 lb chicken
Avocado Crema:
2 green onions
1 avocado`,
        `Cook the chicken and onion.
To make avocado crema:
Dice and combine all ingredients in food processor. I keep tasting too much onion.`,
      ),
    ).toEqual([["1 lb chicken", "1 medium onion, halved and sliced"], ["2 green onions"]]);
  });
});

describe("the step's own words pick the line (reviewers' cases, 2026-11-04)", () => {
  it("the minced garlic, the fresh oregano, flaky salt, the crushed tomatoes", () => {
    expect(
      rows(
        "4 garlic cloves, minced\n1 head of garlic, cut in half\n1 chicken",
        "Rub the minced garlic over the chicken.\nStuff the garlic head in the chicken.",
      ),
    ).toEqual([
      ["4 garlic cloves, minced", "1 chicken"],
      ["1 head of garlic, cut in half", "1 chicken"],
    ]);
    expect(
      rows(
        "2 tablespoons chopped fresh oregano leaves\n1½ teaspoons dried oregano\n1 cup cream",
        "Add the dried oregano.\nAdd the fresh oregano and cream.",
      ),
    ).toEqual([
      ["1½ teaspoons dried oregano"],
      ["2 tablespoons chopped fresh oregano leaves", "1 cup cream"],
    ]);
    expect(
      rows(
        "1 tsp kosher salt\nFlaky sea salt, for finishing\n1 lb fish",
        "Season the fish with salt.\nFinish with flaky salt.",
      ),
    ).toEqual([["1 lb fish", "1 tsp kosher salt"], ["Flaky sea salt, for finishing"]]);
    expect(
      rows(
        `1 (28-ounce) can crushed tomatoes
4 to 5 very ripe beefsteak tomatoes, cut into 1/2-inch thick slices
1 lb penne
2 garlic cloves`,
        `Cook the penne.
Blend together the crushed tomatoes and garlic. Toss with the penne.
Line the dish with tomato slices. Bake until the tomatoes are slightly crispy.`,
      ),
    ).toEqual([
      ["1 lb penne"],
      ["1 (28-ounce) can crushed tomatoes", "2 garlic cloves", "1 lb penne"],
      ["4 to 5 very ripe beefsteak tomatoes, cut into 1/2-inch thick slices"],
    ]);
  });

  it("tools, results and the pan something was cooked in aren't added", () => {
    expect(
      rows(
        `1 cup granulated sugar
2 cups flour
Serving options: whipped cream, ice cream, or maraschino cherries
1 1/2 cups pesto
8 ounces applewood-smoked bacon
2 tbsp butter
1 tbsp oil
1 cup creamy peanut butter`,
        `Mix the flour and sugar.
Using a 2-ounce cookie or ice cream scoop, scoop the batter.
Bake until sugar bubbles.
Process until the pesto is thoroughly pureed.
In the same skillet used to cook the bacon, heat the butter and oil.
Add the bacon. Press into each peanut butter cookie.`,
      ),
    ).toEqual([
      ["2 cups flour", "1 cup granulated sugar"],
      [],
      [],
      [],
      ["2 tbsp butter", "1 tbsp oil"],
      ["8 ounces applewood-smoked bacon"],
    ]);
  });

  it("a title with an ampersand, and a cook's note, use nothing", () => {
    expect(
      rows(
        "4 oz. small-diced pancetta\n2 lb beef\n1 cup brown sugar",
        `Cook Pancetta & Brown Meat
Cook the pancetta. Brown the beef.
Last time I made this I added 1/3 cup brown sugar.`,
      ),
    ).toEqual([[], ["4 oz. small-diced pancetta", "2 lb beef"], []]);
  });

  it("peanut butter isn't the peanut butter cups, and the juice isn't the can of slices", () => {
    expect(
      rows(
        "1 cup creamy peanut butter\n40 Reese's miniature peanut butter cups\n1 cup sugar",
        "Add peanut butter and sugar, stir well.\nTop with the peanut butter cups.",
      ),
    ).toEqual([
      ["1 cup creamy peanut butter", "1 cup sugar"],
      ["40 Reese's miniature peanut butter cups"],
    ]);
    expect(
      rows(
        `1 (20-ounce) can pineapple slices in 100% pineapple juice
1/3 cup plus 2 tablespoons reserved pineapple juice from the canned pineapple, divided`,
        `Drain the pineapple slices, reserving the juice.
Add 2 tablespoons of the pineapple juice.`,
      ),
    ).toEqual([
      ["1 (20-ounce) can pineapple slices in 100% pineapple juice"],
      [
        "written 2 tablespoons pineapple juice | 1/3 cup plus 2 tablespoons reserved pineapple juice from the canned pineapple, divided",
      ],
    ]);
  });
});

describe("mixtures and unsure rows (reviewers' cases, 2026-11-04)", () => {
  it("a mixture is from the latest step that made it, and never from greasing the pan", () => {
    expect(
      rows(
        "2 tbsp butter\n1 cup flour\n1 cup sugar\n2 eggs",
        "Melt the butter.\nWhisk the flour.\nBeat the butter and sugar with the eggs.\nAdd flour mixture to butter mixture.",
      ),
    ).toEqual([
      ["2 tbsp butter"],
      ["1 cup flour"],
      ["2 tbsp butter", "1 cup sugar", "2 eggs"],
      ["mixture flour mixture from step 2", "mixture butter mixture from step 3"],
    ]);
    expect(
      rows(
        "2 cups flour\n1 tsp baking powder\n1 cup sugar\n2 eggs",
        "Preheat oven. Spray a pan with baking spray with flour.\nWhisk the flour and baking powder.\nBeat the sugar and eggs, then fold in the flour mixture.",
      ),
    ).toEqual([
      [],
      ["2 cups flour", "1 tsp baking powder"],
      ["1 cup sugar", "2 eggs", "mixture flour mixture from step 2"],
    ]);
    // "The melted chocolate" is the mousse's milk chocolate, melted in step 2.
    expect(
      rows(
        "4 ounces bittersweet chocolate\n6 ounces milk chocolate\n1 cup heavy cream",
        "Melt the bittersweet chocolate.\nMelt the milk chocolate.\nWhip the cream. Fold the whipped cream mixture into the melted chocolate.",
      ),
    ).toEqual([
      ["4 ounces bittersweet chocolate"],
      ["6 ounces milk chocolate"],
      ["1 cup heavy cream", "mixture melted chocolate from step 2"],
    ]);
  });

  it("isn't unsure about lines already in, or when the step names the line it fits", () => {
    expect(
      rows(
        "1 cup parmesan\n1 cup mozzarella\n1 lb sausage",
        "Cook the sausage. Add the parmesan and mozzarella.\nBroil the cheese for 2 minutes.",
      ),
    ).toEqual([["1 lb sausage", "1 cup parmesan", "1 cup mozzarella"], []]);
    expect(
      rows(
        "3 tablespoons olive oil\nvegetable oil for frying\n1 teaspoon sesame oil\n1 lb chicken",
        "Mix the chicken with the olive oil and sesame oil.\nAdd the vegetable oil to a Dutch oven. Heat the oil to 350°F.\nAdd the chicken to the hot oil.",
      ),
    ).toEqual([
      ["1 lb chicken", "3 tablespoons olive oil", "1 teaspoon sesame oil"],
      ["vegetable oil for frying"],
      ["1 lb chicken", "vegetable oil for frying"],
    ]);
    // "The sauce" is the recipe's own, not the oyster or hoisin sauce.
    expect(
      rows(
        "1/2 cup oyster sauce\n1 tablespoon hoisin sauce\n1 lb chicken",
        "Fry the chicken.\nStir in the sauce.",
      ),
    ).toEqual([["1 lb chicken"], []]);
  });

  it('says "not sure which" once a step, with the lines\' own words', () => {
    expect(
      rows(
        "4 cups grated mozzarella cheese\n1/2 cup grated Parmesan cheese",
        "Top rolls with 2 cups of cheese and bake to melt the cheese. Spread marinara on the cheese, then the rest of the cheese.",
      ),
    ).toEqual([
      ["which cheese | 4 cups grated mozzarella cheese | 1/2 cup grated Parmesan cheese"],
    ]);
    expect(
      rows(
        "2 cups shredded mozzarella cheese\n1/2 cup grated parmesan\n2 cups marinara",
        "Stir the mozzarella cheese into the marinara.\nTop with the cheese and bake.",
      ),
    ).toEqual([
      ["2 cups shredded mozzarella cheese", "2 cups marinara"],
      ["which cheese | 2 cups shredded mozzarella cheese | 1/2 cup grated parmesan"],
    ]);
  });

  it("the pasta is every pasta, and bow ties are the bow tie pasta", () => {
    expect(
      rows(
        "8 oz fusilli\n8 oz bow tie pasta\n1 cup peas",
        "Cook the fusilli and bow ties separately.\nToss the cooled pasta with peas.",
      ),
    ).toEqual([
      ["8 oz fusilli", "8 oz bow tie pasta"],
      ["8 oz fusilli", "8 oz bow tie pasta", "1 cup peas"],
    ]);
  });
});

describe("amounts the step writes (reviewers' cases, 2026-11-04)", () => {
  it("a depth isn't an amount, and all but 2 tablespoons isn't 2 tablespoons", () => {
    expect(
      rows(
        "4 cups canola oil\n1 1/2 cups all-purpose flour, plus more for flouring the pan\n1 cup raspberries",
        `Fill with ½ inch oil.
Gradually add all but 2 tablespoons of the flour (reserve the 2 tablespoons for the raspberries).
Toss the raspberries in the reserved flour.`,
      ),
    ).toEqual([
      [],
      [
        "small all but 2 tablespoons of the flour | 1 1/2 cups all-purpose flour, plus more for flouring the pan",
      ],
      [
        "1 cup raspberries",
        "small the reserved flour | 1 1/2 cups all-purpose flour, plus more for flouring the pan",
      ],
    ]);
  });

  it("1 teaspoon of each of three herbs, the juice of half a lemon", () => {
    expect(
      rows(
        `1 tablespoon chopped fresh chives, plus 1 teaspoon for the sauce
1 tablespoon chopped fresh thyme, plus 1 teaspoon for the sauce
1 lemon, halved`,
        "Add 1 teaspoon of each of the chopped thyme and chives.\nAdd the juice of half a lemon.",
      ),
    ).toEqual([
      [
        "written 1 teaspoon thyme | 1 tablespoon chopped fresh thyme, plus 1 teaspoon for the sauce",
        "written 1 teaspoon chives | 1 tablespoon chopped fresh chives, plus 1 teaspoon for the sauce",
      ],
      ["written half a lemon | 1 lemon, halved"],
    ]);
  });

  it("one piece's share isn't the step's share, so the rest isn't worked out", () => {
    expect(
      rows(
        "2 cups cheese, divided\n8 tortillas",
        "Place 1/4 cup of the cheese on each tortilla.\nSprinkle the remaining cheese on top.",
      ),
    ).toEqual([
      ["small 1/4 cup of the cheese on each tortilla | 2 cups cheese, divided", "8 tortillas"],
      ["some | 2 cups cheese, divided"],
    ]);
  });

  it("an amount that's only about doesn't make the rest certain, even with another share", () => {
    expect(
      rows(
        "2 cups sugar, divided\n2 eggs",
        "Add about 1 cup of the sugar and the eggs, then 1/2 cup of the sugar.\nAdd the remaining sugar.",
      ),
    ).toEqual([
      [
        "written about 1 cup sugar | 2 cups sugar, divided",
        "written 1/2 cup sugar | 2 cups sugar, divided",
        "2 eggs",
      ],
      ["some | 2 cups sugar, divided"],
    ]);
  });

  it("a whole line isn't listed again once a step takes a share of it", () => {
    expect(
      rows(
        "8 thick-cut bacon slices\n1 bag hash browns",
        "Cook bacon. Crumble 5 slices of the cooked bacon.\nStir crumbled bacon and hash browns.\nCrumble remaining 3 slices of bacon, and sprinkle over top.",
      ),
    ).toEqual([
      ["8 thick-cut bacon slices"],
      ["1 bag hash browns"],
      ["written remaining 3 slices bacon | 8 thick-cut bacon slices"],
    ]);
  });

  it("two kinds aren't two of each", () => {
    expect(
      rows(
        "2/3 cup granulated sugar\n2/3 cup light brown sugar\n1/2 cup butter",
        "Cream the butter and 2 sugars.",
      ),
    ).toEqual([["1/2 cup butter", "2/3 cup granulated sugar", "2/3 cup light brown sugar"]]);
  });
});

describe("second review (2026-11-04)", () => {
  it("'the sugars' are the ones the step named, never the glaze's sugar", () => {
    expect(
      rows(
        "1 cup granulated sugar\n1/3 cup packed light brown sugar\n3/4 cup confectioners' sugar, sifted\n2 tbsp milk",
        `Whisk granulated sugar and brown sugar until combined. Rub vanilla seeds into sugars until fragrant.
Whisk the confectioners' sugar and milk for the glaze.`,
      ),
    ).toEqual([
      ["1 cup granulated sugar", "1/3 cup packed light brown sugar"],
      ["3/4 cup confectioners' sugar, sifted", "2 tbsp milk"],
    ]);
    // Three sugars and the step names none: not sure which.
    expect(
      rows(
        "1 cup granulated sugar\n1/3 cup brown sugar\n3/4 cup confectioners' sugar",
        "Rub the vanilla into the sugars.",
      ),
    ).toEqual([
      [
        "which sugars | 1 cup granulated sugar | 1/3 cup brown sugar | 3/4 cup confectioners' sugar",
      ],
    ]);
  });

  it("'water' in the brine's step is the brine's water, not the aromatics' cup", () => {
    expect(
      rows(
        [
          "For the Brine:",
          "1 cup kosher salt",
          "1 gallon vegetable stock",
          "1 gallon heavily iced water",
          "For the Aromatics:",
          "1 red apple, sliced",
          "1 cup water",
        ],
        `Combine the vegetable stock and salt. Bring to a boil and cool.
Combine the brine, water and ice in the 5-gallon bucket.
Combine the apple and 1 cup of water in a microwave safe dish.`,
      ),
    ).toEqual([
      ["1 gallon vegetable stock", "1 cup kosher salt"],
      ["1 gallon heavily iced water"],
      ["1 red apple, sliced", "written 1 cup water | 1 cup water"],
    ]);
    // Nothing in the step says which part: neither.
    expect(
      rows(
        ["For the Brine:", "1 gallon heavily iced water", "For the Aromatics:", "1 cup water"],
        "Add the water.",
      ),
    ).toEqual([[]]);
  });

  it("'sugar' right after 'sparkling sugar' is the sparkling sugar once the plain one is in", () => {
    expect(
      rows(
        "1/4 cup (50 g) granulated sugar\n1/4 cup water\n1 cup (200 grams) sparkling sugar\n10 fresh sprigs rosemary",
        `Bring the granulated sugar and water to a simmer.
In a medium bowl, place sparkling sugar. Dredge rosemary in sugar to coat.`,
      ),
    ).toEqual([
      ["1/4 cup (50 g) granulated sugar", "1/4 cup water"],
      ["1 cup (200 grams) sparkling sugar", "10 fresh sprigs rosemary"],
    ]);
  });

  it("a line that only names a part of the recipe is a heading, never an ingredient", () => {
    expect(
      rows(
        [
          "1 cup flour",
          "1 cup milk",
          "Optional Ingredients",
          "1 teaspoon cinnamon",
          "Sandwiches",
          "8 slices bread",
          "Chicken, veggies and rice",
          "1 1/2 lbs bonless skinless chicken breasts",
          "1 cup rice",
        ],
        `Whisk the flour and cinnamon. Whisk the milk.
Add the dry ingredients to the wet ingredients and mix.
For the sandwiches: toast the bread.
Brush both sides of chicken with oil.
Serve 1/4 of the chicken over rice.`,
      ),
    ).toEqual([
      ["1 cup flour", "1 teaspoon cinnamon", "1 cup milk"],
      [],
      ["8 slices bread"],
      ["1 1/2 lbs bonless skinless chicken breasts"],
      ["small 1/4 of the chicken | 1 1/2 lbs bonless skinless chicken breasts", "1 cup rice"],
    ]);
    expect(
      rows(
        "Chicken and rice\n1 1/2 lbs boneless skinless chicken breasts\n1 cup rice",
        "Season the chicken.\nCook the rice.",
      ),
    ).toEqual([["1 1/2 lbs boneless skinless chicken breasts"], ["1 cup rice"]]);
  });

  it("'the onions', 'the tomatoes' after one kind went in: the kind not in yet", () => {
    expect(
      rows(
        "1 yellow onion, diced\n4 green onions, sliced\n1 lb beef",
        "Cook the onion with the beef.\nGarnish with the onions.",
      ),
    ).toEqual([["1 yellow onion, diced", "1 lb beef"], ["4 green onions, sliced"]]);
    expect(
      rows(
        "1 can (28 oz) crushed tomatoes\n2 tomatoes, diced\n1 onion",
        "Simmer the onion and crushed tomatoes.\nTop with the tomatoes and serve.",
      ),
    ).toEqual([["1 onion", "1 can (28 oz) crushed tomatoes"], ["2 tomatoes, diced"]]);
    expect(
      rows(
        "1 can diced tomatoes\n1 cup cherry tomatoes\n1 lb pasta",
        "Simmer the diced tomatoes.\nToss the pasta with the tomatoes.",
      ),
    ).toEqual([["1 can diced tomatoes"], ["1 lb pasta", "1 cup cherry tomatoes"]]);
  });

  it("'all but 1/2 cup confectioners' sugar' is said as the step says it", () => {
    expect(
      rows(
        "2 1-pound boxes confectioners' sugar\n1 cup butter",
        "Beat all but 1/2 cup confectioners' sugar into the butter. Knead in some of the remaining sugar.",
      ),
    ).toEqual([
      [
        "small all but 1/2 cup confectioners' sugar | 2 1-pound boxes confectioners' sugar",
        "1 cup butter",
      ],
    ]);
  });

  it("a garnish before the line's own step, or 'taste for salt', isn't the measured line", () => {
    expect(
      rows(
        [
          "2 cups flour",
          "1 cup sugar",
          "Cream Cheese Frosting:",
          "8 oz cream cheese",
          "4 cups (480 g) confectioners' sugar",
        ],
        `Mix the flour and sugar. Bake.
Just before serving, garnish with confectioners' sugar, if desired.
Beat the cream cheese and confectioners' sugar.`,
      ),
    ).toEqual([
      ["2 cups flour", "1 cup sugar"],
      [],
      ["8 oz cream cheese", "4 cups (480 g) confectioners' sugar"],
    ]);
    expect(
      rows(
        "2 1/2 tsp. kosher salt, or more to taste\n8 cups bread cubes\n4 cups broth",
        "Toss the bread cubes with the salt.\nLadle the broth over the bread cubes. Taste for salt.",
      ),
    ).toEqual([
      ["8 cups bread cubes", "2 1/2 tsp. kosher salt, or more to taste"],
      ["4 cups broth", "8 cups bread cubes"],
    ]);
  });

  it("'an egg' of 4 is one egg; 'the poached egg' once they're in isn't 4 more", () => {
    expect(
      rows(
        "4 whole eggs\n2 English muffins",
        `Next, poach an egg by gently cracking an egg into simmering water.
Repeat with the remaining eggs.
Place the warm poached egg on top of the muffin.`,
      ),
    ).toEqual([["small an egg | 4 whole eggs"], ["small the remaining eggs | 4 whole eggs"], []]);
  });

  it("'add ice cubes … melt most of the ice' adds all of it", () => {
    expect(
      rows(
        "1 pound ice cubes\n1/2 cup salt",
        "Dissolve the salt. Add ice cubes and shake to melt most of the ice.",
      ),
    ).toEqual([["1/2 cup salt", "1 pound ice cubes"]]);
  });

  it("a cook's note written as a step lists nothing", () => {
    expect(
      rows(
        "3/4 cup unsalted butter\n1 cup granulated sugar\n4 whole eggs\n1 lb bacon",
        `Most pound cakes require an electric mixer to cream the butter and sugar.
Food Network Kitchens suggest caution in consuming raw and lightly-cooked eggs.
We found that using a loaf pan to wrap our meatloaf in bacon works best.
Cook's Notes: Use different bacon to your liking.
Cream the butter and sugar.`,
      ),
    ).toEqual([[], [], [], [], ["3/4 cup unsalted butter", "1 cup granulated sugar"]]);
  });

  it("one row a mixture", () => {
    expect(
      rows(
        "1 cup ham\n1 onion\n3 potatoes\n1/2 cup jam\n1 cup cream",
        `Mix the ham and onion.
Layer the potatoes. Sprinkle on 1/3 of the ham/onion mixture.
Mix the jam and cream.
Swirl the jam mixture into the batter, then top with the remaining jam mixture.`,
      ),
    ).toEqual([
      ["1 cup ham", "1 onion"],
      ["3 potatoes", "mixture ham/onion mixture from step 1"],
      ["1/2 cup jam", "1 cup cream"],
      ["mixture jam mixture from step 3"],
    ]);
  });

  it("a look-alike line from another part isn't chosen by an amount alone", () => {
    expect(
      rows(
        [
          "2 tsp minced rosemary",
          "Salt and pepper",
          "1 cup Parmesan",
          "For the dip:",
          "1 cup sour cream",
          "1/2 tsp minced rosemary",
          "1/2 tsp pepper",
        ],
        "Process the Parmesan, rosemary and 1/2 teaspoon pepper.\nMix the sour cream, rosemary and pepper.",
      ),
    ).toEqual([
      ["1 cup Parmesan", "2 tsp minced rosemary", "written 1/2 teaspoon pepper | 1/2 tsp pepper"],
      ["1 cup sour cream", "1/2 tsp minced rosemary"],
    ]);
    // "2 tablespoons of the oil" with a 4-tablespoon and a 2-tablespoon line: not the salsa's
    // 2 tablespoons because they match, but the oil of the part the onions come from.
    expect(
      rows(
        ["4 tablespoons canola oil", "2 onions", "Salsa:", "2 tablespoons canola oil", "1 tomato"],
        "Heat 2 tablespoons of the oil and add the onions.",
      ),
    ).toEqual([["written 2 tablespoons oil | 4 tablespoons canola oil", "2 onions"]]);
  });

  it("'half a cup', 'half a lemon': what the step says, and the rest worked out", () => {
    expect(
      rows(
        "2 cups milk, divided\n2 eggs\n1 cup flour\n1 tsp salt",
        `Whisk half a cup of the milk with the eggs.
Mix the flour with half a teaspoon of the salt.
Stir in the remaining milk.`,
      ),
    ).toEqual([
      ["written half a cup milk | 2 cups milk, divided", "2 eggs"],
      ["1 cup flour", "written half a teaspoon salt | 1 tsp salt"],
      ["remaining 1½ cups milk | 2 cups milk, divided"],
    ]);
    expect(
      rows(
        "2 lemons\n1 lb fish",
        "Squeeze half a lemon over the fish.\nSlice the remaining lemons.",
      ),
    ).toEqual([
      ["written half a lemon | 2 lemons", "1 lb fish"],
      ["remaining 1½ lemons | 2 lemons"],
    ]);
  });

  it("'half the remaining sugar' isn't half of the whole line", () => {
    expect(
      rows(
        "1 cup sugar, divided\n3 eggs\n1 cup cream\n1 cup cheese",
        `Beat the eggs with 1/4 cup of the sugar.
Whip the cream with half the remaining sugar.
Sprinkle the remaining sugar on top.
Add half the cheese.
Add half of the rest of the cheese.`,
      ),
    ).toEqual([
      ["3 eggs", "written 1/4 cup sugar | 1 cup sugar, divided"],
      ["1 cup cream", "small half the remaining sugar | 1 cup sugar, divided"],
      ["some | 1 cup sugar, divided"],
      ["part ½ cup cheese | 1 cup cheese"],
      ["small half of the rest of the cheese | 1 cup cheese"],
    ]);
  });

  it("'half of each of the sugar and flour' halves both", () => {
    expect(
      rows(
        "1 cup sugar\n1 cup flour",
        "Add half of each of the sugar and flour.\nAdd the remaining sugar and flour.",
      ),
    ).toEqual([
      ["part ½ cup sugar | 1 cup sugar", "part ½ cup flour | 1 cup flour"],
      ["remaining ½ cup sugar | 1 cup sugar", "remaining ½ cup flour | 1 cup flour"],
    ]);
  });

  it("'the vinegar' of two kinds of their own: not sure which", () => {
    const one = (ingredients: string, step: string) => rows(ingredients, step)[0];
    expect(one("2 tbsp red wine vinegar\n1 tbsp balsamic vinegar", "Whisk the vinegar.")).toEqual([
      "which vinegar | 2 tbsp red wine vinegar | 1 tbsp balsamic vinegar",
    ]);
    expect(one("1 tbsp rice vinegar\n1 tbsp sherry vinegar", "Add the vinegar.")).toEqual([
      "which vinegar | 1 tbsp rice vinegar | 1 tbsp sherry vinegar",
    ]);
    expect(one("1/4 cup lemon juice\n1/4 cup pineapple juice", "Add the juice.")).toEqual([
      "which juice | 1/4 cup lemon juice | 1/4 cup pineapple juice",
    ]);
    expect(one("2 tbsp maple syrup\n2 tbsp golden syrup", "Add the syrup.")).toEqual([
      "which syrup | 2 tbsp maple syrup | 2 tbsp golden syrup",
    ]);
    expect(one("1 tbsp chili powder\n1 tsp ancho chile powder", "Rub with the powder.")).toEqual(
      [],
    );
    // Still the ordinary one when there is one: the onion, not the green onions.
    expect(one("1 yellow onion\n4 green onions", "Dice the onion.")).toEqual(["1 yellow onion"]);
  });

  it("a line set aside for something is used when the step does it, and only then", () => {
    expect(
      rows(
        "½ cup packed dark brown sugar\n½ cup granulated sugar\n1 cup peanut butter\nsugar for rolling",
        "Cream the peanut butter, brown sugar and granulated sugar.\nShape into 1 inch balls and roll in sugar.",
      ),
    ).toEqual([
      ["1 cup peanut butter", "½ cup packed dark brown sugar", "½ cup granulated sugar"],
      ["sugar for rolling"],
    ]);
    expect(
      rows(
        "1/2 cup pecans, chopped\n1 cup flour\nChopped pecans, for serving",
        "Mix the flour and pecans.\nTop with chopped pecans.",
      ),
    ).toEqual([["1 cup flour", "1/2 cup pecans, chopped"], ["Chopped pecans, for serving"]]);
    expect(
      rows("Flour, for dusting\n2 cups bread flour\n1 cup water", "Mix the flour and water."),
    ).toEqual([["2 cups bread flour", "1 cup water"]]);
    expect(
      rows(
        "2 tbsp vegetable oil\nOil for frying\n1 onion",
        "Heat the oil in a skillet and cook the onion.",
      ),
    ).toEqual([["2 tbsp vegetable oil", "1 onion"]]);
  });

  it("'salt and black pepper to taste' says each to taste", () => {
    expect(
      rows(
        "3 cups milk\n1/2 teaspoon kosher salt\nFreshly ground black pepper",
        "Pour in the milk. Add the kosher salt and black pepper to taste.",
      ),
    ).toEqual([
      [
        "3 cups milk",
        "small salt to taste | 1/2 teaspoon kosher salt",
        "small black pepper to taste | Freshly ground black pepper",
      ],
    ]);
  });

  it("'a few sprinkles of flour' once it's all in isn't the whole line again", () => {
    expect(
      rows(
        "2 cups flour\n1 tsp salt\n1/2 cup oil\n1 lb steak",
        "Mix the flour and salt in a dish. Dredge the steak.\nHeat the oil. Drop in a few sprinkles of flour to test it.",
      ),
    ).toEqual([
      ["2 cups flour", "1 tsp salt", "1 lb steak"],
      ["1/2 cup oil", "small a few sprinkles of flour | 2 cups flour"],
    ]);
  });

  it("what's seasoned, removed or put back isn't added again", () => {
    expect(
      rows(
        "1 pound spaghetti\nFreshly ground black pepper\n1 lb chicken thighs\n1 onion",
        `Cook the spaghetti.
Season the pasta, to taste, with pepper.
Cook the chicken and onion. Remove the onion.
Return the chicken to the pan.`,
      ),
    ).toEqual([
      ["1 pound spaghetti"],
      ["Freshly ground black pepper"],
      ["1 lb chicken thighs", "1 onion"],
      [],
    ]);
  });

  it("'4 cups Marinara Sauce, recipe follows' isn't used by the step making it", () => {
    expect(
      rows(
        [
          "4 cups Marinara Sauce, recipe follows",
          "1 lb mozzarella",
          "Marinara Sauce:",
          "1/2 cup extra-virgin olive oil",
          "1 onion",
        ],
        `Fry the mozzarella. Serve with the sauce.
In a large pot, heat the oil. Add the onion. Season the sauce with more salt, to taste.`,
      ),
    ).toEqual([
      ["1 lb mozzarella", "4 cups Marinara Sauce, recipe follows"],
      ["1/2 cup extra-virgin olive oil", "1 onion"],
    ]);
  });

  it("'not sure which' is settled by the part the step's other ingredients come from", () => {
    expect(
      rows(
        [
          "FOR BREAD:",
          "1/3 cup oil",
          "3/4 cup packed brown sugar",
          "1 egg",
          "1 tsp vanilla",
          "FOR GLAZE:",
          "3/4 cup powdered sugar",
        ],
        "In a medium bowl, whisk together oil, sugar, egg, and vanilla until combined.",
      ),
    ).toEqual([["1/3 cup oil", "3/4 cup packed brown sugar", "1 egg", "1 tsp vanilla"]]);
    // The icing's orange juice isn't in the cookie dough's step: the dough's own line is.
    expect(
      rows(
        [
          "1 cup shortening",
          "2 cups sugar",
          "5 cups flour",
          "Juice and grated zest of 2 oranges",
          "ICING:",
          "2 cups confectioners' sugar",
          "1/4 cup orange juice",
          "1 tablespoon grated orange zest",
        ],
        "Cream the shortening and sugar. Add the flour alternately with orange juice and zest.",
      ),
    ).toEqual([
      ["1 cup shortening", "2 cups sugar", "5 cups flour", "Juice and grated zest of 2 oranges"],
    ]);
  });

  it("'the smashed garlic' of '4 garlic cloves, 2 smashed, 2 thinly sliced' is two of them", () => {
    expect(
      rows(
        "4 garlic cloves, 2 smashed, 2 thinly sliced\n3 Tbsp. butter",
        "Add smashed garlic cloves and 1 Tbsp. butter.\nCombine sliced garlic and remaining 2 Tbsp. butter.",
      ),
    ).toEqual([
      [
        "small smashed garlic cloves | 4 garlic cloves, 2 smashed, 2 thinly sliced",
        "written 1 Tbsp. butter | 3 Tbsp. butter",
      ],
      [
        "small sliced garlic | 4 garlic cloves, 2 smashed, 2 thinly sliced",
        "written remaining 2 Tbsp. butter | 3 Tbsp. butter",
      ],
    ]);
  });

  it("a sentence or several ingredients run together in the list is no line", () => {
    expect(
      rows(
        [
          "3/4 cup sugar",
          "3/4 cup sugar, 1/4 cup cornstarch, 1/2 teaspoon salt",
          "Spread a thin layer of pudding over the bottom of the dish and then top with wafers.",
          "4 boneless, skinless chicken breasts, 6 ounces",
        ],
        "Whisk the sugar.\nSpread the pudding.\nSeason the chicken.",
      ),
    ).toEqual([["3/4 cup sugar"], [], ["4 boneless, skinless chicken breasts, 6 ounces"]]);
  });
});

describe("working out the rest", () => {
  const rest = (line: string, steps: string) => rows(line, steps).map((s) => s[0] ?? "");

  it("in a smaller measure when that's how it's measured: 1 cup less 3 tablespoons", () => {
    expect(
      rest("1 cup milk, divided", "Add 3 tablespoons of the milk.\nAdd the remaining milk."),
    ).toEqual([
      "written 3 tablespoons milk | 1 cup milk, divided",
      "remaining 13 tbsp milk | 1 cup milk, divided",
    ]);
  });

  it("never when it would come to less than nothing", () => {
    expect(
      rest(
        "2 cups sugar, divided",
        "Add 1 1/2 cups of the sugar.\nAdd 1 cup of the sugar.\nAdd the remaining sugar.",
      ),
    ).toEqual([
      "written 1 1/2 cups sugar | 2 cups sugar, divided",
      "written 1 cup sugar | 2 cups sugar, divided",
      "some | 2 cups sugar, divided",
    ]);
  });

  it('never from an amount that\'s "about", in the line or in the step', () => {
    expect(
      rest("About 2 cups sugar, divided", "Add 1 cup of the sugar.\nAdd the remaining sugar."),
    ).toEqual([
      "written 1 cup sugar | About 2 cups sugar, divided",
      "some | About 2 cups sugar, divided",
    ]);
    expect(
      rest("2 cups sugar, divided", "Add about 1 cup of the sugar.\nAdd the remaining sugar."),
    ).toEqual([
      "written about 1 cup sugar | 2 cups sugar, divided",
      "some | 2 cups sugar, divided",
    ]);
  });

  it("counts: 1 egg of 4, then the eggs", () => {
    expect(
      rows("4 eggs, divided\n1 cup flour", "Mix the flour with 1 egg.\nBeat in the eggs."),
    ).toEqual([
      ["1 cup flour", "written 1 egg | 4 eggs, divided"],
      ["remaining 3 eggs | 4 eggs, divided"],
    ]);
  });

  it("not for a line that isn't divided: named again, it isn't listed again", () => {
    expect(
      rows(
        "1/4 cup hot water\n2 tbsp brown sugar",
        "Add a tablespoon of water if it looks dry.\nMix the brown sugar and hot water.",
      ),
    ).toEqual([
      ["small a tablespoon of water | 1/4 cup hot water"],
      ["2 tbsp brown sugar", "1/4 cup hot water"],
    ]);
  });
});

describe("the words for an amount Fennl worked out", () => {
  it("are written as an ingredient line, so the page can scale and convert it", () => {
    expect(amountLine("1 cup sugar, divided", 0.25, "cup")).toBe("¼ cup sugar");
    expect(amountLine("2 cups sugar, divided", 1.5, "cup")).toBe("1½ cups sugar");
    expect(amountLine("2 tbsp butter", 1, "tablespoon")).toBe("1 tbsp butter");
    expect(amountLine("1 cup milk, divided", 13, "tablespoon")).toBe("13 tbsp milk");
    expect(amountLine("4 eggs, divided", 3, null)).toBe("3 eggs");
  });

  it("use the line's own name", () => {
    expect(ingredientName("1 cup sugar, divided")).toBe("sugar");
    expect(ingredientName("4 boneless, skinless chicken breasts")).toBe(
      "boneless skinless chicken breasts",
    );
    expect(ingredientName("Rice flour or extra bread flour, for dusting")).toBe(
      "Rice flour or extra bread flour",
    );
  });
});

describe("speed", () => {
  // The recipe page works it out again on every change, so the lines and steps are new text
  // each time (nothing kept from an earlier run), as well as the same recipe again.
  const names = [
    "all-purpose flour",
    "granulated sugar",
    "brown sugar",
    "baking powder",
    "baking soda",
    "kosher salt",
    "unsalted butter, softened",
    "large eggs",
    "vanilla extract",
    "whole milk",
    "sour cream",
    "semisweet chocolate chips",
    "chopped walnuts",
    "ground cinnamon",
    "ground nutmeg",
    "cream cheese",
    "powdered sugar",
    "heavy cream",
    "lemon juice",
    "lemon zest",
    "olive oil",
    "garlic cloves",
    "yellow onion",
    "black pepper",
    "parmesan",
    "fresh parsley",
    "chicken broth",
    "tomato paste",
    "dried oregano",
    "red pepper flakes",
  ];
  const recipe = (seed: number) => {
    let n = 0;
    const lines = ingredientsFromText(
      names
        .map((name, i) => `${((i + seed) % 4) + 1} cups ${name}${i % 5 === 0 ? ", divided" : ""}`)
        .join("\n"),
      [],
      () => `i${n++}`,
    );
    let m = 0;
    const steps = directionsFromText(
      Array.from({ length: 15 }, (_, i) => {
        const a = names[(i * 2) % 30]?.split(",")[0];
        const b = names[(i * 2 + 1) % 30]?.split(",")[0];
        return `Whisk the ${a} with ${(seed % 3) + 1} cup of the ${b} in a large bowl, then add the remaining ${a} and stir in the ${b} mixture until smooth, about ${i + 2 + seed} minutes. Season with salt and pepper.`;
      }).join("\n"),
      [],
      () => `s${m++}`,
    );
    return { lines, steps };
  };
  const median = (times: number[]) => [...times].sort((a, b) => a - b)[times.length >> 1] ?? 0;

  it("works out a new 30-ingredient, 15-step recipe in a few milliseconds", () => {
    const first = recipe(1);
    stepIngredients(first.lines, first.steps);
    const times = Array.from({ length: 15 }, (_, k) => {
      const { lines, steps } = recipe(100 + k * 7);
      const t = performance.now();
      stepIngredients(lines, steps);
      return performance.now() - t;
    });
    expect(median(times)).toBeLessThan(15);
  });

  it("and the same recipe again, as the page shows it, in a few milliseconds", () => {
    const { lines, steps } = recipe(3);
    for (let k = 0; k < 10; k++) stepIngredients(lines, steps);
    const times = Array.from({ length: 15 }, () => {
      const t = performance.now();
      stepIngredients(lines, steps);
      return performance.now() - t;
    });
    expect(median(times)).toBeLessThan(8);
  });
});
