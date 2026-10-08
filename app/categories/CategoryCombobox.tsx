import { useId, useState, type KeyboardEvent } from "react";
import { parsePath, pathKey, type CategoryTree } from "./tree";
import styles from "./categories.module.css";

// Type to find a category, or to make a new one (phase C7). Arrow keys move through the list,
// Enter chooses, Escape closes it. A new category can be nested by typing "Desserts > Cakes".

interface Option {
  key: string;
  label: string;
  names: string[];
  isNew: boolean;
}

const MAX_OPTIONS = 50;

export function CategoryCombobox({
  tree,
  label,
  exclude = [],
  allowNew = true,
  disabled = false,
  onChoose,
}: {
  tree: CategoryTree;
  label: string;
  /** Category keys not to offer (those a recipe is already in). */
  exclude?: string[];
  allowNew?: boolean;
  disabled?: boolean;
  /** The chosen category's path, which may not exist yet. */
  onChoose: (names: string[]) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const typed = query.trim();
  const wanted = typed.toLocaleLowerCase();
  const left = new Set(exclude);
  const options: Option[] = tree.nodes
    .filter((node) => !left.has(node.key) && node.path.toLocaleLowerCase().includes(wanted))
    .slice(0, MAX_OPTIONS)
    .map((node) => ({ key: node.key, label: node.path, names: node.names, isNew: false }));
  const names = typed ? parsePath(typed) : null;
  if (allowNew && names && !tree.byKey.has(pathKey(names))) {
    options.push({
      key: `new:${pathKey(names)}`,
      label: `New category: ${names.join(" › ")}`,
      names,
      isNew: true,
    });
  }
  const shown = open && !disabled;
  const current = Math.min(active, options.length - 1);
  const optionId = (i: number) => `${id}-option-${i}`;

  const choose = (option: Option | undefined) => {
    if (!option) return;
    onChoose(option.names);
    setQuery("");
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (shown) choose(options[current]);
    } else if (event.key === "Escape") {
      if (shown) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <div className={styles.combobox}>
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        className={styles.input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown && options.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && options.length > 0 ? optionId(current) : undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        value={query}
        disabled={disabled}
        placeholder="Type to find or add"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <p id={`${id}-hint`} className={styles.hint}>
        {allowNew
          ? "Use › or > for a category inside another: Desserts > Cakes."
          : "Type to narrow the list."}
      </p>
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        className={styles.listbox}
        hidden={!shown || options.length === 0}
      >
        {options.map((option, i) => (
          <li
            key={option.key}
            id={optionId(i)}
            role="option"
            aria-selected={i === current}
            className={`${styles.option} ${option.isNew ? styles.optionNew : ""}`}
            // Keep focus in the box while choosing with a mouse or finger.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(option)}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
