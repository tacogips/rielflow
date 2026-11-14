type AttachmentPathHook = (absolutePath: string) => Promise<void> | void;

let beforeAttachmentTargetWriteForTests: AttachmentPathHook | undefined;
let beforeAttachmentSourceOpenForTests: AttachmentPathHook | undefined;
let beforeAttachmentTargetFileWriteForTests: AttachmentPathHook | undefined;
let beforeAttachmentTargetCloseForTests: AttachmentPathHook | undefined;

export function setWorkflowMessageAttachmentTargetWriteHookForTests(
  hook: AttachmentPathHook | undefined,
): () => void {
  const previousHook = beforeAttachmentTargetWriteForTests;
  beforeAttachmentTargetWriteForTests = hook;
  return () => {
    beforeAttachmentTargetWriteForTests = previousHook;
  };
}

export function setWorkflowMessageAttachmentSourceOpenHookForTests(
  hook: AttachmentPathHook | undefined,
): () => void {
  const previousHook = beforeAttachmentSourceOpenForTests;
  beforeAttachmentSourceOpenForTests = hook;
  return () => {
    beforeAttachmentSourceOpenForTests = previousHook;
  };
}

export function setWorkflowMessageAttachmentTargetFileWriteHookForTests(
  hook: AttachmentPathHook | undefined,
): () => void {
  const previousHook = beforeAttachmentTargetFileWriteForTests;
  beforeAttachmentTargetFileWriteForTests = hook;
  return () => {
    beforeAttachmentTargetFileWriteForTests = previousHook;
  };
}

export function setWorkflowMessageAttachmentTargetCloseHookForTests(
  hook: AttachmentPathHook | undefined,
): () => void {
  const previousHook = beforeAttachmentTargetCloseForTests;
  beforeAttachmentTargetCloseForTests = hook;
  return () => {
    beforeAttachmentTargetCloseForTests = previousHook;
  };
}

export async function runBeforeAttachmentTargetWriteForTests(
  targetAbsolutePath: string,
): Promise<void> {
  await beforeAttachmentTargetWriteForTests?.(targetAbsolutePath);
}

export async function runBeforeAttachmentSourceOpenForTests(
  sourceRealPath: string,
): Promise<void> {
  await beforeAttachmentSourceOpenForTests?.(sourceRealPath);
}

export async function runBeforeAttachmentTargetFileWriteForTests(
  targetAbsolutePath: string,
): Promise<void> {
  await beforeAttachmentTargetFileWriteForTests?.(targetAbsolutePath);
}

export async function runBeforeAttachmentTargetCloseForTests(
  targetAbsolutePath: string,
): Promise<void> {
  await beforeAttachmentTargetCloseForTests?.(targetAbsolutePath);
}
