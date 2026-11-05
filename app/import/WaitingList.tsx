import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { IMPORT_RULES, type ImportJobSummary } from "../../shared/importJobs";
import { addBlockedBy } from "../../shared/limits";
import { addBlockedText } from "../limits/limitText";
import { reportRefused } from "../limits/reportRefused";
import { currentPhotoCache } from "../photos/usePhoto";
import recipes from "../recipes/recipes.module.css";
import { Link } from "../router";
import { activeSyncClient, useCategoryTree, useSyncStatus } from "../sync/useSync";
import { discardImportJob } from "./api";
import styles from "./import.module.css";
import { checkDraft, saveMany, savedText, type DraftStanding } from "./saveMany";

// The Import page's Waiting for review list (phases E12 and U19, mockup approved 2026-11-05).
// Each draft says where it stands as the list opens; the ready ones sit in their own box at the
// bottom. Save all ready, Save selected and Discard selected sit on the heading's line (on a phone,
// in a bar at the bottom of the screen). Save selected offers to save only the ready ones or all of
// them anyway; Discard goes at once with Undo, the drafts only removed when Undo's time is up.

/** The time a save is made (outside the component, which mustn't read the clock as it draws). */
const clock = () => Date.now();

/** How long Undo is offered after discarding. */
const UNDO_MS = 10_000;
/** Drafts checked at once as the list opens. */
const CHECKS_AT_ONCE = 4;

const LABEL: Record<Exclude<DraftStanding["standing"], "ready">, string> = {
  check: "Parts to check",
  duplicate: "May already be in your recipes",
  photos: "Photos to choose",
  blocked: "Open to finish",
};

/** Why Fennl would leave a draft for the person, in the Save selected question. */
const WHY: Record<"check" | "duplicate" | "photos", string> = {
  check: "has parts to check",
  duplicate: "may already be in your recipes",
  photos: "has photos to choose",
};

/** What saving anyway does with each, in "What 'save anyway' does". */
const ANYWAY: Record<"check" | "duplicate" | "photos", string> = {
  check: "saved as Fennl read it.",
  duplicate: "saved as a new recipe beside the one you have. Nothing is replaced.",
  photos: "saved with Fennl’s cover photo only.",
};

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", `${n}`));

/** "cakes.example.com", for a draft's page. */
function site(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A draft's check: done, still running, or not possible just now (offline). */
type Checked = DraftStanding | "checking" | "unknown";

type Held = ImportJobSummary & { why: "check" | "duplicate" | "photos" };

interface Ask {
  ready: ImportJobSummary[];
  held: Held[];
  blocked: ImportJobSummary[];
}

interface Note {
  text: string;
  problem: boolean;
  undo?: () => void;
}

interface Pending {
  jobs: ImportJobSummary[];
  timer: ReturnType<typeof setTimeout>;
}

export function WaitingList(props: {
  jobs: ImportJobSummary[];
  /** Changes the page's list of drafts (removing saved or discarded ones, or putting them back). */
  update: (change: (before: ImportJobSummary[]) => ImportJobSummary[]) => void;
  /** Something else on the page is reading a recipe. */
  reading: boolean;
}) {
  const { jobs, update, reading } = props;
  const status = useSyncStatus();
  const tree = useCategoryTree();
  const premium = status.photos?.enabled ?? false;
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [checked, setChecked] = useState<{ premium: boolean; map: Map<string, Checked> }>(() => ({
    premium,
    map: new Map(),
  }));
  const [saving, setSaving] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  /** The next note is read out and focused (not when Undo's time runs out). */
  const focusNote = useRef(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<Pending | null>(null);
  const running = useRef(new Set<string>());
  const premiumNow = useRef(premium);
  const updateRef = useRef(update);

  useEffect(() => {
    premiumNow.current = premium;
    updateRef.current = update;
  });

  // Checks are kept per plan: photos to choose only count where photos can be kept.
  const standings = useMemo(
    () => (checked.premium === premium ? checked.map : new Map<string, Checked>()),
    [checked, premium],
  );
  const standingOf = (id: string): Checked => standings.get(id) ?? "checking";

  // Each draft is checked once as the list opens, a few at a time, once the device's copy (which
  // the duplicate check reads) is open.
  useEffect(() => {
    if (!tree) return;
    const todo = jobs.filter((j) => !standings.has(j.id) && !running.current.has(j.id));
    if (todo.length === 0) return;
    const forPremium = premium;
    for (const job of todo) running.current.add(job.id);
    const next = async () => {
      for (let job = todo.shift(); job; job = todo.shift()) {
        const found = await checkDraft(job.id, forPremium);
        running.current.delete(job.id);
        if (premiumNow.current !== forPremium) continue;
        if (found === null) {
          const gone = job.id;
          updateRef.current((before) => before.filter((j) => j.id !== gone));
          continue;
        }
        const id = job.id;
        setChecked((before) => {
          const map = new Map(before.premium === forPremium ? before.map : []);
          map.set(id, found ?? "unknown");
          return { premium: forPremium, map };
        });
      }
    };
    for (let i = 0; i < CHECKS_AT_ONCE; i++) void next();
  }, [jobs, standings, tree, premium]);

  const say = (next: Note | null) => {
    focusNote.current = next !== null;
    setNote(next);
  };
  useEffect(() => {
    if (!note || !focusNote.current) return;
    focusNote.current = false;
    noteRef.current?.focus();
  }, [note]);
  useEffect(() => {
    if (ask) askRef.current?.focus();
  }, [ask]);

  /** Drafts back in the list, in the order they were in. */
  const putBack = (back: ImportJobSummary[]) => {
    const ids = new Set(back.map((j) => j.id));
    update((before) =>
      [...before.filter((j) => !ids.has(j.id)), ...back].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  };

  /** Discards waiting for Undo's time go through now (also when the page is left). */
  const settle = () => {
    const waiting = pending.current;
    if (!waiting) return;
    pending.current = null;
    clearTimeout(waiting.timer);
    setNote((before) => (before?.undo ? { text: before.text, problem: before.problem } : before));
    void Promise.all(waiting.jobs.map((job) => discardImportJob(job.id, true))).then((done) => {
      const failed = waiting.jobs.filter((_, i) => !done[i]);
      if (failed.length === 0) return;
      putBack(failed);
      say({
        text: `${count(failed.length, "1 draft", "# drafts")} couldn’t be discarded just now, so ${failed.length === 1 ? "it’s" : "they’re"} back in the list. Please try again.`,
        problem: true,
      });
    });
  };
  const settleRef = useRef(settle);
  useEffect(() => {
    settleRef.current = settle;
  });
  useEffect(() => {
    const leave = () => settleRef.current();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  const busy = reading || saving !== null || ask !== null;
  const readyJobs = jobs.filter((j) => {
    const s = standingOf(j.id);
    return typeof s === "object" && s.standing === "ready";
  });
  const lookJobs = jobs.filter((j) => !readyJobs.includes(j));
  const picked = jobs.filter((j) => chosen.has(j.id));

  const choose = (next: Set<string>) => {
    settle();
    say(null);
    setChosen(next);
  };

  /** Saves drafts: `anyway`, those the person said to save even though Fennl would leave them. */
  const run = async (list: ImportJobSummary[], anyway: ReadonlySet<string> = new Set()) => {
    settle();
    setAsk(null);
    const usage = status.usage;
    const blocked = usage ? addBlockedBy(usage) : null;
    if (usage && blocked) {
      say({ text: addBlockedText(blocked, usage), problem: true });
      reportRefused(blocked, "import");
      return;
    }
    const me = activeSyncClient()?.userId;
    if (!tree || !me || list.length === 0) return;
    say(null);
    const result = await saveMany({
      jobs: list,
      anyway,
      tree,
      me,
      premium,
      photoLimits: {
        maxPerRecipe: status.photos?.maxPerRecipe ?? null,
        maxFileBytes: status.photos?.maxFileBytes ?? null,
      },
      cache: currentPhotoCache(),
      now: clock,
      onProgress: (done, total) =>
        setSaving(done < total ? `Saving ${done + 1} of ${total}…` : "Saving…"),
    });
    setSaving(null);
    const saved = new Set(result.saved);
    update((before) => before.filter((job) => !saved.has(job.id)));
    // Anything left for a reason its label didn't say is checked again.
    const recheck = result.left.map((l) => l.id);
    setChecked((before) => {
      const map = new Map(before.map);
      for (const id of recheck) map.delete(id);
      return { premium: before.premium, map };
    });
    setChosen(new Set());
    say({ text: savedText(result), problem: result.saved.length === 0 });
  };

  /** Save selected: at once when every chosen draft is ready, otherwise asks first. */
  const saveChosen = () => {
    settle();
    const ready: ImportJobSummary[] = [];
    const held: Held[] = [];
    const blocked: ImportJobSummary[] = [];
    for (const job of picked) {
      const s = standingOf(job.id);
      if (typeof s !== "object" || s.standing === "ready") ready.push(job);
      else if (s.standing === "blocked") blocked.push(job);
      else held.push({ ...job, why: s.standing });
    }
    if (held.length === 0 && blocked.length === 0) {
      void run(ready);
      return;
    }
    say(null);
    setAsk({ ready, held, blocked });
  };

  const discard = () => {
    settle();
    const gone = picked;
    const wasChosen = new Set(chosen);
    const ids = new Set(gone.map((j) => j.id));
    update((before) => before.filter((j) => !ids.has(j.id)));
    setChosen(new Set());
    const timer = setTimeout(() => settleRef.current(), UNDO_MS);
    pending.current = { jobs: gone, timer };
    say({
      text: `Discarded ${count(gone.length, "1 draft", "# drafts")}.`,
      problem: false,
      undo: () => {
        if (pending.current?.jobs !== gone) return;
        clearTimeout(pending.current.timer);
        pending.current = null;
        putBack(gone);
        setChosen(wasChosen);
        say({ text: `Put back ${count(gone.length, "1 draft", "# drafts")}.`, problem: false });
      },
    });
  };

  if (jobs.length === 0 && !note && !saving) return null;

  const saveReadyLabel =
    readyJobs.length === 1 ? "Save the ready one" : `Save all ${readyJobs.length} ready`;
  const nothingChosen = chosen.size === 0;

  const row = (job: ImportJobSummary) => {
    const s = standingOf(job.id);
    const on = chosen.has(job.id);
    return (
      <li key={job.id} data-chosen={on || undefined}>
        <input
          type="checkbox"
          className={styles.chooseBox}
          aria-label={`Select ${job.title}`}
          checked={on}
          disabled={busy}
          onChange={(event) => {
            const next = new Set(chosen);
            if (event.currentTarget.checked) next.add(job.id);
            else next.delete(job.id);
            choose(next);
          }}
        />
        <span className={styles.jobText}>
          <Link href={`/import/${job.id}`}>{job.title}</Link>
          <span className={recipes.hint}>
            {[site(job.url), new Date(job.createdAt).toLocaleDateString()]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {s === "checking" ? (
            <span className={styles.tag} data-kind="checking">
              Checking…
            </span>
          ) : typeof s === "object" && s.standing !== "ready" ? (
            <span className={styles.tag} data-kind={s.standing}>
              {LABEL[s.standing]}
              {s.detail ? `: ${s.detail}` : ""}
            </span>
          ) : null}
        </span>
      </li>
    );
  };

  const buttons = (phone: boolean) => (
    <>
      {readyJobs.length > 0 ? (
        <button
          type="button"
          className={recipes.primary}
          disabled={busy || !tree}
          onClick={() => void run(readyJobs)}
        >
          {saveReadyLabel}
        </button>
      ) : null}
      <button
        type="button"
        className={recipes.secondary}
        disabled={busy || nothingChosen || !tree}
        onClick={saveChosen}
      >
        Save{phone ? <span className="visually-hidden"> selected</span> : " selected"}
      </button>
      <button
        type="button"
        className={`${recipes.secondary} ${styles.discard}`}
        disabled={busy || nothingChosen}
        onClick={discard}
      >
        Discard{phone ? <span className="visually-hidden"> selected</span> : " selected"}
      </button>
    </>
  );

  return (
    <section
      className={`${styles.section} ${styles.waiting}`}
      aria-labelledby="import-waiting-title"
    >
      <div className={styles.waitingHead}>
        <h2 id="import-waiting-title">Waiting for review</h2>
        {jobs.length > 0 ? <div className={styles.waitingButtons}>{buttons(false)}</div> : null}
      </div>

      {saving ? (
        <p role="status" className={recipes.hint}>
          {saving}
        </p>
      ) : null}
      {note ? (
        <p
          ref={noteRef}
          tabIndex={-1}
          role={note.problem ? "alert" : "status"}
          className={`${styles.waitingNote} ${note.problem ? styles.problem : ""}`}
        >
          <span>{note.text}</span>
          {note.undo ? (
            <button type="button" className={recipes.textButton} onClick={note.undo}>
              Undo
            </button>
          ) : null}
        </p>
      ) : null}

      {jobs.length > 0 ? (
        <div className={styles.selectLine}>
          <button
            type="button"
            className={recipes.textButton}
            disabled={busy || chosen.size === jobs.length}
            onClick={() => choose(new Set(jobs.map((j) => j.id)))}
          >
            Select all
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className={recipes.textButton}
            disabled={busy || nothingChosen}
            onClick={() => choose(new Set())}
          >
            Select none
          </button>
          <span className={recipes.hint} aria-live="polite">
            {chosen.size} of {jobs.length} selected
          </span>
        </div>
      ) : (
        <p className={recipes.hint}>Nothing else is waiting.</p>
      )}

      {ask ? <AskSave ask={ask} buttonRef={askRef} run={run} cancel={() => setAsk(null)} /> : null}

      {lookJobs.length > 0 ? (
        <div className={styles.group} role="group" aria-labelledby="import-look-title">
          <h3 id="import-look-title" className={styles.groupTitle}>
            To look at <span className={styles.groupCount}>{lookJobs.length}</span>
          </h3>
          <ul className={styles.jobs}>{lookJobs.map(row)}</ul>
        </div>
      ) : null}

      {readyJobs.length > 0 ? (
        <div
          className={`${styles.group} ${styles.readyBox}`}
          role="group"
          aria-labelledby="import-ready-title"
        >
          <h3 id="import-ready-title" className={styles.groupTitle}>
            <span className={styles.readyDot} aria-hidden="true" />
            Ready to save <span className={styles.groupCount}>{readyJobs.length}</span>
          </h3>
          <p className={recipes.hint}>Nothing to check. Each will be saved as Fennl read it.</p>
          <ul className={styles.jobs}>{readyJobs.map(row)}</ul>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <p className={recipes.hint}>
          Open a draft to check it and save it, or select several to save or discard them at once.
          <br />
          Drafts you don&rsquo;t save are removed after {IMPORT_RULES.keepDays} days.
        </p>
      ) : null}

      {jobs.length > 0 ? <div className={styles.phoneBar}>{buttons(true)}</div> : null}
    </section>
  );
}

/** "Save 4 recipes?": the ready ones, or all of them anyway. */
function AskSave(props: {
  ask: Ask;
  buttonRef: RefObject<HTMLButtonElement | null>;
  run: (list: ImportJobSummary[], anyway?: ReadonlySet<string>) => Promise<void>;
  cancel: () => void;
}) {
  const { ask, buttonRef, run, cancel } = props;
  const { ready, held, blocked } = ask;
  const total = ready.length + held.length + blocked.length;
  const all = ready.length + held.length;
  const these = count(held.length, "this one", "these #");
  return (
    <div className={styles.ask} role="group" aria-labelledby="import-ask-title">
      <h3 id="import-ask-title" className={styles.smallTitle}>
        Save {count(total, "1 recipe", "# recipes")}?
      </h3>
      {held.length > 0 ? (
        <>
          <p>
            {ready.length > 0 ? `${count(ready.length, "1 is", "# are")} ready. ` : ""}
            Fennl would leave {these} for you to look at first:
          </p>
          <ul className={styles.askList}>
            {held.map((job) => (
              <li key={job.id}>
                <strong>{job.title}</strong> <span className={recipes.hint}>{WHY[job.why]}.</span>
              </li>
            ))}
          </ul>
          <details>
            <summary>What &ldquo;save anyway&rdquo; does</summary>
            <ul className={styles.askList}>
              {held.map((job) => (
                <li key={job.id}>
                  <strong>{job.title}</strong>: {ANYWAY[job.why]}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      {blocked.length > 0 ? (
        <p className={recipes.hint}>
          {blocked.map((job) => job.title).join(", ")}{" "}
          {blocked.length === 1
            ? "can’t be saved either way: it isn’t"
            : "can’t be saved either way: they aren’t"}{" "}
          finished. Open {blocked.length === 1 ? "it" : "them"} to finish.
        </p>
      ) : null}
      <div className={styles.askButtons}>
        {ready.length > 0 ? (
          <button
            ref={buttonRef}
            type="button"
            className={recipes.primary}
            onClick={() => void run(ready)}
          >
            Save the {count(ready.length, "ready one", "# ready ones")}
          </button>
        ) : null}
        {held.length > 0 ? (
          <button
            ref={ready.length > 0 ? undefined : buttonRef}
            type="button"
            className={recipes.secondary}
            onClick={() => void run([...ready, ...held], new Set(held.map((job) => job.id)))}
          >
            {ready.length > 0
              ? `Save all ${all} anyway`
              : `Save ${count(held.length, "it", "them")} anyway`}
          </button>
        ) : null}
        <button
          ref={ready.length === 0 && held.length === 0 ? buttonRef : undefined}
          type="button"
          className={recipes.textButton}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
