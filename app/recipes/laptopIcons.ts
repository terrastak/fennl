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
} as const;
