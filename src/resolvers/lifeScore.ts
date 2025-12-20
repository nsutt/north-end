interface LifeScore {
  id: string;
  userId: string;
  score: number;
  createdAt: string;
}

import { getUserById } from './user';

// In-memory storage (replace with database later)
const lifeScores: Map<string, LifeScore> = new Map();
let nextId = 1;

export const lifeScoreResolvers = {
  LifeScore: {
    user: (lifeScore: LifeScore) => {
      return getUserById(lifeScore.userId);
    },
  },
  User: {
    lifeScores: (user: { id: string }) => {
      // Get all life scores for this user
      return Array.from(lifeScores.values()).filter(
        (score) => score.userId === user.id
      );
    },
    currentScore: (user: { id: string }) => {
      // Get the most recent life score for this user
      const userScores = Array.from(lifeScores.values())
        .filter((score) => score.userId === user.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return userScores[0] || null;
    },
  },
  Mutation: {
    postLifeScore: (
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

      const lifeScore: LifeScore = {
        id: String(nextId++),
        userId,
        score,
        createdAt: new Date().toISOString(),
      };

      lifeScores.set(lifeScore.id, lifeScore);
      return lifeScore;
    },
    deleteLifeScore: (_: any, { id }: { id: string }, context: any) => {
      const lifeScore = lifeScores.get(id);

      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // Check if user owns this score
      if (lifeScore.userId !== context.user.id) {
        throw new Error('You can only delete your own scores');
      }

      const deleted = lifeScores.delete(id);
      return deleted;
    },
  },
};
