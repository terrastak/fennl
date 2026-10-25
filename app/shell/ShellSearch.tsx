import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { navigate } from "../navigation";
import styles from "./AppShell.module.css";
import { SearchIcon } from "./icons";

// Search from any screen (phase C13c): a field in the sidebar on a wide screen, and one that opens
// from the top bar on a phone. Searching takes you to the recipe list with those words searched.

export function ShellSearch({
  variant,
  onDone,
}: {
  variant: "side" | "top";
  /** Called after a search, or when the field is dismissed (the phone's field closes). */
  onDone?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words) return;
    // On the recipe list, the search joins what the list is already showing (a category, its
    // filters); from anywhere else it starts afresh.
    const params = new URLSearchParams(
      window.location.pathname === "/" ? window.location.search : "",
    );
    params.set("q", words);
    navigate(`/?${params.toString()}`);
    setText("");
    onDone?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onDone?.();
  };

  return (
    <form
      role="search"
      aria-label="Find a recipe"
      className={variant === "side" ? styles.sideSearch : styles.topSearch}
      onSubmit={submit}
      onKeyDown={onKeyDown}
    >
      <label htmlFor={id} className="visually-hidden">
        Find a recipe
      </label>
      <input
        id={id}
        type="search"
        data-shell-search={variant}
        className={styles.searchField}
        value={text}
        placeholder="Search your recipes"
        autoComplete="off"
        enterKeyHint="search"
        autoFocus={variant === "top"}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className={styles.searchGo} aria-label="Search">
        <SearchIcon />
      </button>
    </form>
  );
}
