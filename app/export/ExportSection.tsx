import styles from "../pages/SettingsPage.module.css";
import recipeStyles from "../recipes/recipes.module.css";

/**
 * Settings › Download your recipes (phase C10): the whole library as a .zip, from the server
 * (worker/export/). Open to every account, whatever the plan: recipes are never held hostage.
 */
export function ExportSection() {
  return (
    <section aria-labelledby="export-title" className={styles.section}>
      <h2 id="export-title">Download your recipes</h2>
      <p className={styles.help}>
        Every recipe in one .zip file: a page for each that opens in any web browser, and a data
        file (JSON) for moving them to another app or back into Fennl. Recipes in Trash aren&rsquo;t
        included. This needs a connection.
      </p>
      <p>
        <a href="/api/export" download className={recipeStyles.primary}>
          Download all recipes
        </a>
      </p>
    </section>
  );
}
