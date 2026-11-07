// The paths of the small icons shown beside words on a laptop only (U23; LaptopIcon.tsx).
export const LAPTOP_ICONS = {
  play: "M7 5v14l11-7z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  pen: "M4 20h4L19 9l-4-4L4 16z",
  plus: "M12 5v14M5 12h14",
  /** An arrow going on, for opening something (Surprise me's Open). */
  arrow: "M5 12h14M13 6l6 6-6 6",
  /** An arrow turning back, for Undo and Put back. */
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  /** Two crossing arrows, for another suggestion. */
  shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  /** A printer, for printing. */
  print:
    "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  /** A camera, for importing (as Import in the left panel). */
  import:
    "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  /** An arrow going round the other way, for Redo. */
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  /** An H, for making a line a section heading. */
  heading: "M6 4v16M18 4v16M6 12h12",
  /** Two links of a chain, for linking a recipe. */
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  /** A bin, for Trash and Remove. */
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  left: "M19 12H5M11 6l-6 6 6 6",
  right: "M5 12h14M13 6l6 6-6 6",
  /** A picture with a plus, for adding photos. */
  addPhoto:
    "M14 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6M10.6 10a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M21 17l-5-5-8 7M19 2v6M16 5h6",
  /** A star, filled, for the cover photo's tag. */
  star: "m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z",
  /** Rays, for something Fennl did by itself (arranging photos). */
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  /** A book, for a recipe in a list. */
  book: "M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h11",
  search: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5",
  /** A small chevron, pointing down (turned up when what it opens is open). */
  chevron: "m6 9 6 6 6-6",
  /** A cross, for taking something out. */
  x: "M6 6l12 12M18 6 6 18",
  /** A small chevron pointing right: a row that opens something. */
  chevronRight: "m9 6 6 6-6 6",
  /** An arrow out of a tray, for choosing a file to import. */
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  /** A globe, for a web page. */
  globe:
    "M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5",
  /** A clipboard, for pasting a recipe. */
  paste: "M7 4.5H5v16h14v-16h-2M9 4.5V3h6v3H9zM8.5 10h7M8.5 13.5h7M8.5 17h4",
  /** A page with "PDF" lines, for a PDF. */
  pdf: "M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5M8.5 12.5h7M8.5 16h7",
  /** A page of text, for a document file. */
  doc: "M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5M8.5 12.5h7M8.5 16h5",
  /** A pepper, for Paprika. */
  paprika:
    "M12.5 7c0-1.8 1-3 2.5-3.5M9 8.5c1.2-1.4 4.6-1.6 6.3.2 1.9 2 1.3 6.4-1.4 9.4-2 2.2-4.7 2.6-6 1.6-1.6-1.2-1-3.6.1-6 .9-2 .2-3.4 1-5.2",
  /** A wand with sparkles, for a quick tidy. */
  wand: "m4 20 11-11M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M13.5 7.5l3 3",
  /** A round arrow, for reading again. */
  again: "M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5",
  /** Two overlapping pages, for a possible duplicate. */
  copy: "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  /** Arrows going each way, for moving a line to the other list. */
  swap: "M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4",
  /** A link out of the page, for something that opens in a new tab. */
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
} as const;
