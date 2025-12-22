import { prisma } from '../lib/prisma';
import { getUserById } from './user';

export const wormScoreResolvers = {
  WormScore: {
    user: async (wormScore: { userId: string }) => {
      return await getUserById(wormScore.userId);
    },
    createdAt: (wormScore: { createdAt: Date }) => {
      return wormScore.createdAt.toISOString();
    },
  },
  Query: {
    myHighScore: async (
      _: any,
      { levelId }: { levelId: string },
      context: any
    ) => {
      if (!context.user) {
        return null;
      }

      const highScore = await prisma.wormScore.findFirst({
        where: {
          userId: context.user.id,
          levelId,
        },
        orderBy: {
          score: 'desc',
        },
      });

      return highScore;
    },
    levelHighScores: async (
      _: any,
      { levelId, limit = 10 }: { levelId: string; limit?: number }
    ) => {
      const highScores = await prisma.wormScore.findMany({
        where: { levelId },
        orderBy: { score: 'desc' },
        take: limit,
        distinct: ['userId'],
      });

      return highScores;
    },
  },
  Mutation: {
    submitWormScore: async (
      _: any,
      { levelId, score }: { levelId: string; score: number },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to submit a score');
      }

      const userId = context.user.id;

      // Check if user already has a score for this level
      const existingScore = await prisma.wormScore.findFirst({
        where: {
          userId,
          levelId,
        },
        orderBy: {
          score: 'desc',
        },
      });

      // Only save if it's a new high score
      if (existingScore && existingScore.score >= score) {
        return existingScore;
      }

      // Create new score record
      const wormScore = await prisma.wormScore.create({
        data: {
          userId,
          levelId,
          score,
        },
      });

      return wormScore;
    },
  },
};
