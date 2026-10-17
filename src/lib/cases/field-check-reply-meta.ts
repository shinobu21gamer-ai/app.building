/** Reads the field-check reference from a resident reply's journal metadata. */
export function fieldCheckIdFromMetadata(metadataJson: string | null): number | null {
  if (!metadataJson) return null;
  try {
    const metadata: unknown = JSON.parse(metadataJson);
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      "fieldCheckId" in metadata &&
      typeof metadata.fieldCheckId === "number"
    ) {
      return metadata.fieldCheckId;
    }
  } catch {
    // An older or malformed journal entry is not a reply to any field check.
  }
  return null;
}
