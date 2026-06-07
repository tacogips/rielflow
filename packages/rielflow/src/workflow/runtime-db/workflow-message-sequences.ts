import { nextCommunicationId } from "../runtime-execution-contracts";
import type { LoadOptions } from "../types";
import { withDatabase } from "./schema-and-record-types";

function communicationCounterFromId(communicationId: string): number | null {
  const match = /^comm-(\d+)$/.exec(communicationId);
  const counterText = match?.[1];
  if (counterText === undefined) {
    return null;
  }
  const counter = Number.parseInt(counterText, 10);
  return Number.isSafeInteger(counter) ? counter : null;
}

export async function allocateNextWorkflowMessageCommunicationId(
  input: {
    readonly workflowExecutionId: string;
    readonly sessionCommunicationCounter: number | undefined;
  },
  options: LoadOptions = {},
): Promise<{
  readonly communicationId: string;
  readonly communicationCounter: number;
}> {
  return await withDatabase(options, (db) => {
    const sessionCounter =
      input.sessionCommunicationCounter === undefined ||
      !Number.isSafeInteger(input.sessionCommunicationCounter) ||
      input.sessionCommunicationCounter < 0
        ? 0
        : input.sessionCommunicationCounter;
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = db
        .query(
          "SELECT communication_id FROM workflow_messages WHERE workflow_execution_id = ?",
        )
        .all(input.workflowExecutionId) as {
        readonly communication_id: string;
      }[];
      const sequenceRow = db
        .query(
          "SELECT last_counter FROM workflow_message_sequences WHERE workflow_execution_id = ?",
        )
        .get(input.workflowExecutionId) as {
        readonly last_counter: number;
      } | null;
      let maxCounter = Math.max(sessionCounter, sequenceRow?.last_counter ?? 0);
      for (const row of rows) {
        const rowCounter = communicationCounterFromId(row.communication_id);
        if (rowCounter !== null && rowCounter > maxCounter) {
          maxCounter = rowCounter;
        }
      }
      const communicationCounter = maxCounter + 1;
      db.query(
        `
          INSERT INTO workflow_message_sequences (
            workflow_execution_id, last_counter
          ) VALUES (?, ?)
          ON CONFLICT(workflow_execution_id) DO UPDATE SET
            last_counter = excluded.last_counter
        `,
      ).run(input.workflowExecutionId, communicationCounter);
      db.exec("COMMIT");
      return {
        communicationCounter,
        communicationId: nextCommunicationId(communicationCounter),
      };
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}
