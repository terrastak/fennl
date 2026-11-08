import { forwardRef, useEffect, useState } from "react";
import type { DeviceList } from "../../shared/devices";
import {
  overallLevel,
  usageLevel,
  type AiImportUsage,
  type PhotoUsage,
  type Usage,
} from "../../shared/limits";
import { ACCOUNT_ICONS } from "../account/accountIcons";
import acc from "../pages/AccountPage.module.css";
import styles from "../pages/SettingsPage.module.css";
import { SettingsRow } from "../pages/SettingsRow";
import { usePointer } from "../recipes/usePointer";
import { Link } from "../router";
import { WarmNote } from "../ui/WarmNote";
import {
  NOTHING_LOST,
  addBlockedText,
  AI_PAUSED_TEXT,
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

/** How full a bar is, in words (U23, owner's choice 2026-11-07); nothing while there's room. */
const LEVEL_WORDS: Record<string, string> = {
  near: "Almost full",
  full: "Full",
  over: "Over the limit",
};

/** One bar: how much of a limit is used. With no limit, just the words. */
export function UsageMeter({
  label,
  used,
  max,
  text,
  words = false,
}: {
  label: string;
  used: number;
  max: number | null;
  text: string;
  /** "Almost full", "Full" or "Over the limit" beside the numbers, not only the bar's colour. */
  words?: boolean;
}) {
  if (max === null) return <p className={limits.meterText}>{text}</p>;
  const level = usageLevel(used, max);
  const share = max > 0 ? Math.min(1, used / max) : 1;
  const levelWords = words ? LEVEL_WORDS[level] : undefined;
  return (
    <div className={`${limits.meter} ${limits[level] ?? ""}`}>
      <p className={limits.meterText}>
        {text}
        {levelWords ? (
          <>
            {" "}
            <span className={`${limits.levelTag} ${limits[`${level}Tag`] ?? ""}`}>
              {levelWords}
            </span>
          </>
        ) : null}
      </p>
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
        words
      />
      <UsageMeter
        label="Recipe text"
        used={usage.textBytes}
        max={usage.maxTextBytes}
        text={textLine(usage)}
        words
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
      <UsageMeter label="Photos" used={photos.bytes} max={quota} text={photosLine(photos)} words />
      {usageLevel(photos.count, countMax) !== "fine" ? (
        <UsageMeter
          label="Number of photos"
          used={photos.count}
          max={countMax}
          text={photoCountLine(photos)}
          words
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
  const laptop = usePointer();
  // Arriving from a link to the usage.
  useEffect(() => {
    if (window.location.hash === "#usage") document.getElementById("usage")?.scrollIntoView();
  }, []);
  if (laptop) {
    return (
      <section aria-labelledby="usage-title" className={className} id="usage">
        <h2 id="usage-title">Usage and limits</h2>
        <LaptopUsage usage={usage} blocked={blocked} ai={ai} devices={devices} />
        {usage ? (
          <p className={`${styles.help} ${acc.foot}`}>
            Recipes in Trash don&rsquo;t count toward the number of recipes, but their text counts
            until they&rsquo;re deleted for good.
            {usage.photos?.enabled ? " A photo counts once, however many recipes show it." : ""}
          </p>
        ) : null}
      </section>
    );
  }
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

/** A row's measure on a laptop: the bar with its words, or just the words with no limit. */
function RowMeter(props: { label: string; used: number; max: number | null; text: string }) {
  return props.max === null ? (
    <p className={acc.plain}>{props.text}</p>
  ) : (
    <div className={acc.meter}>
      <UsageMeter {...props} words />
    </div>
  );
}

/**
 * Usage and limits on a laptop (U23 slice 9): one white box, a row for each limit with its words
 * and a slim bar on the right, and the warm notes (adding paused, the photos' 90 days) right under
 * the line they're about.
 */
function LaptopUsage({
  usage,
  blocked,
  ai,
  devices,
}: {
  usage: Usage | null;
  blocked: ReturnType<typeof useAddBlocked>;
  ai: AiImportUsage | null;
  devices: DeviceList | null;
}) {
  const photos = usage?.photos;
  const showPhotos = photos ? photos.enabled || photos.count > 0 : false;
  const shared = photos ? photos.members.length > 1 : false;
  const waiting = photos?.members.filter((m) => m.deleteAfter !== null && m.count > 0) ?? [];
  return (
    <div className={`${styles.box} ${acc.box}`}>
      {usage ? (
        <>
          <SettingsRow name="Recipes">
            <RowMeter
              label="Recipes"
              used={usage.recipes}
              max={usage.maxRecipes}
              text={recipesLine(usage)}
            />
          </SettingsRow>
          <SettingsRow name="Recipe text">
            <RowMeter
              label="Recipe text"
              used={usage.textBytes}
              max={usage.maxTextBytes}
              text={textLine(usage)}
            />
          </SettingsRow>
          {blocked ? (
            <WarmNote role="status" className={acc.boxNote} icon={ACCOUNT_ICONS.info}>
              {addBlockedText(blocked, usage)} {NOTHING_LOST}
            </WarmNote>
          ) : null}
          {photos && showPhotos ? (
            <>
              <SettingsRow name="Photos">
                <RowMeter
                  label="Photos"
                  used={photos.bytes}
                  max={photos.enabled ? photos.maxBytes : null}
                  text={photosLine(photos)}
                />
              </SettingsRow>
              {usageLevel(photos.count, photos.enabled ? photos.maxCount : null) !== "fine" ? (
                <SettingsRow name="Number of photos">
                  <RowMeter
                    label="Number of photos"
                    used={photos.count}
                    max={photos.enabled ? photos.maxCount : null}
                    text={photoCountLine(photos)}
                  />
                </SettingsRow>
              ) : null}
              {shared && photos.count > 0 ? (
                <div className={acc.sharesLine}>
                  <ul className={acc.shares} aria-label="Photos by person">
                    {photos.members.map((m) => (
                      <li key={m.userId}>{memberPhotosLine(m)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {waiting.map((m) => (
                <WarmNote
                  key={m.userId}
                  role="status"
                  className={acc.boxNote}
                  icon={ACCOUNT_ICONS.photo}
                >
                  <GraceWords text={graceText(m, !shared)} />
                </WarmNote>
              ))}
            </>
          ) : null}
        </>
      ) : (
        <div className={styles.row}>
          <p className={`${styles.help} ${acc.loading}`}>
            Recipes and photos show once this device has reached your account.
          </p>
        </div>
      )}
      {ai ? <LaptopAiRow ai={ai} /> : null}
      {devices ? (
        <SettingsRow name="Devices">
          <p className={acc.plain}>{devicesLine(devices.devices.length, devices.max)}</p>
        </SettingsRow>
      ) : null}
    </div>
  );
}

/** The grace note's date in bold ("kept until **February 4, 2027**, then deleted"). */
function GraceWords({ text }: { text: string }) {
  const parts = /^(.* kept until )(.+?)(, then deleted.*)$/.exec(text);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[1]}
      <b>{parts[2]}</b>
      {parts[3]}
    </>
  );
}

/** This month's AI imports on a laptop: one row, as AiMeter says it elsewhere. */
function LaptopAiRow({ ai }: { ai: AiImportUsage }) {
  if (!ai.enabled && ai.used === 0) {
    return (
      <SettingsRow name="AI imports">
        <p className={acc.plain}>Reading recipes with AI is part of Premium.</p>
      </SettingsRow>
    );
  }
  if (ai.enabled && ai.paused) {
    return (
      <SettingsRow name="AI imports">
        <p role="status" className={acc.plain}>
          {AI_PAUSED_TEXT}
        </p>
      </SettingsRow>
    );
  }
  if (ai.enabled && ai.usedUp) {
    return (
      <SettingsRow name="AI imports">
        <RowMeter label="AI imports this month" used={1} max={1} text={aiResetText(ai)} />
      </SettingsRow>
    );
  }
  return (
    <SettingsRow
      name="AI imports"
      help={ai.enabled ? <p className={styles.help}>{aiResetText(ai)}</p> : undefined}
    >
      <RowMeter
        label="AI imports this month"
        used={ai.used}
        max={ai.enabled ? ai.max : null}
        text={aiImportsLine(ai)}
      />
    </SettingsRow>
  );
}

/** This month's AI imports against the plan's number, and when they start again. */
function AiMeter({ ai }: { ai: AiImportUsage }) {
  if (!ai.enabled && ai.used === 0) {
    return <p className={limits.meterText}>Reading recipes with AI is part of Premium.</p>;
  }
  if (ai.enabled && ai.paused) {
    return (
      <p role="status" className={limits.note}>
        {AI_PAUSED_TEXT}
      </p>
    );
  }
  // Used up, by the plan's number or the hidden cost backstop (decided 2026-10-14): a full bar
  // and when they start again, without the count, which could read as room left.
  if (ai.enabled && ai.usedUp) {
    return (
      <UsageMeter label="AI imports this month" used={1} max={1} text={aiResetText(ai)} words />
    );
  }
  return (
    <>
      <UsageMeter
        label="AI imports this month"
        used={ai.used}
        max={ai.enabled ? ai.max : null}
        text={aiImportsLine(ai)}
        words
      />
      {ai.enabled ? <p className={styles.help}>{aiResetText(ai)}</p> : null}
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
