import { forwardRef, useEffect, useState } from "react";
import type { DeviceList } from "../../shared/devices";
import {
  overallLevel,
  usageLevel,
  type AiImportUsage,
  type PhotoUsage,
  type Usage,
} from "../../shared/limits";
import styles from "../pages/SettingsPage.module.css";
import { Link } from "../router";
import {
  NOTHING_LOST,
  addBlockedText,
  aiImportsLine,
  aiResetText,
  devicesLine,
  graceText,
  memberPhotosLine,
  photoCountLine,
  photosLine,
  recipesLine,
  textLine,
} from "./limitText";
import { useAddBlocked, useUsage } from "./useLimits";
import limits from "./limits.module.css";

// Usage bars (phase C11): on the Account page, and a small one beside "Add recipe" when near or
// over a limit. Rules in shared/limits.ts; wording in limitText.ts.

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

/** The household's AI imports this month, and the devices signed in, as the server has them. */
function useAccountUsage() {
  const [ai, setAi] = useState<AiImportUsage | null>(null);
  const [devices, setDevices] = useState<DeviceList | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = <T,>(url: string, set: (value: T) => void) =>
      fetch(url)
        .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
        .then((body) => {
          if (!cancelled && body) set(body);
        })
        .catch(() => {});
    void load<AiImportUsage>("/api/ai/usage", setAi);
    void load<DeviceList>("/api/devices", setDevices);
    return () => {
      cancelled = true;
    };
  }, []);
  return { ai, devices };
}

/**
 * Account › Usage and limits (moved from Settings 2026-10-14, the owner's choice): recipes,
 * recipe text, photos, this month's AI imports and the devices signed in, each against the plan.
 * Bars turn amber at 80% and red when full.
 */
export function UsageCard({ className }: { className: string }) {
  const usage = useUsage();
  const blocked = useAddBlocked();
  const { ai, devices } = useAccountUsage();
  // Arriving from a link to the usage.
  useEffect(() => {
    if (window.location.hash === "#usage") document.getElementById("usage")?.scrollIntoView();
  }, []);
  return (
    <section aria-labelledby="usage-title" className={className} id="usage">
      <h2 id="usage-title">Usage and limits</h2>
      {usage ? (
        <>
          <Meters usage={usage} />
          {usage.photos ? <PhotoMeters photos={usage.photos} /> : null}
        </>
      ) : (
        <p className={styles.help}>
          Recipes and photos show once this device has reached your account.
        </p>
      )}
      {ai ? <AiMeter ai={ai} /> : null}
      {devices ? (
        <UsageMeter
          label="Devices"
          used={devices.devices.length}
          max={null}
          text={devicesLine(devices.devices.length, devices.max)}
        />
      ) : null}
      {usage ? (
        <>
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
      ) : null}
    </section>
  );
}

/** This month's AI imports against the plan's number, and when they start again. */
function AiMeter({ ai }: { ai: AiImportUsage }) {
  if (!ai.enabled && ai.used === 0) {
    return <p className={limits.meterText}>Reading recipes with AI is part of Premium.</p>;
  }
  return (
    <>
      <UsageMeter
        label="AI imports this month"
        used={ai.used}
        max={ai.enabled ? ai.max : null}
        text={aiImportsLine(ai)}
      />
      {ai.enabled && ai.max !== null ? <p className={styles.help}>{aiResetText(ai)}</p> : null}
    </>
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
      <Link href="/account#usage">Usage and limits</Link>
      {blocked ? (
        <p id={id} ref={ref} tabIndex={-1} className={limits.blocked}>
          {addBlockedText(blocked, usage)} {NOTHING_LOST}
        </p>
      ) : null}
    </div>
  );
});
