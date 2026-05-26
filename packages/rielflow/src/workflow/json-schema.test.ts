import { describe, expect, test } from "vitest";
import {
  validateJsonSchemaDefinition,
  validateJsonValueAgainstSchema,
} from "./json-schema";
import type { JsonObject } from "./types";

describe("validateJsonSchemaDefinition", () => {
  test("rejects root schemas that cannot accept a top-level object payload", () => {
    expect(
      validateJsonSchemaDefinition({
        type: "string",
      } as JsonObject),
    ).toEqual([
      {
        path: "$schema",
        message:
          "must allow object because node output payloads are always top-level JSON objects",
      },
    ]);
  });

  test("rejects combinator root schemas that cannot accept a top-level object payload", () => {
    expect(
      validateJsonSchemaDefinition({
        anyOf: [{ type: "string" }, { type: "number" }],
      } as unknown as JsonObject),
    ).toEqual([
      {
        path: "$schema",
        message:
          "must allow object because node output payloads are always top-level JSON objects",
      },
    ]);
  });

  test("does not emit spurious parent schema errors when unrelated sibling keywords fail", () => {
    const errors = validateJsonSchemaDefinition({
      type: "object",
      not: { type: "null" },
      additionalProperties: {
        type: "string",
      },
      items: {
        type: "string",
      },
    } as unknown as JsonObject);

    expect(errors).toEqual([
      {
        path: "$schema.not",
        message: "uses an unsupported JSON Schema keyword",
      },
    ]);
  });
});

describe("validateJsonValueAgainstSchema", () => {
  test("treats object-valued const as order-insensitive", () => {
    expect(
      validateJsonValueAgainstSchema({
        schema: {
          type: "object",
          const: {
            summary: "ok",
            metadata: {
              count: 1,
              status: "done",
            },
          },
        } as JsonObject,
        value: {
          metadata: {
            status: "done",
            count: 1,
          },
          summary: "ok",
        },
      }),
    ).toEqual([]);
  });

  test("treats object-valued enum entries as order-insensitive", () => {
    expect(
      validateJsonValueAgainstSchema({
        schema: {
          type: "object",
          enum: [
            {
              summary: "ok",
              metadata: {
                count: 1,
                status: "done",
              },
            },
          ],
        } as JsonObject,
        value: {
          metadata: {
            status: "done",
            count: 1,
          },
          summary: "ok",
        },
      }),
    ).toEqual([]);
  });
});
