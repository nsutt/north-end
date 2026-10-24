import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { getUserById } from './resolvers/user';
import { verifyToken, extractTokenFromHeader } from './utils/auth';
import { shareRouter } from './routes/share';
import { buildSchema } from './schemaBuilder';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 4000;

  // Executable schema with GraphQL Shield middleware applied
  const schemaWithPermissions = buildSchema();

  const server = new ApolloServer({
    schema: schemaWithPermissions,
    includeStacktraceInErrorResponses: process.env.NODE_ENV !== 'production',
    introspection: process.env.NODE_ENV !== 'production',
  });

  await server.start();

  // Share routes (for OG meta tags and images)
  app.use('/vibe-check/share', shareRouter);

  // GraphQL endpoint
  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(server, {
      context: async ({ req }: { req: express.Request }) => {
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

        // Get user from database
        const user = await getUserById(payload.userId);
        if (!user) {
          return { user: null };
        }

        return { user };
      },
    })
  );

  // Health check
  app.get('/health', (_, res) => {
    res.json({ status: 'ok' });
  });

  app.listen(port, () => {
    console.log(`🚀 Server ready at: http://localhost:${port}/graphql`);
    console.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`);
    console.log(`🔗 Share routes: http://localhost:${port}/share`);
    console.log(`🌍 CORS: Enabled (accepts all origins by default)`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
