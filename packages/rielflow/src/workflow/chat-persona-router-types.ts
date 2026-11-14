export interface ChatPersonaRouterPersonaConfig {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
}

export interface ChatPersonaRouterConfig {
  readonly defaultPersonaId: string;
  readonly personas: readonly ChatPersonaRouterPersonaConfig[];
  readonly textTemplate?: string;
}

export interface ResolvedChatPersonaRouterAddon {
  readonly name: "rielflow/chat-persona-router";
  readonly version: "1";
  readonly config: ChatPersonaRouterConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}
