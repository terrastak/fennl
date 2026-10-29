import { useEffect, useState } from "react";
import { isHealthStatus } from "../../shared/health";
import type { UnitSystem } from "../../shared/scale";
import {
  SCHEME_PREVIEW,
  type ColorMode,
  type ColorScheme,
  type TextSize,
} from "../../shared/appearance";
import { useAppearance } from "../appearance/appearance";
import { EmailSection } from "../account/EmailSection";
import { TimerAlertsSection } from "../timers/TimerAlertsSection";
import { saveAccountScheme } from "../appearance/accountScheme";
import { ExportSection } from "../export/ExportSection";
import { LocalCopySection } from "../sync/LocalCopySection";
import { useHideNutrition } from "../recipes/nutritionSetting";
import { useUnits } from "../recipes/units";
import { Link } from "../router";
import { PageHeader } from "./PageHeader";
import styles from "./SettingsPage.module.css";

const SCHEMES: { value: ColorScheme; name: string; description: string }[] = [
  { value: "harbor", name: "Harbor", description: "Navy with a coral accent, on warm paper" },
  { value: "heirloom", name: "Heirloom", description: "Olive and berry, on warm linen" },
];

const MODES: { value: ColorMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match my device" },
];

const TEXT_SIZES: { value: TextSize; label: string; sample: string }[] = [
  { value: "standard", label: "Standard", sample: "1rem" },
  { value: "large", label: "Large", sample: "1.25rem" },
  { value: "larger", label: "Larger", sample: "1.5rem" },
  { value: "largest", label: "Largest", sample: "1.8rem" },
];

export function SettingsPage() {
  const [appearance, update] = useAppearance();
  const [schemeSaveFailed, setSchemeSaveFailed] = useState(false);

  const chooseScheme = (scheme: ColorScheme) => {
    update({ scheme });
    setSchemeSaveFailed(false);
    void saveAccountScheme(scheme).then((saved) => setSchemeSaveFailed(!saved));
  };

  return (
    <>
      <PageHeader title="Settings" note="make it feel like home" />

      <section aria-labelledby="appearance-title" className={styles.section}>
        <h2 id="appearance-title">Appearance</h2>

        <fieldset className={styles.fieldset}>
          <legend>Color scheme</legend>
          <p className={styles.help}>Saved to your account, so it follows you to every device.</p>
          {schemeSaveFailed ? (
            <p role="alert" className={styles.help}>
              Couldn&rsquo;t save this to your account just now. It&rsquo;s used on this device, and
              you can choose it again to retry.
            </p>
          ) : null}
          <div className={styles.schemes}>
            {SCHEMES.map((scheme) => {
              const p = SCHEME_PREVIEW[scheme.value];
              return (
                <label key={scheme.value} className={styles.schemeCard}>
                  <input
                    type="radio"
                    name="scheme"
                    value={scheme.value}
                    checked={appearance.scheme === scheme.value}
                    onChange={() => chooseScheme(scheme.value)}
                    className={styles.schemeInput}
                  />
                  <span
                    className={styles.preview}
                    style={{ background: p.bg, color: p.text }}
                    aria-hidden="true"
                  >
                    <span className={styles.previewHand} style={{ color: p.hand }}>
                      Rose
                    </span>
                    <span className={styles.previewTitle}>Lemon Bars</span>
                    <span
                      className={styles.previewButton}
                      style={{ background: p.accent, color: p.onAccent }}
                    >
                      Start cooking
                    </span>
                  </span>
                  <span className={styles.schemeName}>{scheme.name}</span>
                  <span className={styles.schemeDescription}>{scheme.description}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Light or dark</legend>
          <p className={styles.help}>Set per device, since screens and rooms differ.</p>
          <div className={styles.segmented}>
            {MODES.map((mode) => (
              <label key={mode.value} className={styles.segment}>
                <input
                  type="radio"
                  name="mode"
                  value={mode.value}
                  checked={appearance.mode === mode.value}
                  onChange={() => update({ mode: mode.value })}
                />
                <span>{mode.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Text size</legend>
          <p className={styles.help}>
            Bigger text helps when you're cooking at arm's length. This one is set per device.
          </p>
          <div className={styles.sizes}>
            {TEXT_SIZES.map((size) => (
              <label key={size.value} className={styles.size}>
                <input
                  type="radio"
                  name="textSize"
                  value={size.value}
                  checked={appearance.textSize === size.value}
                  onChange={() => update({ textSize: size.value })}
                />
                <span className={styles.sizeSample} style={{ fontSize: size.sample }}>
                  A
                </span>
                <span className={styles.sizeLabel}>{size.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <RecipesSection />

      <EmailSection />

      <section aria-labelledby="signed-in-title" className={styles.section}>
        <h2 id="signed-in-title">Devices and extensions</h2>
        <p className={styles.help}>
          The devices signed in to your account and your connected Chrome extensions are on your{" "}
          <Link href="/account">Account</Link> page, where you can sign out or disconnect them.
        </p>
      </section>

      <section aria-labelledby="usage-title" className={styles.section}>
        <h2 id="usage-title">Usage and limits</h2>
        <p className={styles.help}>
          How many recipes, photos and AI imports you&rsquo;re using, against your plan, is on your{" "}
          <Link href="/account#usage">Account</Link> page.
        </p>
      </section>

      <ExportSection />

      <LocalCopySection />

      <TimerAlertsSection />

      <section aria-labelledby="about-title" className={styles.section}>
        <h2 id="about-title">About</h2>
        <ServerStatus />
      </section>
    </>
  );
}

type ServerState = "checking" | "ok" | "database-unavailable" | "unreachable";

const SERVER_LABELS: Record<ServerState, string> = {
  checking: "checking…",
  ok: "ok, database connected",
  "database-unavailable": "running, but the database isn't answering",
  unreachable: "unreachable",
};

function ServerStatus() {
  const [server, setServer] = useState<ServerState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    // A 503 still carries a health report (the database is down), so read the body either way.
    fetch("/api/health", { signal: controller.signal })
      .then((res) => res.json())
      .then((body: unknown) => {
        if (!isHealthStatus(body)) setServer("unreachable");
        else setServer(body.database === "ok" ? "ok" : "database-unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setServer("unreachable");
      });
    return () => controller.abort();
  }, []);

  return (
    <p className={styles.help}>
      Server status: <output>{SERVER_LABELS[server]}</output>
    </p>
  );
}

const UNIT_CHOICES: { value: UnitSystem; label: string }[] = [
  { value: "written", label: "As written" },
  { value: "us", label: "US (cups, ounces, pounds)" },
  { value: "metric", label: "Metric (millilitres, grams)" },
];

/** How recipes read (phases F1 and F4): units, and nutrition shown or hidden. */
function RecipesSection() {
  const [units, chooseUnits] = useUnits();
  const [hidden, chooseHidden] = useHideNutrition();
  const [failed, setFailed] = useState(false);
  const saved = (ok: boolean) => setFailed(!ok);
  return (
    <section id="recipes" aria-labelledby="recipes-title" className={styles.section}>
      <h2 id="recipes-title">Recipes</h2>
      <p className={styles.help}>Saved to your account, so they follow you to every device.</p>
      {failed ? (
        <p role="alert" className={styles.help}>
          Couldn&rsquo;t save this to your account just now. It&rsquo;s used on this device, and you
          can choose it again to retry.
        </p>
      ) : null}
      <fieldset className={styles.fieldset}>
        <legend>Units</legend>
        <p className={styles.help}>
          Recipes show their amounts in these units. The recipe itself never changes.
        </p>
        <div className={styles.segmented}>
          {UNIT_CHOICES.map((choice) => (
            <label key={choice.value} className={styles.segment}>
              <input
                type="radio"
                name="units"
                value={choice.value}
                checked={units === choice.value}
                onChange={() => void chooseUnits(choice.value).then(saved)}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>Nutrition</legend>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={!hidden}
            onChange={(e) => void chooseHidden(!e.target.checked).then(saved)}
          />
          <span>Show nutrition</span>
        </label>
        <p className={styles.help}>
          Turning this off hides nutrition everywhere. Nothing is deleted: turn it back on to see it
          again.
        </p>
      </fieldset>
    </section>
  );
}
