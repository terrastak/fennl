import { Link } from "../router";
import { PageHeader } from "./PageHeader";

export function NotFoundPage() {
  return (
    <PageHeader title="Page not found">
      <p>
        There's nothing at this address. <Link href="/">Go to your recipes</Link>.
      </p>
    </PageHeader>
  );
}
