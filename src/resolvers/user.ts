import { generateToken } from '../utils/auth';
import { prisma } from '../lib/prisma';
import { generateUniqueCodeSafe } from '../utils/codeGenerator';
import { isViewer, viewerIdOf, visibleLifeScoresWhere } from '../utils/access';
import { GroupRole, MembershipStatus, type Prisma } from '@prisma/client';

interface CreateUserInput {
  displayName: string;
  avatarUrl?: string;
}

interface UpdateUserInput {
  displayName?: string;
  avatarUrl?: string;
}

// Export for use by other resolvers (auth)
export async function getUserById(id: string) {
  return await prisma.user.findUnique({
    where: { id },
  });
}

// Sign-in/sign-up mutations call this with the account they just issued a token
// for, so that account's private fields resolve in the same response even though
// context.user is still null for this request
export function setViewer(context: any, userId: string) {
  context.viewerId = userId;
}

// Vibes by `userId` that the viewer may see (all of them for the user themselves)
function lifeScoresVisibleTo(context: any, userId: string): Prisma.LifeScoreWhereInput | null {
  if (isViewer(context, userId)) return { userId };
  const viewerId = viewerIdOf(context);
  if (!viewerId) return null;
  return { userId, ...visibleLifeScoresWhere(viewerId) };
}

export const userResolvers = {
  Query: {
    user: async (_: any, { id }: { id: string }) => {
      return await prisma.user.findUnique({
        where: { id },
      });
    },
    users: async () => {
      return await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
      });
    },
    allUsers: async () => {
      return await prisma.user.findMany({
        orderBy: { displayName: 'asc' },
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    },
    me: async (_: any, __: any, context: any) => {
      if (!context.user) {
        return null;
      }
      const user = await prisma.user.findUnique({
        where: { id: context.user.id },
      });

      // DEBUG: Log what we're returning
      console.log('🔍 ME Query Debug:', {
        userId: user?.id,
        displayName: user?.displayName,
        hasUniqueCode: !!user?.uniqueCode
      });

      return user;
    },
  },
  Mutation: {
    createUser: async (_: any, { input }: { input: CreateUserInput }, context: any) => {
      // Validate displayName is provided and not empty
      if (!input.displayName?.trim()) {
        throw new Error('Display name is required');
      }

      // Generate unique code for new user
      const uniqueCode = await generateUniqueCodeSafe(prisma);

      const user = await prisma.user.create({
        data: {
          displayName: input.displayName.trim(),
          avatarUrl: input?.avatarUrl,
          uniqueCode,
        },
      });

      // Generate JWT token
      const token = generateToken(user.id);
      setViewer(context, user.id);

      return {
        user,
        token,
      };
    },
    updateUser: async (
      _: any,
      { id, input }: { id: string; input: UpdateUserInput },
      context: any
    ) => {
      // Users can only edit their own profile
      if (!context.user || context.user.id !== id) {
        throw new Error('You can only update your own profile');
      }

      const user = await prisma.user.update({
        where: { id },
        data: {
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
        },
      });
      return user;
    },
    deleteUser: async (_: any, { id }: { id: string }, context: any) => {
      // Users can delete their own account; deleting others needs the
      // can-delete-any-user feature flag (the same flag the web UI checks)
      const isSelf = context.user?.id === id;
      const canDeleteAnyUser = context.user?.features?.includes('can-delete-any-user') ?? false;
      if (!context.user || (!isSelf && !canDeleteAnyUser)) {
        throw new Error('You can only delete your own account');
      }

      await prisma.$transaction(async (tx) => {
        // Groups they created: hand each to the longest-standing other accepted
        // member, or delete it if nobody else is in it (Group.createdBy has no
        // cascade, so these would otherwise block the delete)
        const ownedGroups = await tx.group.findMany({
          where: { createdById: id },
          select: { id: true },
        });

        for (const group of ownedGroups) {
          const successor = await tx.groupMembership.findFirst({
            where: {
              groupId: group.id,
              userId: { not: id },
              status: MembershipStatus.ACCEPTED,
            },
            orderBy: [{ joinedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          });

          if (successor) {
            await tx.group.update({
              where: { id: group.id },
              data: { createdById: successor.userId },
            });
            await tx.groupMembership.update({
              where: { id: successor.id },
              data: { role: GroupRole.OWNER },
            });
          } else {
            // Memberships, vibe links, comments and reactions cascade with the group;
            // read markers have no relation, so clear them explicitly
            await tx.scoreCommentRead.deleteMany({ where: { groupId: group.id } });
            await tx.group.delete({ where: { id: group.id } });
          }
        }

        // Sign-up invites they created (Invite.createdBy has no cascade). Users who
        // signed up with one keep their accounts; their usedInviteId is set to null.
        await tx.invite.deleteMany({ where: { createdById: id } });

        // Comment read markers have no relation to users
        await tx.scoreCommentRead.deleteMany({ where: { userId: id } });

        // Delete the user (vibes, comments, reactions, memberships, worm scores and
        // device tokens cascade; invitedBy on memberships they sent is set to null)
        await tx.user.delete({
          where: { id },
        });
      });

      return true;
    },
    loginWithCode: async (_: any, { code }: { code: string }, context: any) => {
      // Find user by unique code (case-insensitive)
      const user = await prisma.user.findUnique({
        where: { uniqueCode: code.toLowerCase().trim() },
      });

      if (!user) {
        throw new Error('Invalid code. Please check and try again.');
      }

      // Generate token for existing user
      const token = generateToken(user.id);
      setViewer(context, user.id);

      return {
        user,
        token,
      };
    },
    regenerateCode: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to regenerate your code');
      }

      // Generate new unique code
      const newCode = await generateUniqueCodeSafe(prisma);

      // Update user's code
      await prisma.user.update({
        where: { id: context.user.id },
        data: { uniqueCode: newCode },
      });

      return newCode;
    },
    claimAccount: async (
      _: any,
      { code, displayName, email }: { code: string; displayName: string; email: string },
      context: any
    ) => {
      // Validate displayName
      if (!displayName?.trim()) {
        throw new Error('Display name is required');
      }

      // Validate email
      if (!email?.trim()) {
        throw new Error('Email is required');
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUser) {
        throw new Error('An account with this email already exists');
      }

      // Find invite by code
      const invite = await prisma.invite.findUnique({
        where: { code: code.toLowerCase().trim() },
      });

      if (!invite) {
        throw new Error('Invalid invite code. Please check and try again.');
      }

      // Check if expired
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        throw new Error('This invite has expired.');
      }

      // Generate unique code for the new user
      const uniqueCode = await generateUniqueCodeSafe(prisma);

      // Create the user with authSyncedAt set and link to the invite
      const user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          displayName: displayName.trim(),
          uniqueCode,
          authSyncedAt: new Date(),
          usedInviteId: invite.id,
        },
      });

      // Generate token
      const token = generateToken(user.id);
      setViewer(context, user.id);

      return {
        user,
        token,
      };
    },
    markAuthSynced: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const user = await prisma.user.update({
        where: { id: context.user.id },
        data: { authSyncedAt: new Date() },
      });

      return user;
    },
  },
  User: {
    // Login codes and emails are private: only the user themselves can see them.
    // Others get null (not an error) so lists and nested users still resolve.
    uniqueCode: (parent: { id: string; uniqueCode?: string | null }, _: any, context: any) => {
      return isViewer(context, parent.id) ? parent.uniqueCode ?? null : null;
    },
    email: (parent: { id: string; email?: string | null }, _: any, context: any) => {
      return isViewer(context, parent.id) ? parent.email ?? null : null;
    },
    // Serialize DateTime fields to ISO strings
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    updatedAt: (parent: { updatedAt: Date }) => {
      return parent.updatedAt.toISOString();
    },
    authSyncedAt: (parent: { authSyncedAt: Date | null }) => {
      return parent.authSyncedAt?.toISOString() ?? null;
    },
    // Feature flags are only visible to the user themselves (empty for others).
    // Ensure features is never null (for users created before this field existed)
    features: (parent: { id: string; features?: string[] | null }, _: any, context: any) => {
      if (!isViewer(context, parent.id)) return [];
      return parent.features ?? [];
    },
    // Latest vibe the viewer may see (see lifeScoresVisibleTo)
    currentScore: async (parent: any, _: any, context: any) => {
      const where = lifeScoresVisibleTo(context, parent.id);
      if (!where) return null;
      const latestScore = await prisma.lifeScore.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return latestScore;
    },
    // Vibes the viewer may see: all for the user themselves, otherwise only those
    // posted to a group the viewer is an accepted member of
    lifeScores: async (parent: any, _: any, context: any) => {
      const where = lifeScoresVisibleTo(context, parent.id);
      if (!where) return [];
      return await prisma.lifeScore.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    },
    // Resolve usedInvite field (only for the user themselves: it carries the code)
    usedInvite: async (parent: { id: string; usedInviteId: string | null }, _: any, context: any) => {
      if (!isViewer(context, parent.id)) return null;
      if (!parent.usedInviteId) return null;
      return await prisma.invite.findUnique({
        where: { id: parent.usedInviteId },
      });
    },
    // Resolve invites field (invites created by this user; only visible to them)
    invites: async (parent: { id: string }, _: any, context: any) => {
      if (!isViewer(context, parent.id)) return [];
      return await prisma.invite.findMany({
        where: { createdById: parent.id },
        orderBy: { createdAt: 'desc' },
      });
    },
  },
};
