import { prisma } from '../lib/prisma';
import { generateUniqueCodeSafe } from '../utils/codeGenerator';

export const inviteResolvers = {
  Invite: {
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    expiresAt: (parent: { expiresAt: Date | null }) => {
      return parent.expiresAt?.toISOString() ?? null;
    },
    createdBy: async (parent: { createdById: string }) => {
      return await prisma.user.findUnique({
        where: { id: parent.createdById },
      });
    },
    usedBy: async (parent: { id: string }) => {
      return await prisma.user.findMany({
        where: { usedInviteId: parent.id },
      });
    },
    useCount: async (parent: { id: string }) => {
      return await prisma.user.count({
        where: { usedInviteId: parent.id },
      });
    },
  },
  Query: {
    invites: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to view invites');
      }
      return await prisma.invite.findMany({
        orderBy: { createdAt: 'desc' },
      });
    },
    invite: async (_: any, { code }: { code: string }) => {
      return await prisma.invite.findUnique({
        where: { code: code.toLowerCase().trim() },
      });
    },
  },
  Mutation: {
    createInvite: async (
      _: any,
      { expiresInDays }: { expiresInDays?: number },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to create invites');
      }

      // Generate unique invite code
      const code = await generateUniqueCodeSafe(prisma, 'invite');

      // Calculate expiration if provided
      let expiresAt: Date | null = null;
      if (expiresInDays) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      }

      const invite = await prisma.invite.create({
        data: {
          code,
          expiresAt,
          createdById: context.user.id,
        },
      });

      return invite;
    },
    expireInvite: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to expire invites');
      }

      // Only allow expiring your own invites
      const invite = await prisma.invite.findUnique({
        where: { id },
      });

      if (!invite) {
        throw new Error('Invite not found');
      }

      if (invite.createdById !== context.user.id) {
        throw new Error('You can only expire your own invites');
      }

      return await prisma.invite.update({
        where: { id },
        data: { expiresAt: new Date() },
      });
    },
    deleteInvite: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to delete invites');
      }

      await prisma.invite.delete({
        where: { id },
      });

      return true;
    },
  },
};
