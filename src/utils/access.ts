import { MembershipStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Shared "who can see what" checks used across resolvers.

// The id of the person making the request: the signed-in user, or the account a
// sign-in/sign-up mutation just issued a token for (see setViewer in resolvers/user.ts)
export function viewerIdOf(context: any): string | null {
  return context.user?.id ?? context.viewerId ?? null;
}

// Whether the user being resolved is the person making the request
export function isViewer(context: any, userId: string) {
  return context.user?.id === userId || context.viewerId === userId;
}

// Whether the user is an accepted (not just invited) member of the group
export async function isAcceptedMember(userId: string, groupId: string): Promise<boolean> {
  const membership = await prisma.groupMembership.findUnique({
    where: {
      groupId_userId: { groupId, userId },
    },
  });
  return membership?.status === MembershipStatus.ACCEPTED;
}

// Vibes the viewer may see: their own, plus any posted to a group they're an
// accepted member of
export function visibleLifeScoresWhere(viewerId: string): Prisma.LifeScoreWhereInput {
  return {
    OR: [
      { userId: viewerId },
      {
        groups: {
          some: {
            group: {
              memberships: {
                some: { userId: viewerId, status: MembershipStatus.ACCEPTED },
              },
            },
          },
        },
      },
    ],
  };
}

// Whether the viewer may see a vibe's per-group activity (comments, reactions,
// counts) in `groupId`: the vibe must have been posted to that group and the viewer
// must be an accepted member of it. This applies to the vibe's owner too, so no
// one can read a group's thread from outside it.
export async function canSeeGroupThread(
  viewerId: string | null,
  lifeScoreId: string,
  groupId: string
): Promise<boolean> {
  if (!viewerId) return false;
  const lifeScoreGroup = await prisma.lifeScoreGroup.findFirst({
    where: {
      lifeScoreId,
      groupId,
      group: {
        memberships: {
          some: { userId: viewerId, status: MembershipStatus.ACCEPTED },
        },
      },
    },
    select: { id: true },
  });
  return !!lifeScoreGroup;
}

// Groups a vibe was posted to whose threads the viewer may see (see canSeeGroupThread)
export async function visibleThreadGroupIds(viewerId: string | null, lifeScoreId: string): Promise<string[]> {
  if (!viewerId) return [];
  const lifeScoreGroups = await prisma.lifeScoreGroup.findMany({
    where: {
      lifeScoreId,
      group: {
        memberships: {
          some: { userId: viewerId, status: MembershipStatus.ACCEPTED },
        },
      },
    },
    select: { groupId: true },
  });
  return lifeScoreGroups.map((lsg) => lsg.groupId);
}
