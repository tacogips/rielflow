import type { FileHandle } from "node:fs/promises";

const COPY_BUFFER_BYTES = 1024 * 1024;

export async function copyFileHandleContents(
  sourceHandle: FileHandle,
  targetHandle: FileHandle,
): Promise<void> {
  const copyBuffer = new Uint8Array(COPY_BUFFER_BYTES);
  for (;;) {
    const { bytesRead } = await sourceHandle.read(
      copyBuffer,
      0,
      copyBuffer.byteLength,
      null,
    );
    if (bytesRead === 0) {
      break;
    }
    await writeAllBytes(targetHandle, copyBuffer.subarray(0, bytesRead));
  }
}

async function writeAllBytes(
  targetHandle: FileHandle,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await targetHandle.write(chunk.subarray(offset));
    if (bytesWritten <= 0) {
      throw new Error("message attachment copy made no write progress");
    }
    offset += bytesWritten;
  }
}
