import { prisma } from '../lib/prisma';
import { generateToken } from '../utils/auth';
import { generateUniqueCodeSafe } from '../utils/codeGenerator';
import { verifyAppleIdentityToken } from '../utils/appleAuth';

export const appleAuthResolvers = {
  Mutation: {
    signInWithApple: async (
      _: any,
      { identityToken, nonce, displayName }: { identityToken: string; nonce: string; displayName?: string }
    ) => {
      const apple = await verifyAppleIdentityToken(identityToken, nonce);

      const existing = await prisma.user.findFirst({ where: { appleUserId: apple.sub } });
      if (existing) {
        return { token: generateToken(existing.id), user: existing, isNewUser: false };
      }

      // First sign-in: create the account. Apple only shares the name on the very
      // first authorization, so fall back to something friendly the user can change.
      const name = displayName?.trim() || 'Vibe Checker';

      // Keep Apple's email only if no other account uses it (it may be a private relay address).
      const emailTaken = apple.email ? await prisma.user.findUnique({ where: { email: apple.email } }) : null;

      const user = await prisma.user.create({
        data: {
          displayName: name.slice(0, 50),
          appleUserId: apple.sub,
          email: apple.email && !emailTaken ? apple.email : null,
          uniqueCode: await generateUniqueCodeSafe(prisma),
          authSyncedAt: new Date(),
        },
      });

      return { token: generateToken(user.id), user, isNewUser: true };
    },

    connectAppleId: async (
      _: any,
      { identityToken, nonce }: { identityToken: string; nonce: string },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }

      const apple = await verifyAppleIdentityToken(identityToken, nonce);

      const owner = await prisma.user.findFirst({ where: { appleUserId: apple.sub } });
      if (owner && owner.id !== context.user.id) {
        throw new Error('This Apple ID is already connected to another Vibe Check account');
      }

      return await prisma.user.update({
        where: { id: context.user.id },
        data: { appleUserId: apple.sub },
      });
    },
  },
  User: {
    // Expose only whether an Apple ID is connected, never the identifier itself
    hasAppleId: (parent: { appleUserId?: string | null }) => Boolean(parent.appleUserId),
  },
};
