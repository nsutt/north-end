import { prisma } from '../lib/prisma';

// APNs device tokens are hex strings (64 chars today; Apple says not to assume a fixed length)
const TOKEN_PATTERN = /^[0-9a-fA-F]{32,200}$/;

export const deviceResolvers = {
  Mutation: {
    registerDeviceToken: async (
      _: any,
      { token, environment }: { token: string; environment: 'SANDBOX' | 'PRODUCTION' },
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to register for notifications');
      }
      if (!TOKEN_PATTERN.test(token)) {
        throw new Error('Invalid device token');
      }

      const env = environment === 'SANDBOX' ? 'sandbox' : 'production';
      await prisma.deviceToken.upsert({
        where: { token },
        create: { token, userId: context.user.id, environment: env },
        update: { userId: context.user.id, environment: env },
      });
      return true;
    },

    unregisterDeviceToken: async (_: any, { token }: { token: string }, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }
      // Only remove the token if it belongs to the caller
      await prisma.deviceToken.deleteMany({ where: { token, userId: context.user.id } });
      return true;
    },
  },
};
