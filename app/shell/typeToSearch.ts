// Type-to-search (U17): on the recipe list, typing when nothing else takes the letters puts them
// in the search box. The list hears the key; the search box showing takes the letter.

/** Asks the search box showing to take a typed letter. */
export const TYPE_EVENT = "fennl:type-search";

export function typeIntoSearch(char: string) {
  window.dispatchEvent(new CustomEvent(TYPE_EVENT, { detail: char }));
}

// "/" on a page with no search box showing (a phone-sized window with a keyboard) opens the
// recipe list, whose box then takes the focus. Asked for only briefly, so a list that opens much
// later never grabs the focus by surprise.
let searchFocusAsked = 0;

export function askSearchFocus() {
  searchFocusAsked = Date.now();
}

/** Whether "/" asked for the search box just now (and forgets it). */
export function takeSearchFocus(): boolean {
  const asked = Date.now() - searchFocusAsked < 3000;
  searchFocusAsked = 0;
  return asked;
}
