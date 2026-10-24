import { makeExecutableSchema } from '@graphql-tools/schema';
import { applyMiddleware } from 'graphql-middleware';
import type { GraphQLSchema } from 'graphql';
import { userTypeDefs } from './schema/user';
import { userResolvers } from './resolvers/user';
import { lifeScoreTypeDefs } from './schema/lifeScore';
import { lifeScoreResolvers } from './resolvers/lifeScore';
import { wormScoreTypeDefs } from './schema/wormScore';
import { wormScoreResolvers } from './resolvers/wormScore';
import { inviteTypeDefs } from './schema/invite';
import { inviteResolvers } from './resolvers/invite';
import { scoreCommentTypeDefs } from './schema/scoreComment';
import { scoreCommentResolvers } from './resolvers/scoreComment';
import { scoreReactionTypeDefs } from './schema/scoreReaction';
import { scoreReactionResolvers } from './resolvers/scoreReaction';
import { commentReactionTypeDefs } from './schema/commentReaction';
import { commentReactionResolvers } from './resolvers/commentReaction';
import { groupTypeDefs } from './schema/group';
import { groupResolvers } from './resolvers/group';
import { deviceTypeDefs } from './schema/device';
import { deviceResolvers } from './resolvers/device';
import { appleAuthTypeDefs } from './schema/appleAuth';
import { appleAuthResolvers } from './resolvers/appleAuth';
import { permissions } from './permissions';

const baseTypeDefs = `#graphql
  type Query {
    hello: String
    serverStatus: ServerStatus
  }

  type ServerStatus {
    version: String!
    uptime: Float!
    ready: Boolean!
  }
`;

const baseResolvers = {
  Query: {
    hello: () => 'Welcome to North End Game Server!',
    serverStatus: () => ({
      version: '1.0.0',
      uptime: process.uptime(),
      ready: true,
    }),
  },
};

const typeDefs = [baseTypeDefs, userTypeDefs, lifeScoreTypeDefs, wormScoreTypeDefs, inviteTypeDefs, scoreCommentTypeDefs, scoreReactionTypeDefs, commentReactionTypeDefs, groupTypeDefs, deviceTypeDefs, appleAuthTypeDefs];
const resolvers = [baseResolvers, userResolvers, lifeScoreResolvers, wormScoreResolvers, inviteResolvers, scoreCommentResolvers, scoreReactionResolvers, commentReactionResolvers, groupResolvers, deviceResolvers, appleAuthResolvers];

/** The server's executable schema (typeDefs + resolvers) with GraphQL Shield applied. */
export function buildSchema(): GraphQLSchema {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // Apply GraphQL Shield middleware
  return applyMiddleware(schema, permissions);
}
