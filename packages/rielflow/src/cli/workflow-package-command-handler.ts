import {
  checkoutWorkflowPackage,
  getWorkflowPackageCheckoutStatus,
  loadWorkflowPackageRegistryConfig,
  publishWorkflowPackage,
  registerWorkflowPackageRegistry,
  searchWorkflowPackages,
  updateWorkflowPackageCheckout,
} from "../workflow/packages";
import { emitJson } from "./input-output-helpers";
import type { RunCliScopeContext } from "./storage-and-options";

export async function runCliWorkflowPackageScope(
  context: RunCliScopeContext,
): Promise<number> {
  const {
    parsed,
    positionals,
    target,
    sharedOptions,
    graphqlCliTransport,
    io,
  } = context;
  if (graphqlCliTransport !== null) {
    io.stderr("workflow package commands are local-only; omit --endpoint");
    return 2;
  }
  const packageCommand = target;
  const packageTarget = positionals[3];
  const packageOptions = {
    env: sharedOptions.env,
    cwd: parsed.options.workingDirectory ?? process.cwd(),
    now: new Date(),
    ...(sharedOptions.userRoot === undefined
      ? {}
      : { userRoot: sharedOptions.userRoot }),
    ...(sharedOptions.projectRoot === undefined
      ? {}
      : { projectRoot: sharedOptions.projectRoot }),
    ...(sharedOptions.workflowRoot === undefined
      ? {}
      : { workflowRoot: sharedOptions.workflowRoot }),
  };

  if (packageCommand === "registry") {
    const registryCommand = packageTarget;
    if (registryCommand === "list") {
      const loaded = await loadWorkflowPackageRegistryConfig(packageOptions);
      if (!loaded.ok) {
        io.stderr(`package registry failed: ${loaded.error.message}`);
        return 1;
      }
      if (parsed.options.output === "json") {
        emitJson(io, loaded.value);
      } else {
        for (const registry of loaded.value.registries) {
          io.stdout(
            `${registry.id}\t${registry.url}\t${registry.defaultBranch}${
              registry.localPath === undefined ? "" : `\t${registry.localPath}`
            }`,
          );
        }
      }
      return 0;
    }
    if (registryCommand !== "add") {
      io.stderr("workflow package registry supports: add, list");
      return 2;
    }
    const registryId = positionals[4];
    if (registryId === undefined || parsed.options.registryUrl === undefined) {
      io.stderr(
        "workflow package registry add requires <id> and --registry-url <url>",
      );
      return 2;
    }
    const registered = await registerWorkflowPackageRegistry({
      id: registryId,
      url: parsed.options.registryUrl,
      ...(parsed.options.localPath === undefined
        ? {}
        : { localPath: parsed.options.localPath }),
      ...(parsed.options.branch === undefined
        ? {}
        : { branch: parsed.options.branch }),
      options: packageOptions,
    });
    if (!registered.ok) {
      io.stderr(`package registry failed: ${registered.error.message}`);
      return registered.error.code === "IO" ? 1 : 2;
    }
    if (parsed.options.output === "json") {
      emitJson(io, registered.value);
    } else {
      io.stdout(`registered workflow package registry: ${registryId}`);
    }
    return 0;
  }

  if (packageCommand === "search") {
    const searched = await searchWorkflowPackages({
      ...(packageTarget === undefined ? {} : { query: packageTarget }),
      ...(parsed.options.registry === undefined
        ? {}
        : { registry: parsed.options.registry }),
      ...(parsed.options.branch === undefined
        ? {}
        : { branch: parsed.options.branch }),
      ...(parsed.options.tags === undefined
        ? {}
        : { tags: parsed.options.tags }),
      ...(parsed.options.backend === undefined
        ? {}
        : { backend: parsed.options.backend }),
      ...(parsed.options.limit === undefined
        ? {}
        : { limit: parsed.options.limit }),
      refresh: parsed.options.refresh || parsed.options.noCache,
      cacheBackend: "json",
      options: packageOptions,
    });
    if (!searched.ok) {
      io.stderr(`package search failed: ${searched.error.message}`);
      return searched.error.code === "IO" ||
        searched.error.code === "FETCH_FAILED"
        ? 1
        : 2;
    }
    if (parsed.options.output === "json") {
      emitJson(io, searched.value);
    } else {
      for (const record of searched.value.records) {
        io.stdout(
          `${record.packageName}\t${record.version}\t${record.workflowId}\t${record.registryUrl}\t${record.checksum}\t${record.description}`,
        );
      }
    }
    return 0;
  }

  if (packageCommand === "checkout") {
    if (packageTarget === undefined) {
      io.stderr("workflow package checkout requires a package name");
      return 2;
    }
    const checkedOut = await checkoutWorkflowPackage({
      packageName: packageTarget,
      packageId: packageTarget,
      ...(parsed.options.registry === undefined
        ? {}
        : { registry: parsed.options.registry }),
      ...(parsed.options.branch === undefined
        ? {}
        : { branch: parsed.options.branch }),
      ...(parsed.options.userScope ? { userScope: true } : {}),
      ...(parsed.options.overwrite ? { overwrite: true } : {}),
      ...(parsed.options.yes ? { yes: true } : {}),
      ...(parsed.options.preInstallCheck && !parsed.options.noPreInstallCheck
        ? { preInstallCheck: true }
        : {}),
      ...(parsed.options.preInstallCheckMode === undefined
        ? {}
        : { preInstallCheckMode: parsed.options.preInstallCheckMode }),
      ...(parsed.options.preInstallCheckContainer === undefined
        ? {}
        : {
            preInstallCheckContainer: parsed.options.preInstallCheckContainer,
          }),
      options: packageOptions,
    });
    if (!checkedOut.ok) {
      io.stderr(`package checkout failed: ${checkedOut.error.message}`);
      return checkedOut.error.code === "IO" ||
        checkedOut.error.code === "FETCH_FAILED"
        ? 1
        : 2;
    }
    if (parsed.options.output === "json") {
      emitJson(io, checkedOut.value);
    } else {
      io.stdout(`checked out package: ${checkedOut.value.packageName}`);
      io.stdout(`workflow: ${checkedOut.value.workflowName}`);
      io.stdout(`scope: ${checkedOut.value.scope}`);
      io.stdout(`destination: ${checkedOut.value.destinationDirectory}`);
      io.stdout(`registry: ${checkedOut.value.registryUrl}`);
      io.stdout(`checksum: ${checkedOut.value.checksum}`);
      io.stdout(`content digest: ${checkedOut.value.contentDigest}`);
      io.stdout(`updated: ${String(checkedOut.value.updated)}`);
      io.stdout(`installId: ${checkedOut.value.installId}`);
      if (checkedOut.value.skills.length > 0) {
        io.stdout(`skills: ${checkedOut.value.skills.length}`);
      }
      if (checkedOut.value.preInstallCheck !== undefined) {
        const blockingFindings =
          checkedOut.value.preInstallCheck.findings.filter(
            (finding) =>
              finding.severity === "high" || finding.severity === "critical",
          ).length;
        io.stdout(
          `pre-install check: ${checkedOut.value.preInstallCheck.status} (${blockingFindings} blocking finding(s))`,
        );
      }
    }
    return 0;
  }

  if (packageCommand === "status" || packageCommand === "update") {
    if (packageTarget === undefined && parsed.options.installId === undefined) {
      io.stderr(
        `workflow package ${packageCommand} requires a workflow name or --install-id`,
      );
      return 2;
    }
    const scope =
      parsed.options.userScope || parsed.options.workflowScope === "user"
        ? "user"
        : parsed.options.workflowScope === "project"
          ? "project"
          : undefined;
    const result =
      packageCommand === "status"
        ? await getWorkflowPackageCheckoutStatus({
            ...(packageTarget === undefined
              ? {}
              : { workflowName: packageTarget }),
            ...(parsed.options.installId === undefined
              ? {}
              : { installId: parsed.options.installId }),
            ...(scope === undefined ? {} : { scope }),
            options: packageOptions,
          })
        : await updateWorkflowPackageCheckout({
            ...(packageTarget === undefined
              ? {}
              : { workflowName: packageTarget }),
            ...(parsed.options.installId === undefined
              ? {}
              : { installId: parsed.options.installId }),
            ...(scope === undefined ? {} : { scope }),
            ...(parsed.options.yes ? { yes: true } : {}),
            options: packageOptions,
          });
    if (!result.ok) {
      io.stderr(`package ${packageCommand} failed: ${result.error.message}`);
      return result.error.code === "IO" ? 1 : 2;
    }
    if (parsed.options.output === "json") {
      emitJson(io, result.value);
    } else {
      io.stdout(`package: ${String(result.value.packageId)}`);
      io.stdout(`workflow: ${String(result.value.workflowName)}`);
      io.stdout(`scope: ${String(result.value.scope)}`);
      io.stdout(`destination: ${String(result.value.destinationDirectory)}`);
      io.stdout(`registry: ${String(result.value.registryUrl)}`);
      io.stdout(`checksum: ${String(result.value.checksum)}`);
      io.stdout(`installId: ${String(result.value.installId)}`);
      io.stdout(
        `updated: ${String("updated" in result.value ? result.value.updated : false)}`,
      );
    }
    return 0;
  }

  if (packageCommand === "publish") {
    if (packageTarget === undefined) {
      io.stderr("workflow package publish requires a workflow directory");
      return 2;
    }
    const packageName = parsed.options.packageId ?? parsed.options.packageName;
    const published = await publishWorkflowPackage({
      workflowDirectory: packageTarget,
      ...(packageName === undefined ? {} : { packageName }),
      ...(parsed.options.registry === undefined
        ? {}
        : { registry: parsed.options.registry }),
      ...(parsed.options.registryUrl === undefined
        ? {}
        : { registryUrl: parsed.options.registryUrl }),
      ...(parsed.options.localPath === undefined
        ? {}
        : { registryLocalPath: parsed.options.localPath }),
      ...(parsed.options.branch === undefined
        ? {}
        : { branch: parsed.options.branch }),
      ...(parsed.options.createPr ? { createPr: true } : {}),
      ...(parsed.options.dryRun ? { dryRun: true } : {}),
      options: packageOptions,
    });
    if (!published.ok) {
      io.stderr(`package publish failed: ${published.error.message}`);
      return published.error.code === "IO" ||
        published.error.code === "GIT_FAILED"
        ? 1
        : 2;
    }
    if (parsed.options.output === "json") {
      emitJson(io, published.value);
    } else {
      io.stdout(`published package: ${published.value.packageId}`);
      io.stdout(`registry: ${published.value.registryId}`);
      io.stdout(`branch: ${published.value.registryRef}`);
      io.stdout(`checksum: ${published.value.checksum}`);
      if (published.value.dryRun) {
        io.stdout("dry run: true");
      }
      if (published.value.prUrl !== undefined) {
        io.stdout(`pull request: ${published.value.prUrl}`);
      }
    }
    return 0;
  }

  io.stderr(
    "workflow package supports: registry, search, checkout, status, update, publish",
  );
  return 2;
}
