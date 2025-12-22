import { generateToken } from '../utils/auth';
import { prisma } from '../lib/prisma';
import { generateUniqueCodeSafe } from '../utils/codeGenerator';

interface CreateUserInput {
  displayName: string;
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
      const user = await prisma.user.findUnique({
        where: { id: context.user.id },
      });

      // DEBUG: Log what we're returning
      console.log('🔍 ME Query Debug:', {
        userId: user?.id,
        displayName: user?.displayName,
        uniqueCode: user?.uniqueCode,
        hasUniqueCode: !!user?.uniqueCode
      });

      return user;
    },
  },
  Mutation: {
    createUser: async (_: any, { input }: { input: CreateUserInput }) => {
      // Validate displayName is provided and not empty
      if (!input.displayName?.trim()) {
        throw new Error('Display name is required');
      }

      // Generate unique code for new user
      const uniqueCode = await generateUniqueCodeSafe(prisma);

      const user = await prisma.user.create({
        data: {
          displayName: input.displayName.trim(),
          avatarUrl: input?.avatarUrl,
          uniqueCode,
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
    deleteUser: async (_: any, { id }: { id: string }) => {
      // Delete the user (cascade will delete all related lifeScores)
      await prisma.user.delete({
        where: { id },
      });

      return true;
    },
    loginWithCode: async (_: any, { code }: { code: string }) => {
      // Find user by unique code (case-insensitive)
      const user = await prisma.user.findUnique({
        where: { uniqueCode: code.toLowerCase().trim() },
      });

      if (!user) {
        throw new Error('Invalid code. Please check and try again.');
      }

      // Generate token for existing user
      const token = generateToken(user.id);

      return {
        user,
        token,
      };
    },
    regenerateCode: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to regenerate your code');
      }

      // Generate new unique code
      const newCode = await generateUniqueCodeSafe(prisma);

      // Update user's code
      await prisma.user.update({
        where: { id: context.user.id },
        data: { uniqueCode: newCode },
      });

      return newCode;
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
