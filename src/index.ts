import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { applyMiddleware } from 'graphql-middleware';
import { userTypeDefs } from './schema/user';
import { userResolvers, getUserById } from './resolvers/user';
import { lifeScoreTypeDefs } from './schema/lifeScore';
import { lifeScoreResolvers } from './resolvers/lifeScore';
import { verifyToken, extractTokenFromHeader } from './utils/auth';
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

const typeDefs = [baseTypeDefs, userTypeDefs, lifeScoreTypeDefs];
const resolvers = [baseResolvers, userResolvers, lifeScoreResolvers];

async function startServer() {
  // Create executable schema
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // Apply GraphQL Shield middleware
  const schemaWithPermissions = applyMiddleware(schema, permissions);

  const server = new ApolloServer({
    schema: schemaWithPermissions,
    includeStacktraceInErrorResponses: true,
    introspection: true,
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: Number(process.env.PORT) || 4000 },
    context: async ({ req }) => {
      // Extract token from Authorization header
      const token = extractTokenFromHeader(req.headers.authorization);

      if (!token) {
        return { user: null };
      }

      // Verify token and get user
      const payload = verifyToken(token);
      if (!payload) {
        return { user: null };
      }

      // Get user from storage
      const user = getUserById(payload.userId);
      if (!user) {
        return { user: null };
      }

      return { user };
    },
  });

  console.log(`🚀 Server ready at: ${url}`);
  console.log(`📊 GraphQL Playground: ${url}`);
  console.log(`🌍 CORS: Enabled (accepts all origins by default)`);
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
