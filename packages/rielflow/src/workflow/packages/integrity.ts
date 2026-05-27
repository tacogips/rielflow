import { sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { err, ok, type Result } from "../result";
import { computeWorkflowPackageIntegrityDigest } from "./checksum";
import type {
  WorkflowPackageFailure,
  WorkflowPackageIntegrity,
  WorkflowPackageRegistryConfigOptions,
  WorkflowPackageRegistryEntry,
  WorkflowPackageSignature,
  WorkflowPackageTrustedSigner,
} from "./types";

export interface WorkflowPackageSigningConfig {
  readonly keyId: string;
  readonly privateKey: string;
  readonly publicKey?: string;
}

export interface WorkflowPackageIntegrityVerificationResult {
  readonly digest: string;
  readonly digestAlgorithm: "sha256";
  readonly signatureVerified: boolean;
  readonly signatureRequired: boolean;
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function digestPayload(digest: string): Uint8Array {
  return new Uint8Array(
    Buffer.from(`rielflow-package-integrity:sha256:${digest}`, "utf8"),
  );
}

export function normalizeWorkflowPackageIntegrity(
  value: unknown,
): Result<WorkflowPackageIntegrity | undefined, WorkflowPackageFailure> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", "package integrity must be an object"),
    );
  }
  const digestAlgorithm = value["digestAlgorithm"];
  const digest = value["digest"];
  if (
    digestAlgorithm !== "sha256" ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest)
  ) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "package integrity requires a sha256 hex digest",
      ),
    );
  }
  const rawSignatures = value["signatures"];
  if (rawSignatures === undefined) {
    return ok({ digestAlgorithm, digest });
  }
  if (!Array.isArray(rawSignatures)) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "package integrity signatures must be an array",
      ),
    );
  }
  const signatures: WorkflowPackageSignature[] = [];
  for (const rawSignature of rawSignatures) {
    if (!isRecord(rawSignature)) {
      return err(
        packageFailure("INVALID_MANIFEST", "package signature is invalid"),
      );
    }
    const keyId = readNonEmptyString(rawSignature["keyId"]);
    const algorithm = rawSignature["algorithm"];
    const signature = readNonEmptyString(rawSignature["signature"]);
    if (
      keyId === undefined ||
      algorithm !== "ed25519" ||
      signature === undefined
    ) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          "package signature requires keyId, ed25519 algorithm, and signature",
        ),
      );
    }
    signatures.push({ keyId, algorithm, signature });
  }
  return ok({
    digestAlgorithm,
    digest,
    signatures,
  });
}

export function normalizeWorkflowPackageTrustedSigners(
  value: unknown,
): Result<
  readonly WorkflowPackageTrustedSigner[] | undefined,
  WorkflowPackageFailure
> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value)) {
    return err(
      packageFailure(
        "INVALID_REGISTRY",
        "registry trustedSigners must be an array",
      ),
    );
  }
  const signers: WorkflowPackageTrustedSigner[] = [];
  for (const rawSigner of value) {
    if (!isRecord(rawSigner)) {
      return err(
        packageFailure(
          "INVALID_REGISTRY",
          "registry trusted signer is invalid",
        ),
      );
    }
    const id = readNonEmptyString(rawSigner["id"]);
    const publicKey = readNonEmptyString(rawSigner["publicKey"]);
    if (id === undefined || publicKey === undefined) {
      return err(
        packageFailure(
          "INVALID_REGISTRY",
          "registry trusted signer requires id and publicKey",
        ),
      );
    }
    signers.push({ id, publicKey });
  }
  return ok(signers);
}

export async function loadWorkflowPackageSigningConfig(
  options?: WorkflowPackageRegistryConfigOptions,
): Promise<
  Result<WorkflowPackageSigningConfig | undefined, WorkflowPackageFailure>
> {
  const env = options?.env ?? process.env;
  const keyId = readNonEmptyString(env["RIEL_WORKFLOW_PACKAGE_SIGNER_ID"]);
  const inlinePrivateKey = readNonEmptyString(
    env["RIEL_WORKFLOW_PACKAGE_SIGNING_KEY"],
  );
  const privateKeyPath = readNonEmptyString(
    env["RIEL_WORKFLOW_PACKAGE_SIGNING_KEY_FILE"],
  );
  const publicKey = readNonEmptyString(
    env["RIEL_WORKFLOW_PACKAGE_SIGNING_PUBLIC_KEY"],
  );
  if (inlinePrivateKey === undefined && privateKeyPath === undefined) {
    return ok(undefined);
  }
  if (keyId === undefined) {
    return err(
      packageFailure(
        "VALIDATION",
        "RIEL_WORKFLOW_PACKAGE_SIGNER_ID is required when signing packages",
      ),
    );
  }
  if (inlinePrivateKey !== undefined) {
    return ok({
      keyId,
      privateKey: inlinePrivateKey,
      ...(publicKey === undefined ? {} : { publicKey }),
    });
  }
  try {
    const privateKey = await readFile(privateKeyPath as string, "utf8");
    return ok({
      keyId,
      privateKey,
      ...(publicKey === undefined ? {} : { publicKey }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure("IO", `failed to read package signing key: ${message}`),
    );
  }
}

export function createWorkflowPackageSignature(input: {
  readonly digest: string;
  readonly signing: WorkflowPackageSigningConfig;
}): Result<WorkflowPackageSignature, WorkflowPackageFailure> {
  try {
    const signature = sign(
      null,
      digestPayload(input.digest),
      input.signing.privateKey,
    ).toString("base64");
    return ok({
      keyId: input.signing.keyId,
      algorithm: "ed25519",
      signature,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure("VALIDATION", `package signing failed: ${message}`),
    );
  }
}

export function shouldRequireWorkflowPackageSignature(input: {
  readonly registry: WorkflowPackageRegistryEntry;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): boolean {
  const configured =
    input.options?.env?.["RIEL_WORKFLOW_PACKAGE_REQUIRE_SIGNATURE"] ??
    process.env["RIEL_WORKFLOW_PACKAGE_REQUIRE_SIGNATURE"];
  return (
    configured === "1" ||
    configured === "true" ||
    input.registry.requireSignature === true ||
    (input.registry.trustedSigners?.length ?? 0) > 0
  );
}

export async function verifyWorkflowPackageIntegrity(input: {
  readonly packageRoot: string;
  readonly workflowDirectory: string;
  readonly integrity?: WorkflowPackageIntegrity;
  readonly registry: WorkflowPackageRegistryEntry;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<
  Result<WorkflowPackageIntegrityVerificationResult, WorkflowPackageFailure>
> {
  const computed = await computeWorkflowPackageIntegrityDigest({
    packageRoot: input.packageRoot,
    workflowDirectory: input.workflowDirectory,
  });
  if (!computed.ok) {
    return computed;
  }
  const signatureRequired = shouldRequireWorkflowPackageSignature({
    registry: input.registry,
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (input.integrity === undefined) {
    return signatureRequired
      ? err(
          packageFailure(
            "VALIDATION",
            `package integrity signature is required for registry '${input.registry.id}'`,
          ),
        )
      : ok({
          digest: computed.value.digest,
          digestAlgorithm: computed.value.digestAlgorithm,
          signatureVerified: false,
          signatureRequired,
        });
  }
  if (
    input.integrity.digestAlgorithm !== computed.value.digestAlgorithm ||
    input.integrity.digest !== computed.value.digest
  ) {
    return err(
      packageFailure("VALIDATION", "package sha256 integrity digest mismatch"),
    );
  }
  const trustedSigners = input.registry.trustedSigners ?? [];
  if (trustedSigners.length === 0) {
    return signatureRequired
      ? err(
          packageFailure(
            "VALIDATION",
            `registry '${input.registry.id}' requires trusted package signers`,
          ),
        )
      : ok({
          digest: computed.value.digest,
          digestAlgorithm: computed.value.digestAlgorithm,
          signatureVerified: false,
          signatureRequired,
        });
  }
  for (const signature of input.integrity.signatures ?? []) {
    const signer = trustedSigners.find(
      (candidate) => candidate.id === signature.keyId,
    );
    if (signer === undefined) {
      continue;
    }
    try {
      if (
        verify(
          null,
          digestPayload(input.integrity.digest),
          signer.publicKey,
          new Uint8Array(Buffer.from(signature.signature, "base64")),
        )
      ) {
        return ok({
          digest: computed.value.digest,
          digestAlgorithm: computed.value.digestAlgorithm,
          signatureVerified: true,
          signatureRequired,
        });
      }
    } catch {
      continue;
    }
  }
  return err(
    packageFailure(
      "VALIDATION",
      `package signature is not trusted for registry '${input.registry.id}'`,
    ),
  );
}
