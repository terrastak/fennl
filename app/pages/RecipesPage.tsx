import { greetingFor } from "./greeting";
import { PageHeader } from "./PageHeader";
import styles from "./pages.module.css";

export function RecipesPage() {
  return (
    <>
      <PageHeader title="Your recipes" note={greetingFor(new Date())} />
      <section className={styles.card} aria-labelledby="empty-title">
        <h2 id="empty-title">Your recipe box is empty, for now</h2>
        <p>
          Soon you'll be able to write recipes here, bring them in from websites, photograph family
          recipe cards and cookbook pages, and move over your Paprika library.
        </p>
        <p>Recipes will be stored in your account. This browser keeps a copy for speed.</p>
      </section>
    </>
  );
}
