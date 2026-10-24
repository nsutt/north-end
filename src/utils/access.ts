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
