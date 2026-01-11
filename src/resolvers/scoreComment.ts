import { prisma } from '../lib/prisma';
import { getUserById } from './user';
import { MembershipStatus } from '@prisma/client';

// Helper: Check if user is a member of a group
async function isGroupMember(userId: string, groupId: string): Promise<boolean> {
  const membership = await prisma.groupMembership.findUnique({
    where: {
      groupId_userId: { groupId, userId },
    },
  });
  return membership?.status === MembershipStatus.ACCEPTED;
}

// Helper: Check if score was posted to a group
async function isScoreInGroup(lifeScoreId: string, groupId: string): Promise<boolean> {
  const lifeScoreGroup = await prisma.lifeScoreGroup.findUnique({
    where: {
      lifeScoreId_groupId: { lifeScoreId, groupId },
    },
  });
  return !!lifeScoreGroup;
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
    group: async (parent: { groupId: string | null }) => {
      if (!parent.groupId) return null;
      return await prisma.group.findUnique({
        where: { id: parent.groupId },
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
    // Comment reactions
    reactionSummary: async (
      parent: { id: string },
      _args: any,
      context: any
    ) => {
      const reactions = await prisma.commentReaction.findMany({
        where: {
          commentId: parent.id,
        },
        include: {
          user: true,
        },
      });

      // Group by emoji
      const emojiMap = new Map<string, { count: number; userIds: Set<string>; users: any[] }>();

      for (const reaction of reactions) {
        if (!emojiMap.has(reaction.emoji)) {
          emojiMap.set(reaction.emoji, { count: 0, userIds: new Set(), users: [] });
        }
        const group = emojiMap.get(reaction.emoji)!;
        group.count++;
        group.userIds.add(reaction.userId);
        group.users.push(reaction.user);
      }

      const currentUserId = context.user?.id;

      return Array.from(emojiMap.entries()).map(([emoji, { count, userIds, users }]) => ({
        emoji,
        count,
        hasReacted: currentUserId ? userIds.has(currentUserId) : false,
        users,
      }));
    },
    myReaction: async (
      parent: { id: string },
      _args: any,
      context: any
    ) => {
      if (!context.user) return null;

      const reaction = await prisma.commentReaction.findUnique({
        where: {
          commentId_userId: {
            commentId: parent.id,
            userId: context.user.id,
          },
        },
      });

      if (!reaction) return null;

      return {
        id: reaction.id,
        emoji: reaction.emoji,
      };
    },
  },

  LifeScore: {
    comments: async (
      parent: { id: string },
      { groupId }: { groupId?: string }
    ) => {
      // If groupId provided, filter by it; otherwise return all comments
      return await prisma.scoreComment.findMany({
        where: {
          lifeScoreId: parent.id,
          ...(groupId ? { groupId } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
    },
  },

  Query: {
    scoreComments: async (
      _: any,
      { lifeScoreId, groupId }: { lifeScoreId: string; groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to view comments');
      }

      const lifeScore = await getLifeScoreWithOwner(lifeScoreId);
      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // Check if user is owner of the score
      const isOwner = lifeScore.userId === context.user.id;

      // Check if user is a member of the specified group
      const isMember = await isGroupMember(context.user.id, groupId);

      if (!isOwner && !isMember) {
        throw new Error('You must be a member of this group to view comments');
      }

      // Check if the score was posted to this group
      const scoreInGroup = await isScoreInGroup(lifeScoreId, groupId);
      if (!scoreInGroup) {
        throw new Error('This score was not posted to this group');
      }

      return await prisma.scoreComment.findMany({
        where: { lifeScoreId, groupId },
        orderBy: { createdAt: 'asc' },
      });
    },
  },

  Mutation: {
    addScoreComment: async (
      _: any,
      { lifeScoreId, groupId, content, gifUrl }: { lifeScoreId: string; groupId: string; content: string; gifUrl?: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to add a comment');
      }

      const lifeScore = await getLifeScoreWithOwner(lifeScoreId);
      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // Check if user is owner of the score
      const isOwner = lifeScore.userId === context.user.id;

      // Check if user is a member of the specified group
      const isMember = await isGroupMember(context.user.id, groupId);

      if (!isOwner && !isMember) {
        throw new Error('You must be a member of this group to comment');
      }

      // Check if the score was posted to this group
      const scoreInGroup = await isScoreInGroup(lifeScoreId, groupId);
      if (!scoreInGroup) {
        throw new Error('This score was not posted to this group');
      }

      // Validate content - must have content or gifUrl
      const trimmedContent = content.trim();
      if (!trimmedContent && !gifUrl) {
        throw new Error('Comment must have content or a GIF');
      }
      if (trimmedContent.length > 500) {
        throw new Error('Comment must be 500 characters or less');
      }

      // Validate gifUrl if provided
      if (gifUrl) {
        const validGiphyPattern = /^https:\/\/(media\d?\.giphy\.com|giphy\.com)\//;
        if (!validGiphyPattern.test(gifUrl)) {
          throw new Error('GIF must be from Giphy');
        }
      }

      return await prisma.scoreComment.create({
        data: {
          lifeScoreId,
          groupId,
          authorId: context.user.id,
          content: trimmedContent,
          gifUrl: gifUrl || null,
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
