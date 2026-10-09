import { forwardRef, useEffect } from "react";
import { overallLevel, usageLevel, type PhotoUsage, type Usage } from "../../shared/limits";
import styles from "../pages/SettingsPage.module.css";
import { Link } from "../router";
import {
  NOTHING_LOST,
  addBlockedText,
  graceText,
  memberPhotosLine,
  photoCountLine,
  photosLine,
  recipesLine,
  textLine,
} from "./limitText";
import { useAddBlocked, useUsage } from "./useLimits";
import limits from "./limits.module.css";

// Usage bars (phase C11): in Settings, and a small one beside "Add recipe" when near or over a
// limit. Rules in shared/limits.ts; wording in limitText.ts.

/** One bar: how much of a limit is used. With no limit, just the words. */
export function UsageMeter({
  label,
  used,
  max,
  text,
}: {
  label: string;
  used: number;
  max: number | null;
  text: string;
}) {
  if (max === null) return <p className={limits.meterText}>{text}</p>;
  const level = usageLevel(used, max);
  const share = max > 0 ? Math.min(1, used / max) : 1;
  return (
    <div className={`${limits.meter} ${limits[level] ?? ""}`}>
      <p className={limits.meterText}>{text}</p>
      <div
        className={limits.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(used, max)}
        aria-valuetext={text}
      >
        <div className={limits.fill} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function Meters({ usage }: { usage: Usage }) {
  return (
    <>
      <UsageMeter
        label="Recipes"
        used={usage.recipes}
        max={usage.maxRecipes}
        text={recipesLine(usage)}
      />
      <UsageMeter
        label="Recipe text"
        used={usage.textBytes}
        max={usage.maxTextBytes}
        text={textLine(usage)}
      />
    </>
  );
}

/**
 * The household's photos (phase D3): the total against the quota, the count when it's the closer
 * limit, each member's share, and any 90-day grace period. Not shown to a plan without photos
 * that has none.
 */
function PhotoMeters({ photos }: { photos: PhotoUsage }) {
  if (!photos.enabled && photos.count === 0) return null;
  const quota = photos.enabled ? photos.maxBytes : null;
  const countMax = photos.enabled ? photos.maxCount : null;
  const shared = photos.members.length > 1;
  const waiting = photos.members.filter((m) => m.deleteAfter !== null && m.count > 0);
  return (
    <>
      <UsageMeter label="Photos" used={photos.bytes} max={quota} text={photosLine(photos)} />
      {usageLevel(photos.count, countMax) !== "fine" ? (
        <UsageMeter
          label="Number of photos"
          used={photos.count}
          max={countMax}
          text={photoCountLine(photos)}
        />
      ) : null}
      {shared && photos.count > 0 ? (
        <ul className={limits.shares} aria-label="Photos by person">
          {photos.members.map((m) => (
            <li key={m.userId}>{memberPhotosLine(m)}</li>
          ))}
        </ul>
      ) : null}
      {waiting.map((m) => (
        <p key={m.userId} role="status" className={limits.note}>
          {graceText(m, !shared)}
        </p>
      ))}
    </>
  );
}

/** Settings › Recipe storage. */
export function UsageSection() {
  const usage = useUsage();
  const blocked = useAddBlocked();
  // Arriving from a "Recipe storage" link.
  useEffect(() => {
    if (window.location.hash === "#usage") document.getElementById("usage")?.scrollIntoView();
  }, []);
  return (
    <section aria-labelledby="usage-title" className={styles.section} id="usage">
      <h2 id="usage-title">Recipe storage</h2>
      {usage ? (
        <>
          <Meters usage={usage} />
          {usage.photos ? <PhotoMeters photos={usage.photos} /> : null}
          <p className={styles.help}>
            Recipes in Trash don&rsquo;t count toward the number of recipes, but their text counts
            until they&rsquo;re deleted for good.
            {usage.photos?.enabled ? " A photo counts once, however many recipes show it." : ""}
          </p>
          {blocked ? (
            <p role="status" className={limits.note}>
              {addBlockedText(blocked, usage)} {NOTHING_LOST}
            </p>
          ) : null}
        </>
      ) : (
        <p className={styles.help}>Shown once this device has reached your account.</p>
      )}
    </section>
  );
}

/**
 * Beside "Add recipe": the bar when near or over a limit, and why adding is blocked when it is.
 * The blocked message can take focus (when "Add recipe" is pressed anyway).
 */
export const UsageNote = forwardRef<HTMLParagraphElement, { id: string }>(function UsageNote(
  { id },
  ref,
) {
  const usage = useUsage();
  const blocked = useAddBlocked();
  if (!usage || overallLevel(usage) === "fine") return null;
  const recipesFirst =
    usageLevel(usage.recipes, usage.maxRecipes) !== "fine" || usage.maxTextBytes === null;
  return (
    <div className={limits.note} aria-label="Recipe storage" role="group">
      {recipesFirst ? (
        <UsageMeter
          label="Recipes"
          used={usage.recipes}
          max={usage.maxRecipes}
          text={recipesLine(usage)}
        />
      ) : (
        <UsageMeter
          label="Recipe text"
          used={usage.textBytes}
          max={usage.maxTextBytes}
          text={textLine(usage)}
        />
      )}
      <Link href="/settings#usage">Recipe storage</Link>
      {blocked ? (
        <p id={id} ref={ref} tabIndex={-1} className={limits.blocked}>
          {addBlockedText(blocked, usage)} {NOTHING_LOST}
        </p>
      ) : null}
    </div>
  );
});
