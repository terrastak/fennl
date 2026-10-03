/** "Good morning/afternoon/evening" for the handwritten greeting above the recipes. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
