import { prisma } from '../lib/prisma';
import { getUserById } from './user';
import { MembershipStatus } from '@prisma/client';

export const lifeScoreResolvers = {
  Query: {
    lifeScore: async (_: any, { id }: { id: string }) => {
      return await prisma.lifeScore.findUnique({
        where: { id },
      });
    },
    groupScores: async (
      _: any,
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to view group scores');
      }

      // Verify user is a member of this group
      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId: context.user.id },
        },
      });

      if (!membership || membership.status !== MembershipStatus.ACCEPTED) {
        throw new Error('You must be a member of this group to view scores');
      }

      // Get all scores posted to this group
      const lifeScoreGroups = await prisma.lifeScoreGroup.findMany({
        where: { groupId },
        include: {
          lifeScore: true,
        },
        orderBy: {
          lifeScore: { createdAt: 'desc' },
        },
      });

      return lifeScoreGroups.map((lsg) => lsg.lifeScore);
    },
  },
  LifeScore: {
    user: async (lifeScore: { userId: string }) => {
      return await getUserById(lifeScore.userId);
    },
    createdAt: (lifeScore: { createdAt: Date }) => {
      return lifeScore.createdAt.toISOString();
    },
    groups: async (lifeScore: { id: string }) => {
      const lifeScoreGroups = await prisma.lifeScoreGroup.findMany({
        where: { lifeScoreId: lifeScore.id },
        include: { group: true },
      });
      return lifeScoreGroups.map((lsg) => lsg.group);
    },
    commentCount: async (
      lifeScore: { id: string },
      { groupId }: { groupId: string }
    ) => {
      return await prisma.scoreComment.count({
        where: {
          lifeScoreId: lifeScore.id,
          groupId,
        },
      });
    },
    unreadCommentCount: async (
      lifeScore: { id: string },
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) return 0;

      // Get user's last read timestamp for this score in this group
      const readRecord = await prisma.scoreCommentRead.findUnique({
        where: {
          userId_lifeScoreId_groupId: {
            userId: context.user.id,
            lifeScoreId: lifeScore.id,
            groupId,
          },
        },
      });

      // Count comments newer than last read (excluding user's own comments)
      return await prisma.scoreComment.count({
        where: {
          lifeScoreId: lifeScore.id,
          groupId,
          authorId: { not: context.user.id },
          ...(readRecord ? { createdAt: { gt: readRecord.lastReadAt } } : {}),
        },
      });
    },
    latestComment: async (
      lifeScore: { id: string },
      { groupId }: { groupId: string }
    ) => {
      return await prisma.scoreComment.findFirst({
        where: {
          lifeScoreId: lifeScore.id,
          groupId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    },
    // Only show statusText to the owner or group members
    statusText: async (
      lifeScore: { id: string; userId: string; statusText: string | null },
      _: any,
      context: any
    ) => {
      if (!lifeScore.statusText) return null;
      if (!context.user) return null;

      // Owner can always see their own status
      if (context.user.id === lifeScore.userId) {
        return lifeScore.statusText;
      }

      // Check if viewer shares a group with the score owner through this score
      const sharedGroup = await prisma.lifeScoreGroup.findFirst({
        where: {
          lifeScoreId: lifeScore.id,
          group: {
            memberships: {
              some: {
                userId: context.user.id,
                status: MembershipStatus.ACCEPTED,
              },
            },
          },
        },
      });

      return sharedGroup ? lifeScore.statusText : null;
    },
  },
  Mutation: {
    postLifeScore: async (
      _: any,
      { score, statusText, groupIds }: { score: number; statusText?: string; groupIds?: string[] },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to post a score');
      }

      const userId = context.user.id;

      // Validate score is between 0 and 10
      if (score < 0 || score > 10) {
        throw new Error('Score must be between 0 and 10');
      }

      // If groupIds provided, verify user is a member of all groups
      if (groupIds && groupIds.length > 0) {
        const memberships = await prisma.groupMembership.findMany({
          where: {
            userId,
            groupId: { in: groupIds },
            status: MembershipStatus.ACCEPTED,
          },
        });

        if (memberships.length !== groupIds.length) {
          throw new Error('You must be a member of all selected groups');
        }
      }

      // Create score and group associations in a transaction
      const lifeScore = await prisma.$transaction(async (tx) => {
        const newScore = await tx.lifeScore.create({
          data: {
            userId,
            score,
            statusText: statusText?.trim() || null,
          },
        });

        // Create group associations if groupIds provided
        if (groupIds && groupIds.length > 0) {
          await tx.lifeScoreGroup.createMany({
            data: groupIds.map((groupId) => ({
              lifeScoreId: newScore.id,
              groupId,
            })),
          });
        }

        return newScore;
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
