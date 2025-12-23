import { prisma } from '../lib/prisma';
import { getUserById } from './user';

export const lifeScoreResolvers = {
  Query: {
    lifeScore: async (_: any, { id }: { id: string }) => {
      return await prisma.lifeScore.findUnique({
        where: { id },
      });
    },
  },
  LifeScore: {
    user: async (lifeScore: { userId: string }) => {
      return await getUserById(lifeScore.userId);
    },
    createdAt: (lifeScore: { createdAt: Date }) => {
      return lifeScore.createdAt.toISOString();
    },
    // Only show statusText to the owner or their friends
    statusText: async (
      lifeScore: { userId: string; statusText: string | null },
      _: any,
      context: any
    ) => {
      if (!lifeScore.statusText) return null;
      if (!context.user) return null;

      // Owner can always see their own status
      if (context.user.id === lifeScore.userId) {
        return lifeScore.statusText;
      }

      // Check if viewer is friends with the score owner
      const connection = await prisma.userConnection.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { senderId: context.user.id, receiverId: lifeScore.userId },
            { senderId: lifeScore.userId, receiverId: context.user.id },
          ],
        },
      });

      return connection ? lifeScore.statusText : null;
    },
  },
  Mutation: {
    postLifeScore: async (
      _: any,
      { score, statusText }: { score: number; statusText?: string },
      context: any
    ) => {
      // Double-check authentication (GraphQL Shield should handle this)
      if (!context.user) {
        throw new Error('You must be logged in to post a score');
      }

      const userId = context.user.id;

      // Validate score is between 0 and 10
      if (score < 0 || score > 10) {
        throw new Error('Score must be between 0 and 10');
      }

      const lifeScore = await prisma.lifeScore.create({
        data: {
          userId,
          score,
          statusText: statusText?.trim() || null,
        },
      });

      return lifeScore;
    },
    deleteLifeScore: async (_: any, { id }: { id: string }, context: any) => {
      const lifeScore = await prisma.lifeScore.findUnique({
        where: { id },
      });

      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // Check if user owns this score
      if (lifeScore.userId !== context.user.id) {
        throw new Error('You can only delete your own scores');
      }

      await prisma.lifeScore.delete({
        where: { id },
      });

      return true;
    },
  },
};
