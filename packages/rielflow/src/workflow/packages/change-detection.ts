export function packageChangedArtifacts(input: {
  readonly previousRecord: Readonly<Record<string, unknown>> | undefined;
  readonly nextRecord: Readonly<Record<string, unknown>>;
}): readonly string[] {
  if (input.previousRecord === undefined) {
    return [];
  }
  const changed: string[] = [];
  for (const key of [
    "registryUrl",
    "registryRef",
    "version",
    "sourceDirectory",
    "metadataPath",
    "checksum",
    "checksumAlgorithm",
    "contentDigest",
    "contentDigestAlgorithm",
    "packageHash",
  ]) {
    if (input.previousRecord[key] !== input.nextRecord[key]) {
      changed.push(key);
    }
  }
  if (
    JSON.stringify(input.previousRecord["skills"] ?? []) !==
    JSON.stringify(input.nextRecord["skills"] ?? [])
  ) {
    changed.push("skills");
  }
  return changed;
}
