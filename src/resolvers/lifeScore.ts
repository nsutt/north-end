import { prisma } from '../lib/prisma';
import { getUserById } from './user';

export const lifeScoreResolvers = {
  LifeScore: {
    user: async (lifeScore: { userId: string }) => {
      return await getUserById(lifeScore.userId);
    },
  },
  Mutation: {
    postLifeScore: async (
      _: any,
      { score }: { score: number },
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
