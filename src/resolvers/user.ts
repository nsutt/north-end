import { generateToken } from '../utils/auth';
import { prisma } from '../lib/prisma';

interface CreateUserInput {
  displayName?: string;
  avatarUrl?: string;
}

interface UpdateUserInput {
  displayName?: string;
  avatarUrl?: string;
}

// Export for use by other resolvers (auth)
export async function getUserById(id: string) {
  return await prisma.user.findUnique({
    where: { id },
  });
}

export const userResolvers = {
  Query: {
    user: async (_: any, { id }: { id: string }) => {
      return await prisma.user.findUnique({
        where: { id },
      });
    },
    users: async () => {
      return await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
      });
    },
    me: async (_: any, __: any, context: any) => {
      if (!context.user) {
        return null;
      }
      return await prisma.user.findUnique({
        where: { id: context.user.id },
      });
    },
  },
  Mutation: {
    createUser: async (_: any, { input }: { input?: CreateUserInput }) => {
      const user = await prisma.user.create({
        data: {
          displayName: input?.displayName,
          avatarUrl: input?.avatarUrl,
        },
      });

      // Generate JWT token
      const token = generateToken(user.id);

      return {
        user,
        token,
      };
    },
    updateUser: async (
      _: any,
      { id, input }: { id: string; input: UpdateUserInput }
    ) => {
      const user = await prisma.user.update({
        where: { id },
        data: {
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
        },
      });
      return user;
    },
  },
  User: {
    // Serialize DateTime fields to ISO strings
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    updatedAt: (parent: { updatedAt: Date }) => {
      return parent.updatedAt.toISOString();
    },
    // Resolve currentScore field
    currentScore: async (parent: any) => {
      const latestScore = await prisma.lifeScore.findFirst({
        where: { userId: parent.id },
        orderBy: { createdAt: 'desc' },
      });
      return latestScore;
    },
    // Resolve lifeScores field
    lifeScores: async (parent: any) => {
      return await prisma.lifeScore.findMany({
        where: { userId: parent.id },
        orderBy: { createdAt: 'desc' },
      });
    },
  },
};
