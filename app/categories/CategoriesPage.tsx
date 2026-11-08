import { useState, type CSSProperties, type FormEvent } from "react";
import { PageHeader } from "../pages/PageHeader";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import recipeStyles from "../recipes/recipes.module.css";
import { usePointer } from "../recipes/usePointer";
import { Link } from "../router";
import { canEdit } from "../sync/status";
import { activeSyncClient, useCategoryTree, useSyncStatus } from "../sync/useSync";
import styles from "./categories.module.css";
import {
  canMove,
  createCategory,
  deleteCategory,
  moveCategory,
  parsePath,
  pathKey,
  placeCategory,
  renameCategory,
  within,
  type CategoryNode,
  type CategoryTree,
  type PlanContext,
} from "./tree";
import { DoneBar } from "../ui/DoneBar";
import { useUndoable } from "./useUndoable";

// Categories (phase C7): the household's category tree, to add to, rename, move and delete.
// Every change can be undone from the bar at the top.
//
// On a laptop (U23, owner's choices 2026-11-07): the whole tree in one white box of rows; each
// row's buttons (↑ ↓, Rename, Move, Delete; quiet, with small icons) show on the row pointed at or
// holding the keyboard focus, and are always there for screen readers; Rename and Move open in the
// row itself, Save or Move the one filled button; Delete tints what goes ("Deleted too") and asks
// under it, a soft red Delete with the keyboard focus, then Cancel in plain words, as Trash does;
// what was done shows in the shared done bar beside the title, so the tree doesn't move. Phones,
// touch screens and windows under 900px keep the page as it was.

const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

const filterHref = (node: CategoryNode) => `/?category=${encodeURIComponent(node.path)}`;

/** Small icons beside the row's buttons, drawn on a laptop only. */
const ICONS = {
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  pen: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  move: "M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM10 13h6M13.5 10.5 16 13l-2.5 2.5",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v5M12 8h.01",
  warn: "M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01",
};
const ACTION_ICONS = { rename: ICONS.pen, move: ICONS.move, delete: LAPTOP_ICONS.trash };

function planContext(): PlanContext {
  return { me: activeSyncClient()?.userId ?? "", now: Date.now() };
}

type Mode = { kind: "rename" | "move" | "delete"; key: string } | null;

/** An element ID from a category's key. */
const domId = (prefix: string, key: string) =>
  `${prefix}-${encodeURIComponent(key).replace(/[^a-z0-9]/gi, "_")}`;

/**
 * Back to a button after its form closes. A renamed or moved category's button comes back under
 * a new ID once the tree is read again, so this waits a moment for it; when its row is gone,
 * focus goes to the new-category box.
 */
function refocus(id: string, tries = 30, fallback?: string) {
  requestAnimationFrame(() => {
    const target = document.getElementById(id);
    if (target && !(target as HTMLButtonElement).disabled) target.focus();
    else if (target && fallback) refocus(fallback, tries);
    else if (tries > 0) refocus(id, tries - 1, fallback);
    else document.getElementById("new-category")?.focus();
  });
}

function RenameForm({
  node,
  tree,
  laptop,
  onRename,
  onCancel,
}: {
  node: CategoryNode;
  tree: CategoryTree;
  laptop: boolean;
  onRename: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(node.name);
  const names = parsePath(name);
  const valid = names?.length === 1;
  const target = valid ? pathKey([...node.names.slice(0, -1), names[0] ?? ""]) : "";
  const joins = valid && target !== node.key && tree.byKey.has(target);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && names[0] !== node.name) onRename(names[0] ?? "");
    else onCancel();
  };
  const id = domId("rename", node.key);
  if (laptop) {
    // In the row itself: the name becomes a box, the count after it, Save and Cancel at the right,
    // and the note under the box names what it joins.
    const parent = node.names.at(-2);
    return (
      <form className={styles.rowForm} onSubmit={submit}>
        <label htmlFor={id} className="visually-hidden">
          New name for {node.name}
        </label>
        <input
          id={id}
          className={styles.input}
          value={name}
          autoFocus
          aria-describedby={`${id}-hint`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
        />
        <Count node={node} />
        <span className={styles.formButtons}>
          <button type="submit" className={styles.inkButton} disabled={!valid}>
            Save
          </button>
          <button type="button" className={styles.plainButton} onClick={onCancel}>
            Cancel
          </button>
        </span>
        <p id={`${id}-hint`} className={styles.rowHint}>
          {!valid ? (
            "A name can't be empty or contain › or >."
          ) : joins ? (
            <>
              <LaptopIcon path={ICONS.info} className={styles.hintIcon} />
              There&rsquo;s already a {tree.byKey.get(target)?.name ?? names[0]}{" "}
              {parent ? `in ${parent}` : "at the top level"}, so the two will show as one.
            </>
          ) : (
            ""
          )}
        </p>
      </form>
    );
  }
  return (
    <form className={styles.inline} onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        New name for {node.name}
      </label>
      <input
        id={id}
        className={styles.input}
        value={name}
        // Opened on purpose, so start in the box.
        autoFocus
        aria-describedby={`${id}-hint`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <button type="submit" className={recipeStyles.primary} disabled={!valid}>
        Save
      </button>
      <button type="button" className={recipeStyles.secondary} onClick={onCancel}>
        Cancel
      </button>
      <p id={`${id}-hint`} className={styles.hint}>
        {!valid
          ? "A name can't be empty or contain › or >."
          : joins
            ? `There's already a ${tree.byKey.get(target)?.name ?? names[0]} ${
                node.names.at(-2) ? `in ${node.names.at(-2)}` : "at the top level"
              }, so the two will show as one.`
            : ""}
      </p>
    </form>
  );
}

function MoveForm({
  node,
  tree,
  laptop,
  onMove,
  onCancel,
}: {
  node: CategoryNode;
  tree: CategoryTree;
  laptop: boolean;
  onMove: (target: CategoryNode | null) => void;
  onCancel: () => void;
}) {
  const targets = tree.nodes.filter((t) => canMove(node, t));
  const top = canMove(node, null);
  const [choice, setChoice] = useState(top ? "" : (targets[0]?.key ?? ""));
  const id = domId("move", node.key);
  if (laptop) {
    // In the row itself: the name and count, "Move into" and the places, Move and Cancel.
    const nowhere = !top && targets.length === 0;
    return (
      <form
        className={styles.rowForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!nowhere) onMove(choice ? (tree.byKey.get(choice) ?? null) : null);
        }}
      >
        <span className={styles.name}>{node.name}</span>
        <Count node={node} />
        {nowhere ? (
          <p className={styles.rowNote}>There&rsquo;s nowhere else to move it yet.</p>
        ) : (
          <>
            <label htmlFor={id} className={styles.formLabel}>
              Move<span className="visually-hidden"> {node.name}</span> into
            </label>
            <select
              id={id}
              className={styles.select}
              value={choice}
              autoFocus
              onChange={(e) => setChoice(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onCancel()}
            >
              {top ? <option value="">The top level</option> : null}
              {targets.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.path}
                </option>
              ))}
            </select>
          </>
        )}
        <span className={styles.formButtons}>
          {nowhere ? null : (
            <button type="submit" className={styles.inkButton}>
              Move
            </button>
          )}
          <button
            type="button"
            className={styles.plainButton}
            autoFocus={nowhere}
            onClick={onCancel}
          >
            Cancel
          </button>
        </span>
      </form>
    );
  }
  if (!top && targets.length === 0) {
    return (
      <div className={styles.inline}>
        <p className={styles.hint}>There&rsquo;s nowhere else to move it yet.</p>
        <button type="button" className={recipeStyles.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <form
      className={styles.inline}
      onSubmit={(e) => {
        e.preventDefault();
        onMove(choice ? (tree.byKey.get(choice) ?? null) : null);
      }}
    >
      <label htmlFor={id}>Move {node.name} into</label>
      <select
        id={id}
        className={recipeStyles.select}
        value={choice}
        autoFocus
        onChange={(e) => setChoice(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        {top ? <option value="">The top level</option> : null}
        {targets.map((t) => (
          <option key={t.key} value={t.key}>
            {t.path}
          </option>
        ))}
      </select>
      <button type="submit" className={recipeStyles.primary}>
        Move
      </button>
      <button type="button" className={recipeStyles.secondary} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function DeleteForm({
  node,
  laptop,
  depth,
  onDelete,
  onCancel,
}: {
  node: CategoryNode;
  laptop: boolean;
  /** How deep the category is (the laptop's indent, so the question sits under it). */
  depth: number;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const inside = within(node).length - 1;
  if (laptop) {
    // Under the category and what's inside it (tinted, "Deleted too"), so it's clear what goes.
    return (
      <div
        className={styles.deleteQuestion}
        style={{ "--depth": depth } as CSSProperties}
        role="group"
        aria-label={`Delete ${node.name}?`}
      >
        <LaptopIcon path={ICONS.warn} className={styles.warnIcon} />
        <p>
          <span className={styles.question}>
            Delete {node.name}
            {inside > 0
              ? ` and the ${inside} ${inside === 1 ? "category" : "categories"} inside it`
              : ""}
            ?
          </span>{" "}
          {node.count > 0 ? (
            <span className={styles.questionNote}>
              {recipesText(node.count)} will no longer be filed there; the recipes themselves stay.
            </span>
          ) : null}
        </p>
        <span className={styles.formButtons}>
          <button type="button" className={styles.deleteButton} autoFocus onClick={onDelete}>
            <LaptopIcon path={LAPTOP_ICONS.trash} />
            Delete
          </button>
          <button type="button" className={styles.plainButton} onClick={onCancel}>
            Cancel
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className={styles.inline} role="group" aria-label={`Delete ${node.name}?`}>
      <p className={styles.confirm}>
        Delete {node.name}
        {inside > 0
          ? ` and the ${inside} ${inside === 1 ? "category" : "categories"} inside it`
          : ""}
        ?{" "}
        {node.count > 0
          ? `${recipesText(node.count)} will no longer be filed there; the recipes themselves stay.`
          : ""}
      </p>
      <button type="button" className={recipeStyles.primary} autoFocus onClick={onDelete}>
        Delete
      </button>
      <button type="button" className={recipeStyles.secondary} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** A category's count, opening the recipe list filtered to it. */
function Count({ node }: { node: CategoryNode }) {
  return (
    <Link href={filterHref(node)} className={styles.count}>
      {recipesText(node.count)}
      <span className="visually-hidden"> in {node.path}</span>
    </Link>
  );
}

function Row({
  node,
  tree,
  mode,
  setMode,
  editable,
  act,
  laptop,
  depth = 0,
  doomed = false,
}: {
  node: CategoryNode;
  tree: CategoryTree;
  mode: Mode;
  setMode: (mode: Mode) => void;
  editable: boolean;
  act: (plan: ReturnType<typeof renameCategory>, message: string) => void;
  laptop: boolean;
  /** How deep it is: 0 at the top level (the laptop's indent). */
  depth?: number;
  /** A category above it is being asked about deleting (laptop: tinted, "Deleted too"). */
  doomed?: boolean;
}) {
  const here = mode?.key === node.key ? mode.kind : null;
  const cancel = () => {
    if (here) refocus(domId(here, `button-${node.key}`));
    setMode(null);
  };
  // Move up and Move down: the person's own order (U17), for the keyboard and phones, where
  // the left panel's dragging isn't offered.
  const siblings = node.parent ? node.parent.children : tree.roots;
  const at = siblings.indexOf(node);
  const step = (direction: "up" | "down") => {
    const before = direction === "up" ? siblings[at - 1] : (siblings[at + 2] ?? null);
    if (before === undefined) return;
    act(
      placeCategory(tree, node, { parent: node.parent, before }, planContext()),
      `Moved ${node.name} ${direction}.`,
    );
    const other = direction === "up" ? "down" : "up";
    refocus(domId(direction, `button-${node.key}`), 30, domId(other, `button-${node.key}`));
  };
  const goes = doomed || here === "delete";
  const inRow = laptop && (here === "rename" || here === "move");
  const renameForm =
    here === "rename" ? (
      <RenameForm
        node={node}
        tree={tree}
        laptop={laptop}
        onCancel={cancel}
        onRename={(name) => {
          act(renameCategory(node, name, planContext()), `Renamed ${node.name} to ${name}.`);
          refocus(domId("rename", `button-${pathKey([...node.names.slice(0, -1), name])}`));
          setMode(null);
        }}
      />
    ) : null;
  const moveForm =
    here === "move" ? (
      <MoveForm
        node={node}
        tree={tree}
        laptop={laptop}
        onCancel={cancel}
        onMove={(target) => {
          act(
            moveCategory(tree, node, target, planContext()),
            `Moved ${node.name} into ${target ? target.path : "the top level"}.`,
          );
          refocus(domId("move", `button-${pathKey([...(target?.names ?? []), node.name])}`));
          setMode(null);
        }}
      />
    ) : null;
  const deleteForm =
    here === "delete" ? (
      <DeleteForm
        node={node}
        laptop={laptop}
        depth={depth}
        onCancel={cancel}
        onDelete={() => {
          act(deleteCategory(tree, node, planContext()), `Deleted ${node.name}.`);
          refocus("new-category");
          setMode(null);
        }}
      />
    ) : null;
  return (
    <li className={laptop && goes ? styles.doomed : undefined}>
      <div
        className={`${styles.row} ${inRow ? styles.editing : ""}`}
        style={laptop ? ({ "--depth": depth } as CSSProperties) : undefined}
      >
        {inRow ? (
          (renameForm ?? moveForm)
        ) : (
          <>
            <span className={styles.name}>{node.name}</span>
            <Count node={node} />
            {laptop && doomed ? <span className={styles.tag}>Deleted too</span> : null}
          </>
        )}
        {here === null && !(laptop && doomed) ? (
          <span className={styles.actions}>
            {(["up", "down"] as const).map((direction) => (
              <button
                key={direction}
                id={domId(direction, `button-${node.key}`)}
                type="button"
                className={`${styles.small} ${styles.arrow}`}
                aria-label={`Move ${direction}: ${node.path}`}
                title={`Move ${direction}`}
                disabled={!editable || (direction === "up" ? at <= 0 : at >= siblings.length - 1)}
                onClick={() => step(direction)}
              >
                <span aria-hidden="true" className={styles.arrowText}>
                  {direction === "up" ? "↑" : "↓"}
                </span>
                <LaptopIcon path={ICONS[direction]} />
              </button>
            ))}
            <span className={styles.divider} aria-hidden="true" />
            {(["rename", "move", "delete"] as const).map((kind) => (
              <button
                key={kind}
                id={domId(kind, `button-${node.key}`)}
                type="button"
                className={styles.small}
                disabled={!editable}
                onClick={() => setMode({ kind, key: node.key })}
              >
                <LaptopIcon path={ACTION_ICONS[kind]} />
                {kind[0]?.toUpperCase() + kind.slice(1)}
                <span className="visually-hidden"> {node.path}</span>
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {inRow ? null : renameForm}
      {inRow ? null : moveForm}
      {laptop ? null : deleteForm}
      {node.children.length > 0 ? (
        <ul className={styles.tree}>
          {node.children.map((child) => (
            <Row
              key={child.key}
              node={child}
              tree={tree}
              mode={mode}
              setMode={setMode}
              editable={editable}
              act={act}
              laptop={laptop}
              depth={depth + 1}
              doomed={goes}
            />
          ))}
        </ul>
      ) : null}
      {laptop ? deleteForm : null}
    </li>
  );
}

function NewCategory({
  tree,
  editable,
  act,
  quiet,
}: {
  tree: CategoryTree;
  editable: boolean;
  act: (plan: ReturnType<typeof createCategory>, message: string) => Promise<boolean>;
  /** A row's Save or Move is the filled button for now (laptop): Add stays quiet words. */
  quiet: boolean;
}) {
  const [text, setText] = useState("");
  const names = parsePath(text);
  const exists = names !== null && tree.byKey.has(pathKey(names));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!names || exists) return;
    const path = names.join(" › ");
    if (await act(createCategory(tree, names, planContext()), `Added ${path}.`)) setText("");
  };
  return (
    <form className={styles.newForm} onSubmit={(e) => void submit(e)}>
      <div className={styles.field}>
        <label htmlFor="new-category">New category</label>
        <input
          id="new-category"
          className={styles.input}
          value={text}
          disabled={!editable}
          placeholder="Desserts > Cakes"
          aria-describedby="new-category-hint"
          onChange={(e) => setText(e.target.value)}
        />
        <p id="new-category-hint" className={styles.hint}>
          {exists
            ? "You already have that one."
            : "Use › or > for a category inside another: Desserts > Cakes."}
        </p>
      </div>
      <button
        type="submit"
        className={`${recipeStyles.primary} ${styles.addButton} ${quiet ? styles.quietAdd : ""}`}
        disabled={!editable || !names || exists}
      >
        <LaptopIcon path={LAPTOP_ICONS.plus} />
        Add
      </button>
    </form>
  );
}

export function CategoriesPage() {
  const tree = useCategoryTree();
  const editable = canEdit(useSyncStatus());
  const [mode, setMode] = useState<Mode>(null);
  const { done, failed, run, undo } = useUndoable();
  const laptop = usePointer();

  return (
    <div className={styles.categoriesPage}>
      <Link href="/" className={recipeStyles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Categories">
        <p>
          Sort recipes into categories, and categories inside categories. A recipe can be in as many
          as you like.
        </p>
      </PageHeader>
      {/* Beside the title on a laptop (the grid in categories.module.css), so nothing moves. */}
      <DoneBar
        message={
          failed ? "That couldn’t be saved just now. Please try again." : (done?.message ?? "")
        }
        problem={failed}
        onUndo={done && done.undo.length > 0 && !failed ? () => void undo() : null}
        undoDisabled={!editable}
        className={styles.undoBar}
        messageClassName={styles.doneWords}
        undoClassName={styles.undoButton}
      />
      {tree ? (
        <>
          <NewCategory
            tree={tree}
            editable={editable}
            act={run}
            quiet={laptop && (mode?.kind === "rename" || mode?.kind === "move")}
          />
          {tree.roots.length === 0 ? (
            <p className={styles.hint}>No categories yet.</p>
          ) : (
            <ul className={`${styles.tree} ${styles.top}`} aria-label="Your categories">
              {tree.roots.map((node) => (
                <Row
                  key={node.key}
                  node={node}
                  tree={tree}
                  mode={mode}
                  setMode={setMode}
                  editable={editable}
                  act={(plan, message) => void run(plan, message)}
                  laptop={laptop}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
