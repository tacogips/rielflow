export interface NodeTemplateFieldSpec {
  readonly textField:
    | "systemPromptTemplate"
    | "promptTemplate"
    | "sessionStartPromptTemplate";
  readonly fileField:
    | "systemPromptTemplateFile"
    | "promptTemplateFile"
    | "sessionStartPromptTemplateFile";
}

export const NODE_TEMPLATE_FIELD_SPECS: readonly NodeTemplateFieldSpec[] = [
  {
    fileField: "systemPromptTemplateFile",
    textField: "systemPromptTemplate",
  },
  {
    fileField: "promptTemplateFile",
    textField: "promptTemplate",
  },
  {
    fileField: "sessionStartPromptTemplateFile",
    textField: "sessionStartPromptTemplate",
  },
];
