import { PageHeader } from "./PageHeader";
import styles from "./pages.module.css";

export function ImportPage() {
  return (
    <>
      <PageHeader title="Import recipes">
        <p>Bring recipes into Fennl without retyping them.</p>
      </PageHeader>
      <section className={styles.card} aria-labelledby="import-title">
        <span className={styles.soon}>Coming soon</span>
        <h2 id="import-title">What you'll be able to import</h2>
        <ul className={styles.list}>
          <li>Recipes from websites, with the Fennl extension for Chrome</li>
          <li>Photos of handwritten recipe cards and cookbook pages</li>
          <li>Screenshots and PDFs</li>
          <li>Your whole Paprika library, photos included</li>
        </ul>
      </section>
    </>
  );
}
