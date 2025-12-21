import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import express from 'express';
import http from 'http';
import cors from 'cors';
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
  // Create Express app and HTTP server
  const app = express();
  const httpServer = http.createServer(app);

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
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  await server.start();

  // Configure CORS - allow requests from Render frontend URLs
  app.use(
    '/graphql',
    cors<cors.CorsRequest>({
      origin: process.env.NODE_ENV === 'production'
        ? [
            /\.onrender\.com$/,  // Allow all Render domains
            'http://localhost:3000',  // For local development
          ]
        : '*',  // Allow all origins in development
      credentials: true,
    }),
    express.json(),
    expressMiddleware(server, {
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
    })
  );

  const port = process.env.PORT || 4000;
  await new Promise<void>((resolve) => httpServer.listen({ port }, resolve));

  console.log(`🚀 Server ready at: http://localhost:${port}/graphql`);
  console.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`);
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
