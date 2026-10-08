import {
  emptyRecipeContent,
  type RecipeContent,
  type RecipeNutrition,
  type RecipeSource,
} from "../../shared/recipe";
import { directionsFromText, ingredientsFromText } from "../../shared/recipeLines";
import type { SyncChange } from "../../shared/sync";

// A few sample recipes to try Fennl with (phase C5). Written for Fennl, so they're free to use.
// They're ordinary recipes in the person's own account: edit or delete them like any other.

interface Sample {
  title: string;
  description: string;
  ingredients: string;
  directions: string;
  prep: number;
  cook: number;
  total: number;
  totalText?: string;
  servings: number | null;
  yield?: string;
  source: Partial<RecipeSource>;
  notes: string;
  difficulty: RecipeContent["difficulty"];
  nutrition?: RecipeNutrition;
  categories: string[][];
}

const SAMPLES: Sample[] = [
  {
    title: "Green Chile Stew",
    description: "The pot that comes out the first cold weekend of fall. Better the next day.",
    ingredients: `For the stew:
2 lb pork shoulder, cut into 1-inch cubes
1 tablespoon salt, divided
2 tablespoons vegetable oil
1 large onion, chopped
4 cloves garlic, minced
2 cups roasted green chiles, peeled and chopped
1 lb potatoes, peeled and diced
1 teaspoon ground cumin
6 cups chicken stock
To serve:
Warm flour tortillas
Shredded cheese`,
    directions: `Season the pork with half the salt. Brown it in the oil in a heavy pot, in batches, and set it aside.
Cook the onion in the same pot until soft, about 8 minutes. Add the garlic and cumin and stir for a minute.
Return the pork, add the chiles, potatoes, stock and the rest of the salt, and bring to a simmer.
Cover and simmer gently until the pork is tender, about 1½ hours. Taste for salt.
Serve with warm tortillas and cheese on the side.`,
    prep: 25,
    cook: 100,
    total: 125,
    servings: 6,
    source: { kind: "person", name: "Nana" },
    notes: "Freezes well for up to three months. Use mild or hot chiles, or half of each.",
    difficulty: "easy",
    categories: [["Mexican"], ["Soups"]],
  },
  {
    title: "Buttermilk Pancakes",
    description: "Tall, tender pancakes for Saturday mornings.",
    ingredients: `2 cups all-purpose flour
2 tablespoons sugar
2 teaspoons baking powder
½ teaspoon baking soda
½ teaspoon salt
2 cups buttermilk
2 large eggs
3 tablespoons butter, melted, plus more for the pan`,
    directions: `Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.
In another bowl, whisk the buttermilk, eggs and melted butter.
Pour the wet ingredients into the dry and stir just until combined. A few lumps are fine.
Heat a buttered pan over medium heat. Pour in ¼ cup of batter per pancake.
Flip when bubbles form on top and the edges look set, about 2 minutes, then cook 1 minute more.`,
    prep: 10,
    cook: 20,
    total: 30,
    servings: 4,
    yield: "about 12 pancakes",
    source: { kind: "other", name: "The Fennl kitchen" },
    notes:
      "No buttermilk? Stir 2 tablespoons of lemon juice into 2 cups of milk and wait 5 minutes.",
    difficulty: "easy",
    nutrition: {
      perServing: { calories: 420, fat: 14, carbohydrates: 60, protein: 13, sugar: 12 },
      text: null,
      source: "manual",
    },
    categories: [["Breakfast"]],
  },
  {
    title: "Black Bean Tacos with Lime Crema",
    description: "A weeknight dinner that's on the table in half an hour.",
    ingredients: `For the beans:
1 tablespoon olive oil
½ red onion, diced
2 cloves garlic, minced
1 teaspoon chili powder
2 cans (15 oz each) black beans, drained and rinsed
½ cup water
For the lime crema:
½ cup sour cream
Zest and juice of 1 lime
Pinch of salt
To serve:
8 corn tortillas, warmed
1 avocado, sliced
Cilantro and pickled onions`,
    directions: `Warm the oil in a skillet over medium heat. Cook the onion until soft, about 5 minutes.
Add the garlic and chili powder and stir for 30 seconds.
Add the beans and water. Simmer, mashing some of the beans, until thick, about 8 minutes.
Stir the sour cream, lime zest, lime juice and salt together.
Fill the tortillas with beans, avocado and cilantro, and spoon over the crema.`,
    prep: 10,
    cook: 20,
    total: 30,
    servings: 4,
    source: { kind: "other", name: "The Fennl kitchen" },
    notes: "",
    difficulty: "easy",
    categories: [["Mexican"], ["Diet", "Vegetarian"]],
  },
  {
    title: "Lemon Olive Oil Cake",
    description: "A plain, sunny cake that keeps for days.",
    ingredients: `1 cup sugar
Zest of 2 lemons
3 large eggs
¾ cup olive oil
¾ cup whole milk
¼ cup lemon juice
1½ cups all-purpose flour
2 teaspoons baking powder
½ teaspoon salt
Powdered sugar, for dusting`,
    directions: `Heat the oven to 350°F. Oil a 9-inch round cake pan and line it with parchment.
Rub the sugar and lemon zest together with your fingers until fragrant.
Whisk in the eggs, then the olive oil, milk and lemon juice.
Whisk the flour, baking powder and salt together, then fold them into the wet ingredients.
Bake until a toothpick comes out clean, 40 to 45 minutes.
Cool in the pan for 15 minutes, then turn out and dust with powdered sugar.`,
    prep: 15,
    cook: 45,
    total: 60,
    totalText: "plus cooling",
    servings: 10,
    yield: "one 9-inch cake",
    source: { kind: "other", name: "The Fennl kitchen" },
    notes: "Wrapped well, it keeps at room temperature for 3 days.",
    difficulty: "medium",
    categories: [["Desserts", "Cakes"]],
  },
];

const id = () => crypto.randomUUID();

/**
 * The changes that add the sample recipes, with their categories (owned by the person adding
 * them). Categories are made in order, parents first.
 */
export function sampleRecipeChanges(now = Date.now()): SyncChange[] {
  const changes: SyncChange[] = [];
  const categoryIds = new Map<string, string>();
  const category = (path: string[]): string => {
    const key = path.join("\u0000");
    const known = categoryIds.get(key);
    if (known) return known;
    const parentId = path.length > 1 ? category(path.slice(0, -1)) : null;
    const categoryId = id();
    categoryIds.set(key, categoryId);
    changes.push({
      kind: "category",
      id: categoryId,
      create: {},
      fields: { name: path[path.length - 1] ?? "", parentId, sortOrder: categoryIds.size },
      changedAt: now,
    });
    return categoryId;
  };

  for (const sample of SAMPLES) {
    const recipeId = id();
    changes.push({
      kind: "recipe",
      id: recipeId,
      create: { createdAt: new Date(now).toISOString(), import: null },
      fields: {
        ...emptyRecipeContent(),
        title: sample.title,
        description: sample.description,
        ingredients: ingredientsFromText(sample.ingredients),
        directions: directionsFromText(sample.directions),
        times: {
          prep: { minutes: sample.prep, text: null },
          cook: { minutes: sample.cook, text: null },
          total: { minutes: sample.total, text: sample.totalText ?? null },
        },
        servings: { count: sample.servings, yield: sample.yield ?? null },
        source: { kind: null, name: null, url: null, author: null, page: null, ...sample.source },
        notes: sample.notes,
        difficulty: sample.difficulty,
        nutrition: sample.nutrition ?? null,
      },
      changedAt: now,
    });
    for (const path of sample.categories) {
      changes.push({
        kind: "recipeCategory",
        recipeId,
        categoryId: category(path),
        deleted: false,
        changedAt: now,
      });
    }
  }
  return changes;
}

/** How many sample recipes there are. */
export const SAMPLE_COUNT = SAMPLES.length;
