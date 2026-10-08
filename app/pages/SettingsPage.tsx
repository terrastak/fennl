import { useEffect, useState } from "react";
import { isHealthStatus } from "../../shared/health";
import {
  SCHEME_PREVIEW,
  type ColorMode,
  type ColorScheme,
  type TextSize,
} from "../../shared/appearance";
import { useAppearance } from "../appearance/appearance";
import { EmailSection } from "../account/EmailSection";
import { saveAccountScheme } from "../appearance/accountScheme";
import { DevicesSection } from "../devices/DevicesSection";
import { ExportSection } from "../export/ExportSection";
import { LocalCopySection } from "../sync/LocalCopySection";
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

      <EmailSection />

      <DevicesSection />

      <ExportSection />

      <LocalCopySection />

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
