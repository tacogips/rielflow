export interface AgentCliCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly message?: string;
}
