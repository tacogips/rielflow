import { createSchema } from "graphql-yoga";
import {
  createGraphqlSchema,
  selectGraphqlLlmSessionMessages,
} from "../graphql/schema";
import type { GraphqlRuntimeLlmSessionMessageRecord } from "divedra-graphql";
import type {
  CommunicationsQueryInput,
  ContinueWorkflowExecutionInput,
  CreateWorkflowDefinitionInput,
  DispatchSupervisedWorkflowCommandInput,
  DispatchSupervisorChatGraphqlInput,
  DispatchSupervisorConversationGraphqlInput,
  ExecuteWorkflowInput,
  ExecuteWorkflowSelfImproveGraphqlInput,
  GraphqlRequestContext,
  GraphqlSchemaDependencies,
  LlmSessionMessagesSelectionInput,
  LlmSessionMessageOrder,
  ReplayCommunicationInput,
  RerunWorkflowExecutionInput,
  ResumeWorkflowExecutionInput,
  RetryCommunicationDeliveryInput,
  SaveWorkflowDefinitionInput,
  SendManagerMessageInput,
  SupervisedWorkflowLookupGraphqlInput,
  SupervisorDispatchConversationLookupGraphqlInput,
  ValidateWorkflowDefinitionInput,
  WorkflowCatalogOverviewGraphqlInput,
  WorkflowExecutionsQueryInput,
  WorkflowStatusOverviewGraphqlInput,
  WorkflowSelfImproveReportGraphqlInput,
  WorkflowSelfImproveReportsGraphqlInput,
} from "../graphql/types";
import {
  parseWorkflowOverviewStatus,
  type WorkflowOverviewStatus,
} from "../workflow/overview";
import { parseWorkflowScopeSelector } from "../workflow/paths";
import type { WorkflowScopeSelector } from "../workflow/types";
import { createJsonScalar, GRAPHQL_SCHEMA_TEXT } from "./graphql-schema-text";
const FULL_LLM_SESSION_MESSAGES_SELECTION: LlmSessionMessagesSelectionInput = {
  limit: Number.MAX_SAFE_INTEGER,
};
interface GraphqlLlmSessionMessagesFieldArgs {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}
interface GraphqlLlmSessionMessagesParent {
  readonly llmMessages: readonly GraphqlRuntimeLlmSessionMessageRecord[];
}
function parseOverviewWorkflowScopeArg(
  value: string | undefined | null,
): WorkflowScopeSelector | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = parseWorkflowScopeSelector(value);
  if (parsed !== undefined) {
    return parsed;
  }
  throw new Error(`invalid workflowScope '${value}'`);
}
function parseOverviewAggregateStatusArg(
  value: string | undefined | null,
): WorkflowOverviewStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = parseWorkflowOverviewStatus(value);
  if (parsed !== undefined) {
    return parsed;
  }
  throw new Error(`invalid workflow overview status '${value}'`);
}
function parseWorkflowCatalogOverviewGraphqlArgs(args: {
  readonly workflowScope?: string | null;
  readonly status?: string | null;
  readonly limit?: number | null;
}): WorkflowCatalogOverviewGraphqlInput {
  const workflowScope = parseOverviewWorkflowScopeArg(args.workflowScope);
  const status = parseOverviewAggregateStatusArg(args.status);
  return {
    ...(workflowScope === undefined ? {} : { workflowScope }),
    ...(status === undefined ? {} : { status }),
    ...(args.limit == null ? {} : { limit: args.limit }),
  };
}
function parseWorkflowStatusOverviewGraphqlArgs(args: {
  readonly workflowName: string;
  readonly workflowScope?: string | null;
  readonly limit?: number | null;
}): WorkflowStatusOverviewGraphqlInput {
  const workflowScope = parseOverviewWorkflowScopeArg(args.workflowScope);
  return {
    workflowName: args.workflowName,
    ...(workflowScope === undefined ? {} : { workflowScope }),
    ...(args.limit == null ? {} : { limit: args.limit }),
  };
}
function selectLlmMessagesForField(
  parent: GraphqlLlmSessionMessagesParent,
  args: GraphqlLlmSessionMessagesFieldArgs,
): readonly GraphqlRuntimeLlmSessionMessageRecord[] {
  return selectGraphqlLlmSessionMessages(parent.llmMessages, args);
}
export function createExecutableGraphqlSchema(
  deps: GraphqlSchemaDependencies = {},
) {
  const schema = createGraphqlSchema(deps);
  return createSchema<GraphqlRequestContext>({
    typeDefs: GRAPHQL_SCHEMA_TEXT,
    resolvers: {
      JSON: createJsonScalar(),
      WorkflowSessionState: {
        supervision(parent: { readonly supervision?: unknown }): unknown {
          return parent.supervision ?? null;
        },
      },
      SupervisionRunState: {
        incidents(parent: {
          readonly incidents?: readonly unknown[];
        }): unknown {
          return parent.incidents ?? [];
        },
        remediations(parent: {
          readonly remediations?: readonly unknown[];
        }): unknown {
          return parent.remediations ?? [];
        },
      },
      WorkflowExecutionView: { llmMessages: selectLlmMessagesForField },
      WorkflowExecutionOverviewView: { llmMessages: selectLlmMessagesForField },
      NodeExecutionView: { llmMessages: selectLlmMessagesForField },
      Query: {
        workflows(
          _parent: unknown,
          _args: Record<string, never>,
          context: GraphqlRequestContext,
        ): Promise<readonly string[]> {
          return schema.query.workflows({}, context);
        },
        workflow(
          _parent: unknown,
          args: { readonly workflowName: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflow(args, context);
        },
        workflowDefinition(
          _parent: unknown,
          args: { readonly workflowName: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowDefinition(args, context);
        },
        workflowExecution(
          _parent: unknown,
          args: { readonly workflowExecutionId: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecution(
            { ...args, llmMessages: FULL_LLM_SESSION_MESSAGES_SELECTION },
            context,
          );
        },
        workflowExecutionOverview(
          _parent: unknown,
          args: {
            readonly workflowExecutionId: string;
            readonly recentLogLimit?: number;
            readonly firstCommunications?: number;
            readonly afterCommunicationId?: string;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutionOverview(
            { ...args, llmMessages: FULL_LLM_SESSION_MESSAGES_SELECTION },
            context,
          );
        },
        workflowExecutions(
          _parent: unknown,
          args: WorkflowExecutionsQueryInput,
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutions(args, context);
        },
        workflowCatalogOverview(
          _parent: unknown,
          args: {
            readonly workflowScope?: string | null;
            readonly status?: string | null;
            readonly limit?: number | null;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowCatalogOverview(
            parseWorkflowCatalogOverviewGraphqlArgs(args),
            context,
          );
        },
        workflowStatusOverview(
          _parent: unknown,
          args: {
            readonly workflowName: string;
            readonly workflowScope?: string | null;
            readonly limit?: number | null;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowStatusOverview(
            parseWorkflowStatusOverviewGraphqlArgs(args),
            context,
          );
        },
        communications(
          _parent: unknown,
          args: CommunicationsQueryInput,
          context: GraphqlRequestContext,
        ) {
          return schema.query.communications(args, context);
        },
        communication(
          _parent: unknown,
          args: {
            readonly workflowId: string;
            readonly workflowExecutionId: string;
            readonly communicationId: string;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.communication(args, context);
        },
        nodeExecution(
          _parent: unknown,
          args: {
            readonly workflowId: string;
            readonly workflowExecutionId: string;
            readonly nodeId: string;
            readonly nodeExecId: string;
            readonly recentLogLimit?: number;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.nodeExecution(
            { ...args, llmMessages: FULL_LLM_SESSION_MESSAGES_SELECTION },
            context,
          );
        },
        managerSession(
          _parent: unknown,
          args: { readonly managerSessionId?: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.managerSession(args, context);
        },
        supervisedWorkflowRun(
          _parent: unknown,
          args: { readonly input: SupervisedWorkflowLookupGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.query.supervisedWorkflowRun(args.input, context);
        },
        supervisorDispatchConversation(
          _parent: unknown,
          args: {
            readonly input: SupervisorDispatchConversationLookupGraphqlInput;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.supervisorDispatchConversation(
            args.input,
            context,
          );
        },
        workflowExecutionStepRuns(
          _parent: unknown,
          args: {
            readonly workflowExecutionId: string;
            readonly stepId?: string | null;
            readonly status?: string | null;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutionStepRuns(
            {
              workflowExecutionId: args.workflowExecutionId,
              ...(args.stepId === undefined ||
              args.stepId === null ||
              args.stepId === ""
                ? {}
                : { stepId: args.stepId }),
              ...(args.status === undefined ||
              args.status === null ||
              args.status === ""
                ? {}
                : { status: args.status }),
            },
            context,
          );
        },
        workflowSelfImproveReport(
          _parent: unknown,
          args: WorkflowSelfImproveReportGraphqlInput,
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowSelfImproveReport(args, context);
        },
        workflowSelfImproveReports(
          _parent: unknown,
          args: WorkflowSelfImproveReportsGraphqlInput,
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowSelfImproveReports(args, context);
        },
      },
      Mutation: {
        createWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: CreateWorkflowDefinitionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.createWorkflowDefinition(args.input, context);
        },
        saveWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: SaveWorkflowDefinitionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.saveWorkflowDefinition(args.input, context);
        },
        validateWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: ValidateWorkflowDefinitionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.validateWorkflowDefinition(
            args.input,
            context,
          );
        },
        executeWorkflow(
          _parent: unknown,
          args: { readonly input: ExecuteWorkflowInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.executeWorkflow(args.input, context);
        },
        executeWorkflowSelfImprove(
          _parent: unknown,
          args: { readonly input: ExecuteWorkflowSelfImproveGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.executeWorkflowSelfImprove(
            args.input,
            context,
          );
        },
        resumeWorkflowExecution(
          _parent: unknown,
          args: { readonly input: ResumeWorkflowExecutionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.resumeWorkflowExecution(args.input, context);
        },
        rerunWorkflowExecution(
          _parent: unknown,
          args: { readonly input: RerunWorkflowExecutionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.rerunWorkflowExecution(args.input, context);
        },
        continueWorkflowExecution(
          _parent: unknown,
          args: { readonly input: ContinueWorkflowExecutionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.continueWorkflowExecution(args.input, context);
        },
        sendManagerMessage(
          _parent: unknown,
          args: { readonly input: SendManagerMessageInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.sendManagerMessage(args.input, context);
        },
        retryCommunicationDelivery(
          _parent: unknown,
          args: { readonly input: RetryCommunicationDeliveryInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.retryCommunicationDelivery(
            args.input,
            context,
          );
        },
        replayCommunication(
          _parent: unknown,
          args: { readonly input: ReplayCommunicationInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.replayCommunication(args.input, context);
        },
        cancelWorkflowExecution(
          _parent: unknown,
          args: { readonly input: { readonly workflowExecutionId: string } },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.cancelWorkflowExecution(args.input, context);
        },
        dispatchSupervisedWorkflowCommand(
          _parent: unknown,
          args: { readonly input: DispatchSupervisedWorkflowCommandInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.dispatchSupervisedWorkflowCommand(
            args.input,
            context,
          );
        },
        dispatchSupervisorChat(
          _parent: unknown,
          args: { readonly input: DispatchSupervisorChatGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.dispatchSupervisorChat(args.input, context);
        },
        dispatchSupervisorConversation(
          _parent: unknown,
          args: { readonly input: DispatchSupervisorConversationGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.dispatchSupervisorConversation(
            args.input,
            context,
          );
        },
      },
    },
  });
}
