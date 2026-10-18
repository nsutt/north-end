import { MembershipStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sendPush, type ApnsEnvironment, type PushMessage } from './apns';

// Notifications are best-effort: they run after the mutation has succeeded and
// never throw back into the resolver.

async function pushToUsers(userIds: string[], message: PushMessage) {
  if (userIds.length === 0) return;

  const devices = await prisma.deviceToken.findMany({ where: { userId: { in: userIds } } });
  const deadTokens = await sendPush(
    devices.map((d) => ({ token: d.token, environment: d.environment as ApnsEnvironment })),
    message
  );

  if (deadTokens.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: deadTokens } } });
  }
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** "Sam posted a vibe: 8.1 · Friday energy" to everyone else in the groups it was shared with. */
export function notifyNewVibe(params: {
  lifeScoreId: string;
  authorId: string;
  score: number;
  statusText: string | null;
  groupIds: string[];
}) {
  void (async () => {
    const { lifeScoreId, authorId, score, statusText, groupIds } = params;
    if (groupIds.length === 0) return;

    const [author, memberships] = await Promise.all([
      prisma.user.findUnique({ where: { id: authorId }, select: { displayName: true } }),
      prisma.groupMembership.findMany({
        where: { groupId: { in: groupIds }, status: MembershipStatus.ACCEPTED, userId: { not: authorId } },
        select: { userId: true, groupId: true },
      }),
    ]);
    if (!author) return;

    // One notification per person, opening the first group they share with the author.
    const groupForUser = new Map<string, string>();
    for (const m of memberships) {
      if (!groupForUser.has(m.userId)) groupForUser.set(m.userId, m.groupId);
    }

    const body = statusText ? `${formatScore(score)} · ${statusText}` : formatScore(score);
    await Promise.all(
      [...groupForUser].map(([userId, groupId]) =>
        pushToUsers([userId], {
          title: `${author.displayName} posted a vibe`,
          body,
          threadId: `group-${groupId}`,
          data: { lifeScoreId, groupId },
        })
      )
    );
  })().catch((err) => console.error('[push] notifyNewVibe failed:', err));
}

/** Tells the vibe's owner and others in the thread about a new comment. */
export function notifyNewComment(params: {
  lifeScoreId: string;
  groupId: string;
  authorId: string;
  content: string;
  hasGif: boolean;
}) {
  void (async () => {
    const { lifeScoreId, groupId, authorId, content, hasGif } = params;

    const [author, lifeScore, earlierCommenters] = await Promise.all([
      prisma.user.findUnique({ where: { id: authorId }, select: { displayName: true } }),
      prisma.lifeScore.findUnique({ where: { id: lifeScoreId }, select: { userId: true } }),
      prisma.scoreComment.findMany({
        where: { lifeScoreId, groupId, authorId: { not: authorId } },
        select: { authorId: true },
        distinct: ['authorId'],
      }),
    ]);
    if (!author || !lifeScore) return;

    const body = content || (hasGif ? 'Sent a GIF' : '');
    const data = { lifeScoreId, groupId };
    const threadId = `score-${lifeScoreId}`;

    if (lifeScore.userId !== authorId) {
      await pushToUsers([lifeScore.userId], {
        title: `${author.displayName} commented on your vibe`,
        body,
        threadId,
        data,
      });
    }

    const others = earlierCommenters.map((c) => c.authorId).filter((id) => id !== lifeScore.userId);
    await pushToUsers(others, {
      title: `${author.displayName} also commented`,
      body,
      threadId,
      data,
    });
  })().catch((err) => console.error('[push] notifyNewComment failed:', err));
}
