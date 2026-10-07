// Made-up recipes for the storage trial (phase C2): about the size and shape of real ones (2 to
// 3 KB of text, 24 to 33 ingredient lines and 7 to 10 steps), always the same for a given number.

const ADJECTIVES = [
  "Smoky",
  "Easy",
  "Weeknight",
  "Grandma's",
  "Spicy",
  "Lemony",
  "Crispy",
  "Slow-cooker",
  "Sheet-pan",
  "Creamy",
  "Roasted",
  "Grilled",
  "Herbed",
  "Golden",
  "Rustic",
  "Tex-Mex",
];
const MAINS = [
  "Chicken",
  "Pork",
  "Beef",
  "Salmon",
  "Shrimp",
  "Tofu",
  "Black Bean",
  "Mushroom",
  "Turkey",
  "Lentil",
  "Cauliflower",
  "Sweet Potato",
  "Halibut",
  "Chickpea",
];
const DISHES = [
  "Tacos",
  "Enchiladas",
  "Soup",
  "Stew",
  "Salad",
  "Pasta",
  "Casserole",
  "Fajitas",
  "Curry",
  "Stir-Fry",
  "Chili",
  "Bowls",
  "Skewers",
  "Pie",
  "Burgers",
  "Quesadillas",
];

const INGREDIENTS = [
  "2 tablespoons vegetable oil, divided",
  "1 medium onion, halved and sliced",
  "3 garlic cloves, minced",
  "1 teaspoon ground cumin",
  "¼ teaspoon ground cinnamon",
  "1 (14.5-ounce) can fire-roasted diced tomatoes",
  "½ cup chicken broth",
  "2 tablespoons minced canned chipotle chile in adobo sauce",
  "½ teaspoon brown sugar",
  "1 teaspoon grated lime zest plus 2 tablespoons juice",
  "12 (6-inch) corn tortillas, warmed",
  "1 avocado, halved, pitted, and cut into 1/2-inch pieces",
  "2 ounces Cotija cheese, crumbled (1/2 cup)",
  "6 scallions, minced",
  "Minced fresh cilantro",
  "Lime wedges",
  "1½  teaspoons dried oregano",
  "¾ -1 teaspoon chili powder",
  "½ - ¾ of a lemon, juiced",
  "S & P to taste",
  "1 - 2 cups cheddar cheese",
  "¼ cup + 3 tablespoons chili powder",
  "1 8 ounce can tomato sauce",
  "2 ripe Hass avocados",
  "1/2 jalapeño, including seeds (finely chopped)",
  "Kosher salt and freshly ground black pepper",
  "1 pint cherry tomatoes, halved",
  "4 pounds boneless pork butt roast, cut into 2-inch pieces",
  "3 tablespoons all-purpose flour",
  "2 cups chicken broth",
  "Sour cream",
  "8 ounces Monterey Jack cheese, shredded (2 cups)",
];

const STEPS = [
  "Pat the meat dry with paper towels and season with salt and pepper. Heat 1 tablespoon oil in a large Dutch oven over medium-high heat until shimmering. Brown on both sides, 3 to 4 minutes per side, then transfer to a large plate.",
  "Reduce heat to medium, add remaining oil, and heat until shimmering. Add onion and cook, stirring frequently, until browned, about 5 minutes. Add garlic, cumin, and cinnamon and cook until fragrant, about 1 minute.",
  "Add tomatoes, broth, chipotle and adobo sauce, and sugar and bring to boil, scraping up any browned bits. Return the meat to the pot, reduce heat to medium-low, cover, and simmer until tender, 15 to 20 minutes.",
  "Transfer cooking liquid to blender and process until smooth, 15 to 30 seconds. Return sauce to pot. Cook over medium heat, stirring frequently, until sauce is thickened, about 10 minutes.",
  "Stir in lime zest and juice. Season with salt and pepper to taste. Taste and adjust seasoning; it should be bright and a little smoky.",
  "Spoon into the center of each warm tortilla and serve, passing avocado, Cotija, scallions, cilantro, and lime wedges separately.",
  "Adjust oven rack to middle position and heat oven to 450 degrees. Spread 1/2 cup sauce in bottom of 13 by 9-inch baking dish and bake until bubbling, about 15 minutes.",
  "Let cool for 10 minutes before serving. Leftovers keep, covered, in the refrigerator for up to 3 days.",
];

/** A small, repeatable random number source, so the same recipe number gives the same recipe. */
function random(seed: number) {
  let state = seed * 2654435761 + 1;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

export interface SampleRecipe {
  id: string;
  title: string;
  ingredients: string;
  directions: string;
  notes: string;
}

export function sampleRecipe(n: number): SampleRecipe {
  const next = random(n + 1);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] as T;
  const lines = Array.from({ length: 24 + Math.floor(next() * 10) }, () => pick(INGREDIENTS));
  const steps = Array.from({ length: 7 + Math.floor(next() * 4) }, () => pick(STEPS));
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `${pick(ADJECTIVES)} ${pick(MAINS)} ${pick(DISHES)} ${n + 1}`,
    ingredients: lines.join("\n"),
    directions: steps.join("\n\n"),
    notes: "Made this for the family; next time add more lime.",
  };
}
