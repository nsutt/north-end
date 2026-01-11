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

// Helper: Get comment with associated group and score info
async function getCommentWithContext(commentId: string) {
  return await prisma.scoreComment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      groupId: true,
      lifeScoreId: true,
      lifeScore: {
        select: { userId: true },
      },
    },
  });
}

// Validate emoji - ensure it's not empty and not too long
function isValidEmoji(str: string): boolean {
  if (!str || str.length === 0 || str.length > 8) return false;
  return true;
}

export const commentReactionResolvers = {
  CommentReaction: {
    user: async (parent: { userId: string }) => {
      return await getUserById(parent.userId);
    },
    comment: async (parent: { commentId: string }) => {
      return await prisma.scoreComment.findUnique({
        where: { id: parent.commentId },
      });
    },
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
  },

  Mutation: {
    toggleCommentReaction: async (
      _: any,
      { commentId, emoji }: { commentId: string; emoji: string },
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

      const comment = await getCommentWithContext(commentId);
      if (!comment) {
        throw new Error('Comment not found');
      }

      // Check authorization: must be able to view the comment
      // (group member or score owner)
      const isScoreOwner = comment.lifeScore.userId === context.user.id;
      const isGroupMemberUser = comment.groupId
        ? await isGroupMember(context.user.id, comment.groupId)
        : false;

      if (!isScoreOwner && !isGroupMemberUser) {
        throw new Error('You must be a member of this group to react');
      }

      // Check for existing reaction
      const existingReaction = await prisma.commentReaction.findUnique({
        where: {
          commentId_userId: {
            commentId,
            userId: context.user.id,
          },
        },
      });

      if (existingReaction) {
        if (existingReaction.emoji === trimmedEmoji) {
          // Same emoji - remove reaction (toggle off)
          await prisma.commentReaction.delete({
            where: { id: existingReaction.id },
          });
          return { action: 'REMOVED', reaction: null };
        } else {
          // Different emoji - replace reaction
          const updatedReaction = await prisma.commentReaction.update({
            where: { id: existingReaction.id },
            data: { emoji: trimmedEmoji },
          });
          return { action: 'REPLACED', reaction: updatedReaction };
        }
      } else {
        // No existing reaction - use upsert to handle race conditions
        // (optimistic updates may cause duplicate requests)
        const newReaction = await prisma.commentReaction.upsert({
          where: {
            commentId_userId: {
              commentId,
              userId: context.user.id,
            },
          },
          update: { emoji: trimmedEmoji },
          create: {
            commentId,
            userId: context.user.id,
            emoji: trimmedEmoji,
          },
        });
        return { action: 'ADDED', reaction: newReaction };
      }
    },
  },
};
