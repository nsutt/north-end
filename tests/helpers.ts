import { graphql, type ExecutionResult } from 'graphql';
import { GroupRole, MembershipStatus, type User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { buildSchema } from '../src/schemaBuilder';

export { prisma };

const schema = buildSchema();

/** The request context the server builds: the signed-in user's database row, or null. */
export interface TestContext {
  user: User | null;
}

/**
 * Runs a GraphQL operation in-process against the server's schema (resolvers +
 * GraphQL Shield), as `user` (or signed out when `user` is null/omitted).
 */
export async function execute<TData = any>(
  source: string,
  variables: Record<string, unknown> = {},
  user: User | null = null
): Promise<ExecutionResult<TData>> {
  // A fresh context per operation, like a real request (Shield caches rule results on it)
  const contextValue: TestContext = { user };
  return (await graphql({ schema, source, variableValues: variables, contextValue })) as ExecutionResult<TData>;
}

/** Runs an operation that must succeed and returns its data. */
export async function executeOk<TData = any>(
  source: string,
  variables: Record<string, unknown> = {},
  user: User | null = null
): Promise<TData> {
  const result = await execute<TData>(source, variables, user);
  if (result.errors?.length) {
    throw new Error(`Expected success, got: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  // Plain objects (graphql-js returns null-prototype ones), so deepEqual works in assertions
  return JSON.parse(JSON.stringify(result.data)) as TData;
}

/** Runs an operation that must fail and returns its first error message. */
export async function executeError(
  source: string,
  variables: Record<string, unknown> = {},
  user: User | null = null
): Promise<string> {
  const result = await execute(source, variables, user);
  if (!result.errors?.length) {
    throw new Error(`Expected an error, got data: ${JSON.stringify(result.data)}`);
  }
  return result.errors[0].message;
}

/** Empties every table in the test database (setup.ts guarantees it's the test database). */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Lets fire-and-forget work (push notifications) started by a mutation finish, then
 * closes the connection pool so the test process can exit. Call from `after()`.
 */
export async function closeDatabase() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await prisma.$disconnect();
}

let counter = 0;
function nextId() {
  counter += 1;
  return `${process.pid}-${counter}`;
}

export async function createUser(overrides: Partial<Pick<User, 'displayName' | 'email' | 'features' | 'appleUserId'>> = {}) {
  const id = nextId();
  return await prisma.user.create({
    data: {
      displayName: `Test User ${id}`,
      uniqueCode: `code-${id}`,
      ...overrides,
    },
  });
}

/** Creates a group owned by `owner`, with the given users as accepted members. */
export async function createGroup(owner: User, members: User[] = [], name = 'Test Group') {
  return await prisma.group.create({
    data: {
      name,
      createdById: owner.id,
      inviteCode: `invite-${nextId()}`,
      memberships: {
        create: [
          { userId: owner.id, role: GroupRole.OWNER, status: MembershipStatus.ACCEPTED, joinedAt: new Date() },
          ...members.map((m) => ({
            userId: m.id,
            role: GroupRole.MEMBER,
            status: MembershipStatus.ACCEPTED,
            joinedAt: new Date(),
          })),
        ],
      },
    },
  });
}

/** Creates a vibe (life score) by `user`, shared with the given groups. */
export async function createLifeScore(
  user: User,
  groupIds: string[] = [],
  data: { score?: number; statusText?: string | null } = {}
) {
  return await prisma.lifeScore.create({
    data: {
      userId: user.id,
      score: data.score ?? 7,
      statusText: data.statusText ?? null,
      groups: { create: groupIds.map((groupId) => ({ groupId })) },
    },
  });
}
