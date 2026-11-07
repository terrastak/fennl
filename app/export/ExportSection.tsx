import { useUsage } from "../limits/useLimits";
import { formatBytes } from "../pages/plan";
import { DOWNLOAD, RowIcon, SettingsRow } from "../pages/SettingsRow";
import styles from "../pages/SettingsPage.module.css";
import recipeStyles from "../recipes/recipes.module.css";
import { usePointer } from "../recipes/usePointer";

/**
 * Settings › Download your recipes (phase C10): the whole library as a .zip, from the server
 * (worker/export/). Open to every account, whatever the plan: recipes are never held hostage.
 * Photos go in too (phase D3), and can be left out for a smaller download. On a laptop it's a row
 * of the "Your recipes and this browser" box, with two quiet buttons (U23).
 */
export function ExportSection() {
  const laptop = usePointer();
  const photos = useUsage()?.photos;
  const withPhotos = photos !== undefined && photos.count > 0;
  const help = (
    <p className={styles.help}>
      Every recipe in one .zip file: a page for each that opens in any web browser, and a data file
      (JSON) for moving them to another app or back into Fennl. Recipes in Trash aren&rsquo;t
      included. This needs a connection.
      {withPhotos
        ? ` Photos are included (${formatBytes(photos.bytes)}), so it may take a while.`
        : ""}
    </p>
  );

  if (laptop) {
    return (
      <SettingsRow name="Download your recipes" help={help} top>
        <span className={styles.rowButtons}>
          <a href="/api/export" download className={styles.rowButton}>
            <RowIcon path={DOWNLOAD} />
            Download all recipes
          </a>
          {withPhotos ? (
            <a href="/api/export?photos=0" download className={styles.rowButton}>
              <RowIcon path={DOWNLOAD} />
              Download without photos
            </a>
          ) : null}
        </span>
      </SettingsRow>
    );
  }

  return (
    <section aria-labelledby="export-title" className={styles.section}>
      <h2 id="export-title">Download your recipes</h2>
      {help}
      <p>
        <a href="/api/export" download className={recipeStyles.primary}>
          Download all recipes
        </a>
        {withPhotos ? (
          <>
            {" "}
            <a href="/api/export?photos=0" download className={recipeStyles.secondary}>
              Download without photos
            </a>
          </>
        ) : null}
      </p>
    </section>
  );
}
