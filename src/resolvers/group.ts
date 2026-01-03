import { prisma } from '../lib/prisma';
import { getUserById } from './user';
import { GroupRole, MembershipStatus } from '@prisma/client';
import { generateToken } from '../utils/auth';
import { generateUniqueCodeSafe } from '../utils/codeGenerator';

export const groupResolvers = {
  Query: {
    group: async (_: any, { id }: { id: string }) => {
      return await prisma.group.findUnique({
        where: { id },
      });
    },
    myGroups: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to view your groups');
      }

      const memberships = await prisma.groupMembership.findMany({
        where: {
          userId: context.user.id,
          status: MembershipStatus.ACCEPTED,
        },
        include: { group: true },
        orderBy: { joinedAt: 'desc' },
      });

      return memberships.map((m) => m.group);
    },
    myPendingGroupInvites: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to view pending invites');
      }

      return await prisma.groupMembership.findMany({
        where: {
          userId: context.user.id,
          status: MembershipStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });
    },
    groupByInviteCode: async (_: any, { code }: { code: string }) => {
      // Public query - no auth required
      const group = await prisma.group.findUnique({
        where: { inviteCode: code.toLowerCase().trim() },
        include: {
          _count: {
            select: {
              memberships: {
                where: { status: MembershipStatus.ACCEPTED },
              },
            },
          },
        },
      });

      if (!group) {
        return null;
      }

      return {
        id: group.id,
        name: group.name,
        memberCount: group._count.memberships,
      };
    },
  },

  Mutation: {
    createGroup: async (
      _: any,
      { name }: { name: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to create a group');
      }

      if (!name?.trim()) {
        throw new Error('Group name is required');
      }

      // Create group and add creator as owner in a transaction
      const group = await prisma.$transaction(async (tx) => {
        const newGroup = await tx.group.create({
          data: {
            name: name.trim(),
            createdById: context.user.id,
          },
        });

        // Add creator as owner with ACCEPTED status
        await tx.groupMembership.create({
          data: {
            groupId: newGroup.id,
            userId: context.user.id,
            role: GroupRole.OWNER,
            status: MembershipStatus.ACCEPTED,
            joinedAt: new Date(),
          },
        });

        return newGroup;
      });

      return group;
    },

    updateGroup: async (
      _: any,
      { id, name }: { id: string; name: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const group = await prisma.group.findUnique({
        where: { id },
      });

      if (!group) {
        throw new Error('Group not found');
      }

      // Only owner can update
      if (group.createdById !== context.user.id) {
        throw new Error('Only the group owner can update the group');
      }

      if (!name?.trim()) {
        throw new Error('Group name is required');
      }

      return await prisma.group.update({
        where: { id },
        data: { name: name.trim() },
      });
    },

    deleteGroup: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const group = await prisma.group.findUnique({
        where: { id },
      });

      if (!group) {
        throw new Error('Group not found');
      }

      if (group.createdById !== context.user.id) {
        throw new Error('Only the group owner can delete the group');
      }

      await prisma.group.delete({
        where: { id },
      });

      return true;
    },

    inviteToGroup: async (
      _: any,
      { groupId, userId }: { groupId: string; userId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const group = await prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        throw new Error('Group not found');
      }

      // Only owner can invite
      if (group.createdById !== context.user.id) {
        throw new Error('Only the group owner can invite members');
      }

      // Check if user exists
      const targetUser = await getUserById(userId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      // Check if already a member
      const existingMembership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId },
        },
      });

      if (existingMembership) {
        if (existingMembership.status === MembershipStatus.ACCEPTED) {
          throw new Error('User is already a member of this group');
        } else {
          throw new Error('User already has a pending invite to this group');
        }
      }

      return await prisma.groupMembership.create({
        data: {
          groupId,
          userId,
          role: GroupRole.MEMBER,
          status: MembershipStatus.PENDING,
          invitedById: context.user.id,
        },
      });
    },

    acceptGroupInvite: async (
      _: any,
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId: context.user.id },
        },
      });

      if (!membership) {
        throw new Error('No invite found for this group');
      }

      if (membership.status === MembershipStatus.ACCEPTED) {
        throw new Error('You are already a member of this group');
      }

      return await prisma.groupMembership.update({
        where: { id: membership.id },
        data: {
          status: MembershipStatus.ACCEPTED,
          joinedAt: new Date(),
        },
      });
    },

    declineGroupInvite: async (
      _: any,
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId: context.user.id },
        },
      });

      if (!membership) {
        throw new Error('No invite found for this group');
      }

      if (membership.status === MembershipStatus.ACCEPTED) {
        throw new Error('You are already a member. Use leaveGroup instead.');
      }

      await prisma.groupMembership.delete({
        where: { id: membership.id },
      });

      return true;
    },

    leaveGroup: async (
      _: any,
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId: context.user.id },
        },
      });

      if (!membership) {
        throw new Error('You are not a member of this group');
      }

      // Owner cannot leave (must delete or transfer ownership)
      if (membership.role === GroupRole.OWNER) {
        throw new Error('Group owner cannot leave. Delete the group instead.');
      }

      await prisma.groupMembership.delete({
        where: { id: membership.id },
      });

      return true;
    },

    removeFromGroup: async (
      _: any,
      { groupId, userId }: { groupId: string; userId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const group = await prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        throw new Error('Group not found');
      }

      // Only owner can remove members
      if (group.createdById !== context.user.id) {
        throw new Error('Only the group owner can remove members');
      }

      // Cannot remove self (use leaveGroup or deleteGroup)
      if (userId === context.user.id) {
        throw new Error('Cannot remove yourself. Use deleteGroup instead.');
      }

      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId },
        },
      });

      if (!membership) {
        throw new Error('User is not a member of this group');
      }

      await prisma.groupMembership.delete({
        where: { id: membership.id },
      });

      return true;
    },

    markCommentsRead: async (
      _: any,
      { lifeScoreId, groupId }: { lifeScoreId: string; groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      await prisma.scoreCommentRead.upsert({
        where: {
          userId_lifeScoreId_groupId: {
            userId: context.user.id,
            lifeScoreId,
            groupId,
          },
        },
        update: {
          lastReadAt: new Date(),
        },
        create: {
          userId: context.user.id,
          lifeScoreId,
          groupId,
          lastReadAt: new Date(),
        },
      });

      return true;
    },

    generateGroupInviteCode: async (
      _: any,
      { groupId }: { groupId: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const group = await prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        throw new Error('Group not found');
      }

      // Check if user is a member of the group
      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId, userId: context.user.id },
        },
      });

      if (!membership || membership.status !== MembershipStatus.ACCEPTED) {
        throw new Error('You must be a member of the group to generate an invite link');
      }

      // Generate a new unique invite code
      const inviteCode = await generateUniqueCodeSafe(prisma, 'group');

      return await prisma.group.update({
        where: { id: groupId },
        data: { inviteCode },
      });
    },

    joinGroupByCode: async (
      _: any,
      { code }: { code: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const group = await prisma.group.findUnique({
        where: { inviteCode: code.toLowerCase().trim() },
      });

      if (!group) {
        throw new Error('Invalid invite code');
      }

      // Check if already a member
      const existingMembership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId: group.id, userId: context.user.id },
        },
      });

      if (existingMembership) {
        if (existingMembership.status === MembershipStatus.ACCEPTED) {
          throw new Error('You are already a member of this group');
        }
        // If pending, accept the invite
        return await prisma.groupMembership.update({
          where: { id: existingMembership.id },
          data: {
            status: MembershipStatus.ACCEPTED,
            joinedAt: new Date(),
          },
        });
      }

      // Create new membership with ACCEPTED status (direct join via code)
      return await prisma.groupMembership.create({
        data: {
          groupId: group.id,
          userId: context.user.id,
          role: GroupRole.MEMBER,
          status: MembershipStatus.ACCEPTED,
          joinedAt: new Date(),
        },
      });
    },

    createAccountAndJoinGroup: async (
      _: any,
      { code, displayName, email }: { code: string; displayName: string; email: string }
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

      // Find group by invite code
      const group = await prisma.group.findUnique({
        where: { inviteCode: code.toLowerCase().trim() },
      });

      if (!group) {
        throw new Error('Invalid invite code');
      }

      // Generate unique code for the new user
      const uniqueCode = await generateUniqueCodeSafe(prisma, 'user');

      // Create user and membership in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create the user
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            displayName: displayName.trim(),
            uniqueCode,
            authSyncedAt: new Date(),
          },
        });

        // Create group membership
        const membership = await tx.groupMembership.create({
          data: {
            groupId: group.id,
            userId: user.id,
            role: GroupRole.MEMBER,
            status: MembershipStatus.ACCEPTED,
            joinedAt: new Date(),
          },
        });

        return { user, membership };
      });

      // Generate token for the new user
      const token = generateToken(result.user.id);

      return {
        token,
        user: result.user,
        membership: result.membership,
      };
    },
  },

  Group: {
    createdBy: async (parent: { createdById: string }) => {
      return await getUserById(parent.createdById);
    },
    members: async (parent: { id: string }) => {
      return await prisma.groupMembership.findMany({
        where: {
          groupId: parent.id,
        },
        orderBy: { createdAt: 'asc' },
      });
    },
    memberCount: async (parent: { id: string }) => {
      return await prisma.groupMembership.count({
        where: {
          groupId: parent.id,
          status: MembershipStatus.ACCEPTED,
        },
      });
    },
    myRole: async (parent: { id: string }, _: any, context: any) => {
      if (!context.user) return null;

      const membership = await prisma.groupMembership.findUnique({
        where: {
          groupId_userId: { groupId: parent.id, userId: context.user.id },
        },
      });

      if (!membership || membership.status !== MembershipStatus.ACCEPTED) {
        return null;
      }

      return membership.role;
    },
    myLatestScore: async (parent: { id: string }, _: any, context: any) => {
      if (!context.user) return null;

      // Find the most recent score shared with this group by the current user
      const lifeScoreGroup = await prisma.lifeScoreGroup.findFirst({
        where: {
          groupId: parent.id,
          lifeScore: {
            userId: context.user.id,
          },
        },
        include: {
          lifeScore: true,
        },
        orderBy: {
          lifeScore: {
            createdAt: 'desc',
          },
        },
      });

      return lifeScoreGroup?.lifeScore ?? null;
    },
    unreadCommentCount: async (parent: { id: string }, _: any, context: any) => {
      if (!context.user) return 0;

      // Get all scores in this group, ordered by most recent per user
      const groupScores = await prisma.lifeScoreGroup.findMany({
        where: {
          groupId: parent.id,
        },
        include: {
          lifeScore: {
            include: {
              comments: {
                where: {
                  groupId: parent.id,
                  authorId: { not: context.user.id },
                },
              },
            },
          },
        },
        orderBy: {
          lifeScore: {
            createdAt: 'desc',
          },
        },
      });

      // Only keep the most recent score per user (matching UI behavior)
      const latestScoreByUser = new Map<string, typeof groupScores[0]>();
      for (const lsg of groupScores) {
        if (!latestScoreByUser.has(lsg.lifeScore.userId)) {
          latestScoreByUser.set(lsg.lifeScore.userId, lsg);
        }
      }

      // Get user's read timestamps for this group
      const readRecords = await prisma.scoreCommentRead.findMany({
        where: {
          userId: context.user.id,
          groupId: parent.id,
        },
      });

      const readMap = new Map(readRecords.map((r) => [r.lifeScoreId, r.lastReadAt]));

      // Count unread comments only on current scores
      let unreadCount = 0;
      for (const lsg of latestScoreByUser.values()) {
        const lastRead = readMap.get(lsg.lifeScoreId);
        for (const comment of lsg.lifeScore.comments) {
          if (!lastRead || comment.createdAt > lastRead) {
            unreadCount++;
          }
        }
      }

      return unreadCount;
    },
    recentActivity: async (parent: { id: string }, _: any, context: any) => {
      if (!context.user) return null;

      // Find the most recent score in this group (including current user)
      const recentScore = await prisma.lifeScoreGroup.findFirst({
        where: {
          groupId: parent.id,
        },
        include: {
          lifeScore: {
            include: {
              user: true,
            },
          },
        },
        orderBy: {
          lifeScore: {
            createdAt: 'desc',
          },
        },
      });

      if (!recentScore) return null;

      return {
        user: recentScore.lifeScore.user,
        score: recentScore.lifeScore.score,
        createdAt: recentScore.lifeScore.createdAt.toISOString(),
      };
    },
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    updatedAt: (parent: { updatedAt: Date }) => {
      return parent.updatedAt.toISOString();
    },
  },

  GroupMembership: {
    group: async (parent: { groupId: string }) => {
      return await prisma.group.findUnique({
        where: { id: parent.groupId },
      });
    },
    user: async (parent: { userId: string }) => {
      return await getUserById(parent.userId);
    },
    invitedBy: async (parent: { invitedById: string | null }) => {
      if (!parent.invitedById) return null;
      return await getUserById(parent.invitedById);
    },
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    joinedAt: (parent: { joinedAt: Date | null }) => {
      return parent.joinedAt?.toISOString() ?? null;
    },
  },

};
