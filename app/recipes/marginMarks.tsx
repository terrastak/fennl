import editor from "./editor.module.css";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";

// The marks in the margin of Ingredients and Directions in the editor on a laptop (U27).

/** The faded example an empty box shows in the editor on a laptop, with the marks it would get. */
const EXAMPLE: Record<"ingredients" | "directions", { text: string; heading?: true }[]> = {
  ingredients: [
    { text: "2 cups flour" },
    { text: "1 tsp salt" },
    { text: "For the glaze:", heading: true },
    { text: "1 cup powdered sugar" },
  ],
  directions: [
    { text: "Heat the oven to 350°F." },
    { text: "Mix the flour and salt in a large bowl." },
    { text: "Glaze", heading: true },
    { text: "Whisk the sugar with a little milk and spoon it over." },
  ],
};

/**
 * What the margin beside a line shows (U27): a step's number in a thin circle, the H of a
 * heading, the link mark of a linked line.
 */
export function MarginMark({
  list,
  heading,
  linked,
  number,
}: {
  list: "ingredients" | "directions";
  heading: boolean;
  linked: boolean;
  number: number | null;
}) {
  if (heading) return <span className={editor.headingMark}>H</span>;
  return (
    <>
      {linked ? <LaptopIcon path={LAPTOP_ICONS.link} className={editor.linkMark} /> : null}
      {list === "directions" && number !== null ? (
        <span className={editor.stepCircle}>{number}</span>
      ) : null}
    </>
  );
}

/** An empty box's faded example rows, with their marks; hidden from screen readers by the box. */
export function ExampleRows({ list }: { list: "ingredients" | "directions" }) {
  return EXAMPLE[list].map((example, i) => (
    <div
      key={i}
      className={editor.marginRow}
      data-example=""
      data-heading={example.heading ? "" : undefined}
    >
      <span className={editor.margin}>
        <MarginMark
          list={list}
          heading={example.heading ?? false}
          linked={false}
          number={EXAMPLE[list].slice(0, i + 1).filter((e) => !e.heading).length}
        />
      </span>
      {example.text}
    </div>
  ));
}
