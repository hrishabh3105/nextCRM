import { prisma, Prisma, PrismaClient } from "@nextcrm/db";

/**
 * NOTE / DEBUGGING CONTEXT:
 * Known Prisma issue: Concurrent findUnique calls combined with extendedWhereUnique
 * and compound unique constraints (e.g. @@unique([workspaceId, phone])) may potentially
 * return null under concurrent load due to query translation behavior.
 * Flagged for future monitoring / debugging context.
 *
 * Set of model names that belong to a workspace (contain a `workspaceId` field).
 * Discovered dynamically from Prisma DMMF. Fails loudly at module load time if unavailable
 * to prevent silent bypass of tenant isolation.
 */
if (!Prisma.dmmf?.datamodel?.models) {
  throw new Error(
    "TenantScope initialization failed: Prisma.dmmf.datamodel.models is unavailable. " +
      "Tenant isolation models cannot be dynamically verified."
  );
}

const TENANT_MODELS = new Set<string>(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "workspaceId"))
    .map((model) => model.name)
);

/**
 * Creates a Prisma Client Extension that enforces tenant scoping for a given workspaceId.
 * Automatically injects `{ workspaceId }` into:
 * - Queries: findMany, findFirst, findUnique, findFirstOrThrow, findUniqueOrThrow, count, aggregate, update, updateMany, delete, deleteMany (where clause)
 * - Writes: create, createMany, upsert (data payload and where clause)
 */
export const createTenantScopeExtension = (workspaceId: string) => {
  return Prisma.defineExtension({
    name: "tenantScope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // If the model is not tenant-scoped (does not have a workspaceId), proceed without modification
          if (!model || !TENANT_MODELS.has(model)) {
            return query(args);
          }

          const currentArgs = (args ?? {}) as any;

          switch (operation) {
            case "findMany":
            case "findFirst":
            case "findUnique":
            case "findFirstOrThrow":
            case "findUniqueOrThrow":
            case "count":
            case "aggregate":
            case "groupBy":
            case "update":
            case "updateMany":
            case "delete":
            case "deleteMany": {
              currentArgs.where = {
                ...currentArgs.where,
                workspaceId,
              };
              return query(currentArgs);
            }

            case "create": {
              currentArgs.data = {
                ...currentArgs.data,
                workspaceId,
              };
              return query(currentArgs);
            }

            case "createMany": {
              if (Array.isArray(currentArgs.data)) {
                currentArgs.data = currentArgs.data.map((item: any) => ({
                  ...item,
                  workspaceId,
                }));
              } else if (currentArgs.data) {
                currentArgs.data = {
                  ...currentArgs.data,
                  workspaceId,
                };
              }
              return query(currentArgs);
            }

            case "upsert": {
              currentArgs.where = {
                ...currentArgs.where,
                workspaceId,
              };
              currentArgs.create = {
                ...currentArgs.create,
                workspaceId,
              };
              return query(currentArgs);
            }

            default:
              return query(args);
          }
        },
      },
    },
  });
};

/**
 * Tenant scoping helper function.
 * Returns a Prisma Client Extension using `Prisma.defineExtension` or directly extends the provided PrismaClient.
 *
 * It intercepts queries (findMany, findFirst, findUnique, count, aggregate, update, updateMany, delete, deleteMany)
 * and writes (create, upsert) to automatically enforce multi-tenant isolation with { workspaceId }.
 *
 * Usage:
 * - Direct extension: `const scopedDb = forWorkspace(workspaceId, prisma);`
 * - Client.$extends: `const scopedDb = prisma.$extends(forWorkspace(workspaceId));`
 */
const getScopedClient = (workspaceId: string) => {
  return prisma.$extends(createTenantScopeExtension(workspaceId));
};

export type TenantScopedClient = ReturnType<typeof getScopedClient>;

export function forWorkspace(
  workspaceId: string
): TenantScopedClient;
export function forWorkspace<TClient extends PrismaClient>(
  workspaceId: string,
  client: TClient
): ReturnType<TClient["$extends"]>;
export function forWorkspace<TClient extends PrismaClient>(
  client: TClient,
  workspaceId: string
): ReturnType<TClient["$extends"]>;
export function forWorkspace(
  arg1: string | PrismaClient,
  arg2?: PrismaClient | string
): any {
  if (typeof arg1 === "string") {
    const workspaceId = arg1;
    const extension = createTenantScopeExtension(workspaceId);
    const client =
      arg2 && typeof arg2 === "object" && "$extends" in arg2
        ? (arg2 as PrismaClient)
        : prisma;
    return client.$extends(extension);
  } else {
    const client = arg1;
    const workspaceId = arg2 as string;
    const extension = createTenantScopeExtension(workspaceId);
    return client.$extends(extension);
  }
}
