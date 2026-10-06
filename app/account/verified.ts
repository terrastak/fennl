/** How an address's verification reads in Settings and the admin console (phase B7a). */
export function verifiedText(emailVerified: boolean, emailVerifiedAt: string | null): string {
  if (!emailVerified) return "Not verified";
  if (!emailVerifiedAt) return "Verified (date not recorded)";
  const date = new Date(emailVerifiedAt).toLocaleDateString(undefined, { dateStyle: "medium" });
  return `Verified on ${date}`;
}
