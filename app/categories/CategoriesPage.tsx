import { useState, type FormEvent } from "react";
import { PageHeader } from "../pages/PageHeader";
import recipeStyles from "../recipes/recipes.module.css";
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
  renameCategory,
  within,
  type CategoryNode,
  type CategoryTree,
  type PlanContext,
} from "./tree";
import { UndoBar } from "./UndoBar";
import { useUndoable } from "./useUndoable";

// Categories (phase C7): the household's category tree, to add to, rename, move and delete.
// Every change can be undone from the bar at the top.

const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

const filterHref = (node: CategoryNode) => `/?category=${encodeURIComponent(node.path)}`;

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
function refocus(id: string, tries = 30) {
  requestAnimationFrame(() => {
    const target = document.getElementById(id);
    if (target) target.focus();
    else if (tries > 0) refocus(id, tries - 1);
    else document.getElementById("new-category")?.focus();
  });
}

function RenameForm({
  node,
  tree,
  onRename,
  onCancel,
}: {
  node: CategoryNode;
  tree: CategoryTree;
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
            ? "There's already a category with that name here; they'll show as one."
            : ""}
      </p>
    </form>
  );
}

function MoveForm({
  node,
  tree,
  onMove,
  onCancel,
}: {
  node: CategoryNode;
  tree: CategoryTree;
  onMove: (target: CategoryNode | null) => void;
  onCancel: () => void;
}) {
  const targets = tree.nodes.filter((t) => canMove(node, t));
  const top = canMove(node, null);
  const [choice, setChoice] = useState(top ? "" : (targets[0]?.key ?? ""));
  const id = domId("move", node.key);
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
  onDelete,
  onCancel,
}: {
  node: CategoryNode;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const inside = within(node).length - 1;
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

function Row({
  node,
  tree,
  mode,
  setMode,
  editable,
  act,
}: {
  node: CategoryNode;
  tree: CategoryTree;
  mode: Mode;
  setMode: (mode: Mode) => void;
  editable: boolean;
  act: (plan: ReturnType<typeof renameCategory>, message: string) => void;
}) {
  const here = mode?.key === node.key ? mode.kind : null;
  const cancel = () => {
    if (here) refocus(domId(here, `button-${node.key}`));
    setMode(null);
  };
  return (
    <li>
      <div className={styles.row}>
        <span className={styles.name}>{node.name}</span>
        <Link href={filterHref(node)} className={styles.count}>
          {recipesText(node.count)}
          <span className="visually-hidden"> in {node.path}</span>
        </Link>
        {here === null ? (
          <span className={styles.actions}>
            {(["rename", "move", "delete"] as const).map((kind) => (
              <button
                key={kind}
                id={domId(kind, `button-${node.key}`)}
                type="button"
                className={styles.small}
                disabled={!editable}
                onClick={() => setMode({ kind, key: node.key })}
              >
                {kind[0]?.toUpperCase() + kind.slice(1)}
                <span className="visually-hidden"> {node.path}</span>
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {here === "rename" ? (
        <RenameForm
          node={node}
          tree={tree}
          onCancel={cancel}
          onRename={(name) => {
            act(renameCategory(node, name, planContext()), `Renamed ${node.name} to ${name}.`);
            refocus(domId("rename", `button-${pathKey([...node.names.slice(0, -1), name])}`));
            setMode(null);
          }}
        />
      ) : null}
      {here === "move" ? (
        <MoveForm
          node={node}
          tree={tree}
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
      ) : null}
      {here === "delete" ? (
        <DeleteForm
          node={node}
          onCancel={cancel}
          onDelete={() => {
            act(deleteCategory(tree, node, planContext()), `Deleted ${node.name}.`);
            refocus("new-category");
            setMode(null);
          }}
        />
      ) : null}
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
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function NewCategory({
  tree,
  editable,
  act,
}: {
  tree: CategoryTree;
  editable: boolean;
  act: (plan: ReturnType<typeof createCategory>, message: string) => Promise<boolean>;
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
        className={recipeStyles.primary}
        disabled={!editable || !names || exists}
      >
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

  return (
    <>
      <Link href="/" className={recipeStyles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Categories">
        <p>
          Sort recipes into categories, and categories inside categories. A recipe can be in as many
          as you like.
        </p>
      </PageHeader>
      <UndoBar done={done} failed={failed} onUndo={() => void undo()} disabled={!editable} />
      {tree ? (
        <>
          <NewCategory tree={tree} editable={editable} act={run} />
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
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </>
  );
}
