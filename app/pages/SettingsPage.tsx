import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
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
import { saveAccountScheme } from "../appearance/accountScheme";
import { ExportSection } from "../export/ExportSection";
import { LocalCopySection } from "../sync/LocalCopySection";
import { useHideNutrition } from "../recipes/nutritionSetting";
import { useUnits } from "../recipes/units";
import { usePointer } from "../recipes/usePointer";
import { Link } from "../router";
import { PageHeader } from "./PageHeader";
import { CHECK, CHEVRON, RowIcon, SettingsBox, SettingsRow, StatusDot } from "./SettingsRow";
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

/** Each size's "A": big cards on a phone, a smaller "A" in a small switch on a laptop (U23). */
const TEXT_SIZES: { value: TextSize; label: string; sample: string; laptop: string }[] = [
  { value: "standard", label: "Standard", sample: "1rem", laptop: "0.6875rem" },
  { value: "large", label: "Large", sample: "1.25rem", laptop: "0.8125rem" },
  { value: "larger", label: "Larger", sample: "1.5rem", laptop: "0.9375rem" },
  { value: "largest", label: "Largest", sample: "1.8rem", laptop: "1.0625rem" },
];

interface SettingProps {
  name: string;
  /** The explanation under the name. */
  help: ReactNode;
  /** A laptop's explanation, where it says more ("Saved to your account."). */
  laptopHelp?: ReactNode;
  /** A tall control: on a laptop, it lines up with the name rather than the middle. */
  top?: boolean;
  children: ReactNode;
}

/**
 * One group of choices: a heading with the choices under it on a phone, a row of the section's
 * box on a laptop (U23).
 */
function Setting({ name, help, laptopHelp, top, children }: SettingProps) {
  if (usePointer()) {
    return (
      <SettingsRow name={name} help={laptopHelp ?? help} top={top} group>
        {children}
      </SettingsRow>
    );
  }
  return (
    <fieldset className={styles.fieldset}>
      <legend>{name}</legend>
      {help}
      {children}
    </fieldset>
  );
}

export function SettingsPage() {
  const [appearance, update] = useAppearance();
  const [schemeSaveFailed, setSchemeSaveFailed] = useState(false);
  const laptop = usePointer();

  const chooseScheme = (scheme: ColorScheme) => {
    update({ scheme });
    setSchemeSaveFailed(false);
    void saveAccountScheme(scheme).then((saved) => setSchemeSaveFailed(!saved));
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Settings" note="make it feel like home" />

      <section aria-labelledby="appearance-title" className={styles.section}>
        <h2 id="appearance-title">Appearance</h2>

        <SettingsBox>
          <Setting
            name="Color scheme"
            top
            help={
              <>
                <p className={styles.help}>
                  Saved to your account, so it follows you to every device.
                </p>
                {schemeSaveFailed ? (
                  <p role="alert" className={styles.help}>
                    Couldn&rsquo;t save this to your account just now. It&rsquo;s used on this
                    device, and you can choose it again to retry.
                  </p>
                ) : null}
              </>
            }
          >
            <div className={styles.schemes}>
              {SCHEMES.map((scheme) => {
                const p = SCHEME_PREVIEW[scheme.value];
                const chosen = appearance.scheme === scheme.value;
                return (
                  <label key={scheme.value} className={styles.schemeCard}>
                    <input
                      type="radio"
                      name="scheme"
                      value={scheme.value}
                      checked={chosen}
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
                      {/* The scheme's own accent, as variables so a laptop can show Start
                          cooking as it looks there: accent words with no fill (U23). */}
                      <span
                        className={styles.previewButton}
                        style={
                          {
                            "--preview-accent": p.accent,
                            "--preview-on-accent": p.onAccent,
                          } as CSSProperties
                        }
                      >
                        <svg
                          className={styles.previewIcon}
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M7 5v14l11-7z" />
                        </svg>
                        Start cooking
                      </span>
                    </span>
                    <span className={styles.schemeName}>
                      {scheme.name}
                      {/* On a laptop, the chosen card has a check mark and the other an empty
                          circle, so it isn't shown by the ring's colour alone. */}
                      {chosen ? (
                        <span className={styles.schemeTick}>
                          <RowIcon path={CHECK} className={styles.schemeTickIcon} />
                        </span>
                      ) : (
                        <span className={styles.schemeCircle} />
                      )}
                    </span>
                    <span className={styles.schemeDescription}>{scheme.description}</span>
                  </label>
                );
              })}
            </div>
          </Setting>

          <Setting
            name="Light or dark"
            help={<p className={styles.help}>Set per device, since screens and rooms differ.</p>}
          >
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
          </Setting>

          <Setting
            name="Text size"
            help={
              <p className={styles.help}>
                Bigger text helps when you're cooking at arm's length. This one is set per device.
              </p>
            }
            laptopHelp={
              <p className={styles.help}>
                Bigger text helps when you&rsquo;re cooking at arm&rsquo;s length. Set per device.
              </p>
            }
          >
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
                  <span
                    className={styles.sizeSample}
                    style={
                      { "--sample": size.sample, "--sample-laptop": size.laptop } as CSSProperties
                    }
                  >
                    A
                  </span>
                  <span className={styles.sizeLabel}>{size.label}</span>
                </label>
              ))}
            </div>
          </Setting>
        </SettingsBox>
      </section>

      <RecipesSection />

      <EmailSection />

      <AccountLinks />

      {laptop ? (
        <section aria-labelledby="browser-title" className={styles.section}>
          <h2 id="browser-title">Your recipes and this browser</h2>
          <SettingsBox>
            <ExportSection />
            <LocalCopySection />
          </SettingsBox>
        </section>
      ) : (
        <>
          <ExportSection />
          <LocalCopySection />
        </>
      )}

      <section aria-labelledby="about-title" className={styles.section}>
        <h2 id="about-title">About</h2>
        <SettingsBox>
          <ServerStatus />
        </SettingsBox>
      </section>
    </div>
  );
}

type ServerState = "checking" | "ok" | "database-unavailable" | "unreachable";

const SERVER_LABELS: Record<ServerState, string> = {
  checking: "checking…",
  ok: "ok, database connected",
  "database-unavailable": "running, but the database isn't answering",
  unreachable: "unreachable",
};

/** On a laptop the words stand on their own, after a dot (U23). */
const SERVER_WORDS: Record<ServerState, string> = {
  checking: "Checking…",
  ok: "OK, database connected",
  "database-unavailable": "Running, but the database isn't answering",
  unreachable: "Unreachable",
};

const SERVER_TONES: Record<ServerState, "ok" | "busy" | "problem"> = {
  checking: "busy",
  ok: "ok",
  "database-unavailable": "problem",
  unreachable: "problem",
};

function ServerStatus() {
  const laptop = usePointer();
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

  if (laptop) {
    return (
      <SettingsRow name="Server status">
        <output className={styles.status}>
          <StatusDot tone={SERVER_TONES[server]} />
          {SERVER_WORDS[server]}
        </output>
      </SettingsRow>
    );
  }
  return (
    <p className={styles.help}>
      Server status: <output>{SERVER_LABELS[server]}</output>
    </p>
  );
}

const UNIT_CHOICES: { value: UnitSystem; label: string; short: string }[] = [
  { value: "written", label: "As written", short: "As written" },
  { value: "us", label: "US (cups, ounces, pounds)", short: "US" },
  { value: "metric", label: "Metric (millilitres, grams)", short: "Metric" },
];

/** How recipes read (phases F1 and F4): units, and nutrition shown or hidden. */
function RecipesSection() {
  const laptop = usePointer();
  const [units, chooseUnits] = useUnits();
  const [hidden, chooseHidden] = useHideNutrition();
  const [failed, setFailed] = useState(false);
  const nutritionId = useId();
  const saved = (ok: boolean) => setFailed(!ok);
  const showNutrition = (
    <input
      id={laptop ? nutritionId : undefined}
      type="checkbox"
      role={laptop ? "switch" : undefined}
      className={laptop ? styles.switchInput : undefined}
      checked={!hidden}
      onChange={(e) => void chooseHidden(!e.target.checked).then(saved)}
    />
  );
  return (
    <section id="recipes" aria-labelledby="recipes-title" className={styles.section}>
      <h2 id="recipes-title">Recipes</h2>
      {laptop ? null : (
        <p className={styles.help}>Saved to your account, so they follow you to every device.</p>
      )}
      {failed ? (
        <p role="alert" className={styles.help}>
          Couldn&rsquo;t save this to your account just now. It&rsquo;s used on this device, and you
          can choose it again to retry.
        </p>
      ) : null}
      <SettingsBox>
        <Setting
          name="Units"
          help={
            <p className={styles.help}>
              Recipes show their amounts in these units. The recipe itself never changes.
            </p>
          }
          laptopHelp={
            <p className={styles.help}>
              Recipes show their amounts in these units. The recipe itself never changes. Saved to
              your account. US is cups, ounces and pounds; metric is millilitres and grams.
            </p>
          }
        >
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
                <span>{laptop ? choice.short : choice.label}</span>
              </label>
            ))}
          </div>
        </Setting>
        {laptop ? (
          <SettingsRow
            name="Show nutrition"
            labelFor={nutritionId}
            help={
              <p className={styles.help}>
                Saved to your account. Turning this off hides nutrition everywhere. Nothing is
                deleted: turn it back on to see it again.
              </p>
            }
          >
            {/* The knob moves and the word says it, so it isn't shown by colour alone. */}
            <span className={styles.switch}>
              <span className={styles.switchWord} aria-hidden="true">
                {hidden ? "Off" : "On"}
              </span>
              {showNutrition}
              <span className={styles.track} aria-hidden="true" />
            </span>
          </SettingsRow>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend>Nutrition</legend>
            <label className={styles.check}>
              {showNutrition}
              <span>Show nutrition</span>
            </label>
            <p className={styles.help}>
              Turning this off hides nutrition everywhere. Nothing is deleted: turn it back on to
              see it again.
            </p>
          </fieldset>
        )}
      </SettingsBox>
    </section>
  );
}

/**
 * Devices and extensions, and usage: both on the Account page. On a laptop, one Account section
 * with a row and a button for each (U23); on a phone, a short section each with a link.
 */
function AccountLinks() {
  if (usePointer()) {
    return (
      <section aria-labelledby="account-title" className={styles.section}>
        <h2 id="account-title">Account</h2>
        <SettingsBox>
          <SettingsRow
            name="Devices and extensions"
            help={
              <p className={styles.help}>
                The devices signed in to your account and your connected Chrome extensions, where
                you can sign out or disconnect them.
              </p>
            }
          >
            <Link href="/account" className={styles.rowButton}>
              See devices
              <RowIcon path={CHEVRON} />
            </Link>
          </SettingsRow>
          <SettingsRow
            name="Usage and limits"
            help={
              <p className={styles.help}>
                How many recipes, photos and AI imports you&rsquo;re using, against your plan.
              </p>
            }
          >
            <Link href="/account#usage" className={styles.rowButton}>
              See usage
              <RowIcon path={CHEVRON} />
            </Link>
          </SettingsRow>
        </SettingsBox>
      </section>
    );
  }
  return (
    <>
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
    </>
  );
}
