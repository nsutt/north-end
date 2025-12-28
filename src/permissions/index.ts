import { rule, shield, and, allow } from 'graphql-shield';

// Rule: User must be authenticated
const isAuthenticated = rule({ cache: 'contextual' })(
  async (parent, args, context) => {
    if (!context.user) {
      return new Error('You must be logged in to perform this action');
    }
    return true;
  }
);

// Rule: User must own the resource
const isOwner = rule({ cache: 'strict' })(
  async (parent, args, context) => {
    // For LifeScore type - check if the score belongs to the user
    if (parent && parent.userId) {
      return parent.userId === context.user?.id;
    }
    // For mutations - will check in resolver
    return true;
  }
);

// Permission rules
export const permissions = shield(
  {
    Query: {
      // Public queries
      hello: allow,
      serverStatus: allow,
      user: allow,
      users: allow,
      allUsers: isAuthenticated,

      // Protected queries
      me: isAuthenticated,

      // Worm score queries
      myHighScore: isAuthenticated,
      levelHighScores: allow,

      // Invite queries
      invites: isAuthenticated,
      invite: allow,

      // Life score queries
      lifeScore: allow,
      groupScores: isAuthenticated,

      // Score comment queries
      scoreComments: isAuthenticated,

      // Group queries
      group: isAuthenticated,
      myGroups: isAuthenticated,
      myPendingGroupInvites: isAuthenticated,
    },
    Mutation: {
      // Public mutations
      createUser: allow,
      loginWithCode: allow,
      claimAccount: allow,

      // Protected mutations
      updateUser: isAuthenticated,
      postLifeScore: isAuthenticated,
      deleteLifeScore: isAuthenticated,
      deleteUser: isAuthenticated,
      regenerateCode: isAuthenticated,

      // Worm score mutations
      submitWormScore: isAuthenticated,

      // Invite mutations
      createInvite: isAuthenticated,
      deleteInvite: isAuthenticated,

      // Auth sync
      markAuthSynced: isAuthenticated,

      // Score comment mutations
      addScoreComment: isAuthenticated,
      deleteScoreComment: isAuthenticated,

      // Group mutations
      createGroup: isAuthenticated,
      updateGroup: isAuthenticated,
      deleteGroup: isAuthenticated,
      inviteToGroup: isAuthenticated,
      acceptGroupInvite: isAuthenticated,
      declineGroupInvite: isAuthenticated,
      leaveGroup: isAuthenticated,
      removeFromGroup: isAuthenticated,
    },
  },
  {
    // Options
    allowExternalErrors: true,
    fallbackError: 'Not authorized to access this resource',
  }
);
