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

// Validate emoji - ensure it's not empty and not too long
function isValidEmoji(str: string): boolean {
  if (!str || str.length === 0 || str.length > 8) return false;
  return true;
}

export const scoreReactionResolvers = {
  ScoreReaction: {
    user: async (parent: { userId: string }) => {
      return await getUserById(parent.userId);
    },
    lifeScore: async (parent: { lifeScoreId: string }) => {
      return await prisma.lifeScore.findUnique({
        where: { id: parent.lifeScoreId },
      });
    },
    group: async (parent: { groupId: string }) => {
      return await prisma.group.findUnique({
        where: { id: parent.groupId },
      });
    },
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
  },

  LifeScore: {
    reactionSummary: async (
      parent: { id: string },
      { groupId }: { groupId: string },
      context: any
    ) => {
      const reactions = await prisma.scoreReaction.findMany({
        where: {
          lifeScoreId: parent.id,
          groupId,
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
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) return null;

      const reaction = await prisma.scoreReaction.findUnique({
        where: {
          lifeScoreId_userId_groupId: {
            lifeScoreId: parent.id,
            userId: context.user.id,
            groupId,
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

  Mutation: {
    toggleScoreReaction: async (
      _: any,
      { lifeScoreId, groupId, emoji }: { lifeScoreId: string; groupId: string; emoji: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to react');
      }

      // Validate emoji
      const trimmedEmoji = emoji.trim();
      if (!isValidEmoji(trimmedEmoji)) {
        throw new Error('Invalid emoji');
      }

      const lifeScore = await getLifeScoreWithOwner(lifeScoreId);
      if (!lifeScore) {
        throw new Error('Life score not found');
      }

      // Check authorization: must be score owner or group member
      const isOwner = lifeScore.userId === context.user.id;
      const isMember = await isGroupMember(context.user.id, groupId);

      if (!isOwner && !isMember) {
        throw new Error('You must be a member of this group to react');
      }

      // Check score is posted to this group
      const scoreInGroup = await isScoreInGroup(lifeScoreId, groupId);
      if (!scoreInGroup) {
        throw new Error('This score was not posted to this group');
      }

      // Check for existing reaction
      const existingReaction = await prisma.scoreReaction.findUnique({
        where: {
          lifeScoreId_userId_groupId: {
            lifeScoreId,
            userId: context.user.id,
            groupId,
          },
        },
      });

      if (existingReaction) {
        if (existingReaction.emoji === trimmedEmoji) {
          // Same emoji - remove reaction (toggle off)
          await prisma.scoreReaction.delete({
            where: { id: existingReaction.id },
          });
          return { action: 'REMOVED', reaction: null };
        } else {
          // Different emoji - replace reaction
          const updatedReaction = await prisma.scoreReaction.update({
            where: { id: existingReaction.id },
            data: { emoji: trimmedEmoji },
          });
          return { action: 'REPLACED', reaction: updatedReaction };
        }
      } else {
        // No existing reaction - use upsert to handle race conditions
        // (optimistic updates may cause duplicate requests)
        const newReaction = await prisma.scoreReaction.upsert({
          where: {
            lifeScoreId_userId_groupId: {
              lifeScoreId,
              userId: context.user.id,
              groupId,
            },
          },
          update: { emoji: trimmedEmoji },
          create: {
            lifeScoreId,
            userId: context.user.id,
            groupId,
            emoji: trimmedEmoji,
          },
        });
        return { action: 'ADDED', reaction: newReaction };
      }
    },
  },
};
