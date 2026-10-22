import { useEffect, useState } from "react";
import type { RecipeVersion } from "../../shared/versions";
import type { RecipeDetail } from "../sync/dbProtocol";
import { saveChanges } from "../sync/useSync";
import { recipeVersions, settleVersion } from "./versionsApi";
import { restoreChanges, versionDifferences } from "./versions";
import styles from "./recipes.module.css";

// "Updated from Paprika" (phase E13; owner's choice 2026-10-21): when importing again changed
// this recipe, the version it had was kept. The recipe page says so, until someone in the
// household chooses: compare the two, keep this version, or put the earlier one back.

/** The time a change is made (outside the component, which mustn't read the clock as it draws). */
const clock = () => Date.now();

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export function EarlierVersion({
  detail,
  me,
  editable,
}: {
  detail: RecipeDetail;
  me: string;
  editable: boolean;
}) {
  const { recipe } = detail;
  const fromPaprika = recipe.import?.source === "paprika";
  const [version, setVersion] = useState<RecipeVersion | null>(null);
  const [comparing, setComparing] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!fromPaprika) return;
    let live = true;
    void recipeVersions(recipe.id).then((found) => {
      if (live) setVersion(found.find((v) => v.reason === "paprika_update") ?? null);
    });
    return () => {
      live = false;
    };
  }, [fromPaprika, recipe.id, recipe.import?.externalHash]);

  if (!version) return null;
  const mine = detail.opinions.find((o) => o.userId === me) ?? null;
  const differences = versionDifferences(recipe, version, mine, me);

  const decide = async (putBack: boolean) => {
    setWorking(true);
    setFailed(false);
    if (putBack) {
      const changes = restoreChanges(recipe.id, recipe, version, mine, me, clock());
      if (changes.length > 0 && !(await saveChanges(changes))) {
        setWorking(false);
        setFailed(true);
        return;
      }
    }
    const settled = await settleVersion(recipe.id, version.id);
    setWorking(false);
    if (settled) setVersion(null);
    else setFailed(true);
  };

  return (
    <section className={styles.versionNotice} aria-labelledby="earlier-version-title">
      <h2 id="earlier-version-title" className={styles.versionTitle}>
        Updated from Paprika
      </h2>
      <p>
        Importing from Paprika on {dateText(version.createdAt)} brought in a newer version of this
        recipe. The version from before is kept until you choose which one to keep.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          aria-expanded={comparing}
          aria-controls="earlier-version-compare"
          onClick={() => setComparing((open) => !open)}
        >
          {comparing ? "Hide the comparison" : "Compare"}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={working}
          onClick={() => void decide(false)}
        >
          Keep this version
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={working || !editable}
          onClick={() => void decide(true)}
        >
          Put the earlier version back
        </button>
      </div>
      {failed ? (
        <p role="alert" className={styles.hint}>
          That didn&rsquo;t go through. Check the connection and try again.
        </p>
      ) : null}
      {comparing ? (
        <div id="earlier-version-compare">
          {differences.length === 0 ? (
            <p className={styles.hint}>The two versions read the same.</p>
          ) : (
            <dl className={styles.versionCompare}>
              {differences.map((d) => (
                <div key={d.key}>
                  <dt>{d.name}</dt>
                  <dd>
                    <span className={styles.versionLabel}>Now</span>
                    <span className={styles.versionText}>{d.now}</span>
                  </dd>
                  <dd>
                    <span className={styles.versionLabel}>Before</span>
                    <span className={styles.versionText}>{d.before}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null}
    </section>
  );
}
