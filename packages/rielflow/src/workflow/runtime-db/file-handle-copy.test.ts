import type { FileHandle } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { copyFileHandleContents } from "./file-handle-copy";

describe("copyFileHandleContents", () => {
  test("continues writing until each read chunk is fully written", async () => {
    const sourceChunks = [
      new TextEncoder().encode("first chunk "),
      new TextEncoder().encode("second chunk"),
    ];
    let sourceIndex = 0;
    const writtenBytes: number[] = [];
    const sourceHandle = {
      async read(buffer: Uint8Array) {
        const chunk = sourceChunks[sourceIndex];
        if (chunk === undefined) {
          return { bytesRead: 0, buffer };
        }
        sourceIndex += 1;
        buffer.set(chunk);
        return { bytesRead: chunk.byteLength, buffer };
      },
    } as unknown as FileHandle;
    const targetHandle = {
      async write(chunk: Uint8Array) {
        const bytesToWrite = Math.max(1, Math.floor(chunk.byteLength / 2));
        writtenBytes.push(...chunk.subarray(0, bytesToWrite));
        return { bytesWritten: bytesToWrite, buffer: chunk };
      },
    } as unknown as FileHandle;

    await copyFileHandleContents(sourceHandle, targetHandle);

    expect(new TextDecoder().decode(new Uint8Array(writtenBytes))).toBe(
      "first chunk second chunk",
    );
  });
});
