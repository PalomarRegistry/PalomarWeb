// Registered entry records are immutable. This one record was registered before
// Palomar stopped using an AI review synthesis as an abstract fallback, so its
// canonical bytes must remain available while reader-facing surfaces suppress
// the text that was never supplied or endorsed by the submitter.
const SUPPRESSED_ABSTRACTS = new Set([
  "PALOMAR-2026-08-13-000001-v1",
]);

export function presentationAbstract(entry) {
  const key = `${entry.id}-v${entry.version}`;
  if (SUPPRESSED_ABSTRACTS.has(key)) return "";
  return entry.abstract;
}
