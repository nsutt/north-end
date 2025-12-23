import { prisma } from '../lib/prisma';
import { getUserById } from './user';

// Helper: Check if two users are friends (accepted connection)
async function areFriends(userId1: string, userId2: string): Promise<boolean> {
  const connection = await prisma.userConnection.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { senderId: userId1, receiverId: userId2 },
        { senderId: userId2, receiverId: userId1 },
      ],
    },
  });
  return !!connection;
}

// Helper: Get LifeScore with owner info
async function getLifeScoreWithOwner(lifeScoreId: string) {
  return await prisma.lifeScore.findUnique({
    where: { id: lifeScoreId },
    select: { id: true, userId: true },
  });
}

export const scoreCommentResolvers = {
  ScoreComment: {
    author: async (parent: { authorId: string }) => {
      return await getUserById(parent.authorId);
    },
    lifeScore: async (parent: { lifeScoreId: string }) => {
      return await prisma.lifeScore.findUnique({
        where: { id: parent.lifeScoreId },
      });
    },
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    // Computed field: true if comment author is the score owner
    isOwnerComment: async (parent: { authorId: string; lifeScoreId: string }) => {
      const lifeScore = await prisma.lifeScore.findUnique({
        where: { id: parent.lifeScoreId },
        select: { userId: true },
      });
      return lifeScore?.userId === parent.authorId;
    },
  },

  LifeScore: {
    comments: async (parent: { id: string }) => {
      return await prisma.scoreComment.findMany({
        where: { lifeScoreId: parent.id },
        orderBy: { createdAt: 'asc' },
      });
    },
  },

  Query: {
    scoreComments: async (
      _: any,
      { lifeScoreId }: { lifeScoreId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to view comments');
      }

      const lifeScore = await getLifeScoreWithOwner(lifeScoreId);
      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // User can see comments if they own the score OR are friends with owner
      const isOwner = lifeScore.userId === context.user.id;
      const isFriend = await areFriends(context.user.id, lifeScore.userId);

      if (!isOwner && !isFriend) {
        throw new Error('You must be friends with the score owner to view comments');
      }

      return await prisma.scoreComment.findMany({
        where: { lifeScoreId },
        orderBy: { createdAt: 'asc' },
      });
    },
  },

  Mutation: {
    addScoreComment: async (
      _: any,
      { lifeScoreId, content }: { lifeScoreId: string; content: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to add a comment');
      }

      const lifeScore = await getLifeScoreWithOwner(lifeScoreId);
      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // Only the score owner OR their friends can comment
      const isOwner = lifeScore.userId === context.user.id;
      const isFriend = await areFriends(context.user.id, lifeScore.userId);

      if (!isOwner && !isFriend) {
        throw new Error('You must be friends with the score owner to comment');
      }

      // Validate content
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        throw new Error('Comment content cannot be empty');
      }
      if (trimmedContent.length > 500) {
        throw new Error('Comment must be 500 characters or less');
      }

      return await prisma.scoreComment.create({
        data: {
          lifeScoreId,
          authorId: context.user.id,
          content: trimmedContent,
        },
      });
    },

    deleteScoreComment: async (
      _: any,
      { commentId }: { commentId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to delete a comment');
      }

      const comment = await prisma.scoreComment.findUnique({
        where: { id: commentId },
      });

      if (!comment) {
        throw new Error('Comment not found');
      }

      // Only the comment author can delete their comment
      if (comment.authorId !== context.user.id) {
        throw new Error('You can only delete your own comments');
      }

      await prisma.scoreComment.delete({
        where: { id: commentId },
      });

      return true;
    },
  },
};
