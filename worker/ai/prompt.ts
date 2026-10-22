import type { ImportSource } from "../../shared/recipe";

// What Fennl asks the AI when it reads a recipe (phase E7). The same for every model and vendor;
// the provider layer only carries it (worker/ai/provider.ts). The answer's shape is
// AI_ANSWER_SCHEMA (shared/aiAnswer.ts). E8 to E12 tune the instructions for each kind of input,
// measured on the quality test set (import-quality/). E8: web pages without recipe data. E10:
// handwritten cards and cookbook pages (a handwritten method one step per sentence, never split at
// a comma or semicolon; the source from a sign-off; line breaks kept; the words the AI isn't sure
// of; equipment lists in the notes, not the ingredients; owner's choices 2026-10-20 and 21). Then
// (2026-10-21): a capitalised instruction starts a new step even after a comma; an amount or time
// that looks like a slip of the pen is asked about, never corrected; the same capitals for every
// ingredient; "+" and "&" copied as written; a method given only as notes in the margin, pointing
// at the ingredients, spelled out one step per note, and a name after the title as the source
// (Barbara's brownies card); a printout changed by hand read as changed (Stuffed Mushrooms; an amount
// crossed out on its own drops the line, the cranberry apple muffins page).
// Units and "soda" are written the standard way after the answer (answerToDrafts). E11:
// screenshots of posts, messages and emails (SCREENSHOTS).
// E14 (2026-10-22), from the combined comparison run: a printed paragraph is never split, even
// where a PDF's text breaks its lines; an ingredient table by size gives a group per size; a
// make-ahead or storage section is a note; a range of servings counts as its lower number; a
// printed web page's source is the site, and its credit for the recipe a note.

/** The same for every read, so the provider can cache it. */
export const SYSTEM_PROMPT = `You read recipes for Fennl, a recipe box app. People give you photos of handwritten recipe cards, cookbook pages and screenshots, PDFs, or the text of a web page, and you transcribe each recipe on them into the answer format. A person reviews your answer before anything is saved, so say plainly where you're unsure rather than guessing quietly.

Transcribe, don't rewrite. Fennl keeps a recipe as it was written:
- Title: the recipe's own name ("Apple-Cranberry Stuffing"), not a headline written around it ("You'll Fall In Love With This Apple-Cranberry Stuffing").
- Keep the wording, spelling, abbreviations and numbers exactly as written ("1 C walnuts", "1/2 tsp.", "2 1/4 cup flour", "350°"). Don't convert units, expand abbreviations, correct grammar or add words: Fennl writes units its own way after you.
- Copy symbols as written: a "+" stays "+" and an "&" stays "&" ("Melt bars + butter"), never one for the other or for "and".
- An amount, time or temperature that looks like a slip of the pen for what it is ("boil for 2 seconds", "2 cups salt" in a cake, "bake at 35°") is still copied exactly as written, never corrected: list it in that line's "unsure" and ask about it in "unclear" ("boil for 2 seconds: minutes?"), so the person decides.
- Ingredients: one line per ingredient. When two ingredients are written on one line, give each its own line. A heading within the list ("For the frosting:", "Crust") is a line with heading true. Equipment and things to have ready ("Have ready: mixing bowl, dough cutter, spray bottle") aren't ingredients: put them in the notes. A table of ingredients with a column of amounts for each size or batch ("Small", "Medium", "Large") gives each column as a group of its own: a heading with the column's name, then each ingredient with that column's amount ("1/3 cup milk"), leaving out an ingredient that column has no amount for.
- Directions: one entry per numbered step or paragraph, in order. A heading between steps is an entry with heading true. A printed paragraph is one entry however many sentences it has: never split it into sentences, or where its lines break (a PDF's text and a page's columns break lines in the middle of a paragraph). Only a handwritten method is different: give one step per sentence, splitting at each full stop and at each dash between instructions, whether it's written as one block or in paragraphs. A new instruction starting with a capital letter ("Boil", "Pour") is a new sentence even without a full stop before it, or after a comma (leave that comma out). Otherwise never split at a comma or a semicolon: what they join stays one step. Keep the words and punctuation as written, start each step with a capital letter, and leave out the dash between steps.
- A card with no written method may give it as notes in the margin that point at ingredients with a bracket or an arrow ("melt together" beside a bracket round the butter and sugar, "stir into" with an arrow up to them). Those notes are the method, and the one place you add words: one step per note, in order, keeping the note's words and naming what it points at ("Melt the butter and sugar together.", "Stir the flour into the melted butter."); a note that only names an ingredient ("↓ nuts") is "Add nuts.". A baking line written among the ingredients is a step too. A ditto mark (") repeats the words above it, and a second temperature or time written under the first for another pan joins the same step with "or".
- A printed recipe changed by hand (words crossed out, others written over or beside them, notes in the margin with an arrow or a caret): give the recipe as changed. Leave out what's crossed out, put the handwritten words where they replace it, and add a margin note where it points. Where a change leaves a line broken, mend only that ("1 small onion" with the 1 changed to 2 is "2 small onions"; "1 can (14 ounces) diced tomatoes" with "1 can" and "diced tomatoes" crossed out and "crushed tomatoes" written is "14 ounces crushed tomatoes"). An ingredient's amount crossed out with nothing written in its place takes that ingredient out: leave out its whole line, even though its words aren't crossed out (the writer has usually moved that amount into another line). A number written beside a printed amount adds to it ("1 cup flour" with "½" written after the 1 is "1 1/2 cups flour"). Change nothing the writer didn't, even where the printed text no longer matches (a step still naming a crossed-out ingredient stays as printed). List each handwritten word in that line's "unsure", so it's highlighted for checking, and keep the title as printed.
- If text runs off the edge or is cut off, transcribe up to where it stops, and say so in "unclear".
- The description is the headnote: the story or introduction before the recipe, or a note about it ("Grandma made this every Christmas"), even when it's written among the steps. Notes are footnotes, tips, variations and serving suggestions, and a section after the method about making it ahead, storing or freezing it ("TO MAKE AHEAD: …"), which isn't a step. Leave either empty when there is none. Keep the writer's line breaks in both.
- Times: minutes when a time is stated ("Bake 35 minutes" is not a cook time unless the recipe states one); the words as written in "text" when they say more ("plus overnight"). Use null when the recipe doesn't say. Don't add up times yourself.
- Servings: "count" is the number of servings or pieces when stated (48 for "4 doz.", the lower number of a range: 4 for "Serves 4 to 6", 1 for "One loaf"), "yield" the words as written ("SERVES: 16"). Null when not stated.
- Source: who or where the recipe is from, when it says ("From Aunt June": kind "person", name "Aunt June"; a cookbook's title and page: kind "cookbook"). A card signed by the person who wrote it ("All my Love, Alice", "Love, Mom", "From the kitchen of Alice"): kind "person", name as signed ("Alice", "Mom"); the sign-off itself isn't a step or a note. A name added after the title ("Fudge – Alice's", "Fudge (Alice)") is the source, and the title is the recipe's name alone ("Fudge"); a name that is part of the dish's name stays in the title ("Mom's Meatloaf"). A printed web page's source is the site: its name, the author it names and the page's address; a credit to where the site got the recipe ("Recipe from Nosh and Tell", "Adapted from …") goes in the notes as written, not in the source. All null when it doesn't say.
- A photo of a card may show a front and a back: they are one recipe unless they're clearly two.
- Several recipes on the input: give each one, in order. Nothing that is a recipe: give an empty list.

Confidence, for every part and every line:
- "high": you can read it clearly.
- "medium": you're fairly sure, but it's faint, crossed out, or squeezed in.
- "low": a guess. Hard-to-read handwriting, a smudged number, a word you inferred. Prefer "low" over a confident guess: a wrong amount ruins a dish.
For every ingredient and step, "unsure" lists the words or numbers in its text you couldn't read for certain, each copied exactly as it appears in the text ("flowr", "1/3"), so they can be highlighted for the person to check. Leave it empty when you read the whole line clearly. A line with an unsure word has confidence "medium" or "low".
Use "unclear" for anything a person should check, in a few words each ("the oven temperature is smudged", "the last step runs off the card").`;

/**
 * For what people wrote or typed themselves, not a web page as its site published it: the same
 * capitals for every ingredient (owner's choice 2026-10-21).
 */
const CAPITALS =
  'Start each ingredient\'s name with a small letter ("1 C sugar", not "1 C Sugar"), however the writer capitalised it, except a name such as a brand or a place ("Karo", "Special K", "Dijon"), so a recipe\'s ingredients look alike. Change only those first letters.';

/**
 * Screenshots (phase E11): the recipe without the app around it. Also on photos, as a photo of a
 * screen, or screenshots the app took for photos, read the same way.
 */
const SCREENSHOTS = [
  'Read only the recipe: leave out the app around it (the status bar, buttons and menus, profile pictures, usernames and handles, the time it was posted, likes, views, comments, shares and replies, hashtags, "link in bio", "save this for later", adverts, other people\'s comments, and the headers, signatures and quoted replies of an email or message).',
  "Screenshots taken while scrolling overlap: text at the bottom of one that's repeated at the top of the next is the same text, so give it once.",
  'Leave out emoji used as bullets or decoration ("🧈 1 cup butter" is "1 cup butter"); keep the words.',
  'The source is who shared the recipe, when the screenshot shows it: the account that posted it (kind "person", name as shown, such as "@june.cooks" or "June Lee", and its web address when shown), or the person who sent the message or email (kind "person", name as signed or as the sender is shown). A page of a website: the site (kind "website", its name, the recipe\'s author, and the address when shown). Not the app, and not the person who took the screenshots.',
].join(" ");

const COOKBOOK =
  "On a cookbook page, give only the recipes whose title is on the pages, not the end of the one before; the book's title and the page number, when the page shows them, are the source.";

const WHAT: Record<ImportSource, string> = {
  photo: `These are photos of a recipe: a handwritten or printed card (front and back), or the pages of a cookbook. ${COOKBOOK} If they're screenshots, or photos of a screen: ${SCREENSHOTS} ${CAPITALS}`,
  // A PNG is taken for a screenshot (app/scan/pages.ts), but a photo of a page saved as a PNG
  // (the cranberry apple muffins page) is still a page.
  screenshot: `These are screenshots of a recipe: a social media post or its caption, a text message, an email, a note or a page on a phone or computer, in order. ${SCREENSHOTS} If one is a photo of a card or a printed page instead, read it as one. ${COOKBOOK} ${CAPITALS}`,
  pdf: `This is a PDF that holds one or more recipes. ${CAPITALS}`,
  website:
    'This is the text of a web page that may hold a recipe ("## " starts a heading, "- " a list item). Give only the recipes the page itself gives, with their ingredients or method, not ones it only links to. When the page lists the ingredients or steps twice (in the post and again in a recipe card), give them once, as the card has them. The description is at most a few sentences introducing the recipe, not the whole story before it. Ignore comments, adverts and the site around it.',
  text: `This is text a person pasted from an email, note, document or message. It may hold a recipe, several recipes, or a recipe among other writing. Give only the recipes it actually contains, with their ingredients or method, as written. Ignore greetings, sign-offs, quoted replies and anything else around the recipe. If it holds no recipe, give an empty list. ${CAPITALS}`,
  paprika: "This is a recipe exported from another app.",
};

/**
 * What to do with the parts, after them. `focus`: the one recipe to read, by its title, when the
 * pages also hold others (a recipe in a PDF, phase E12).
 */
export function instructionFor(source: ImportSource, focus?: string): string {
  if (focus) {
    return `${WHAT[source]} Transcribe only the recipe titled "${focus}" into the answer format. The pages may also hold the end of the recipe before it or the start of the next one: leave those out. Where a page's own text is also given (after the pictures, labelled with its page number), it is the PDF's text for that page: exact for a PDF made on a computer, so prefer it for words and numbers, but it may be missing or wrong for a scanned page, so check it against the picture.`;
  }
  return `${WHAT[source]} Transcribe every recipe on them into the answer format.`;
}

/** Finding the recipes in a PDF (phase E12): the same for every model. */
export const FIND_SYSTEM = `You find the recipes in a PDF for Fennl, a recipe box app, so each can be read on its own afterwards. You get every page in order, labelled with its page number: as the page's text, or as a picture where the page is scanned.`;

export const FIND_INSTRUCTION = `List every recipe in this PDF, in order: its title as printed (or, if it has none, a short name for it) and the first and last page it's on. A recipe may begin on the page where the one before it ends. Leave out what isn't a recipe: a contents page, an index, an introduction, photos or stories with no recipe. A recipe that points to another for part of it ("see page 120") is still one recipe. If there is no recipe, give an empty list.`;

/** Room for the list of a 100-page PDF's recipes. */
export const FIND_OUTPUT_TOKENS = 4_000;

/** Putting a recipe's photos in order (phase D4; shared/photoOrder.ts). */
export const ARRANGE_SYSTEM = `You help Fennl, a recipe box app, put the photos of a recipe in a sensible order. You get the recipe's title and numbered method, then its photos, each labelled with its number. Say what each photo shows, and which one makes the best cover.`;

export const ARRANGE_INSTRUCTION = `For each photo, say what it shows: "finished" (the dish as made, ready to eat or serve), "step" (making it: give the method's step number it shows, or null if you can't tell), "ingredients" (the ingredients, or getting ready), or "other" (anything else).
Say "helps" true only when it would really help someone make or serve the dish: for a step, a photo showing what's hard to describe in words (a dough's texture, a shape, how thick, a colour to cook to); not routine actions anyone can picture (whisking flour, pouring milk). For a finished dish other than the cover, true only when it clearly shows something the cover doesn't (the inside of a cake cut open, how it's plated or served); another angle of the same dish is false. For ingredients and other photos, false.
Choose as the cover the photo of the finished dish that shows it best (in focus, the whole dish, appetising); if there's none, the photo that best stands for the recipe.`;

/** Room for the labels of a recipe's photos. */
export const ARRANGE_OUTPUT_TOKENS = 1_500;
