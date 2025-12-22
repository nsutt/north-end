import { prisma } from '../lib/prisma';
import { getUserById } from './user';
import { ConnectionStatus } from '@prisma/client';

interface SendConnectionRequestArgs {
  receiverId: string;
}

interface ConnectionIdArgs {
  connectionId: string;
}

interface UserIdArgs {
  userId: string;
}

// Helper function to get connection between two users (either direction)
async function getConnectionBetweenUsers(userId1: string, userId2: string) {
  return await prisma.userConnection.findFirst({
    where: {
      OR: [
        { senderId: userId1, receiverId: userId2 },
        { senderId: userId2, receiverId: userId1 },
      ],
    },
  });
}

// Helper function to get all accepted connections for a user
async function getAcceptedConnections(userId: string) {
  const connections = await prisma.userConnection.findMany({
    where: {
      OR: [
        { senderId: userId, status: ConnectionStatus.ACCEPTED },
        { receiverId: userId, status: ConnectionStatus.ACCEPTED },
      ],
    },
    include: {
      sender: true,
      receiver: true,
    },
  });

  // Map to get the "other" user in each connection
  return connections.map((conn) =>
    conn.senderId === userId ? conn.receiver : conn.sender
  );
}

export const userConnectionResolvers = {
  UserConnection: {
    sender: async (parent: { senderId: string }) => {
      return await getUserById(parent.senderId);
    },
    receiver: async (parent: { receiverId: string }) => {
      return await getUserById(parent.receiverId);
    },
    createdAt: (parent: { createdAt: Date }) => {
      return parent.createdAt.toISOString();
    },
    updatedAt: (parent: { updatedAt: Date }) => {
      return parent.updatedAt.toISOString();
    },
  },

  User: {
    // Get all accepted connections (mutual friends)
    connections: async (parent: { id: string }) => {
      return await getAcceptedConnections(parent.id);
    },

    // Get pending requests sent TO this user
    pendingConnectionRequests: async (parent: { id: string }) => {
      return await prisma.userConnection.findMany({
        where: {
          receiverId: parent.id,
          status: ConnectionStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    // Get pending requests sent BY this user
    sentConnectionRequests: async (parent: { id: string }) => {
      return await prisma.userConnection.findMany({
        where: {
          senderId: parent.id,
          status: ConnectionStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    // Get connection status with a specific user
    connectionStatusWith: async (
      parent: { id: string },
      { userId }: UserIdArgs
    ) => {
      const connection = await getConnectionBetweenUsers(parent.id, userId);

      if (!connection) {
        return {
          status: null,
          connectionId: null,
          isConnected: false,
          canConnect: true,
        };
      }

      return {
        status: connection.status,
        connectionId: connection.id,
        isConnected: connection.status === ConnectionStatus.ACCEPTED,
        canConnect: false,
      };
    },
  },

  Query: {
    // Get all connections for the current user
    myConnections: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to view connections');
      }
      // Return connections with both sender and receiver
      return await prisma.userConnection.findMany({
        where: {
          OR: [
            { senderId: context.user.id, status: ConnectionStatus.ACCEPTED },
            { receiverId: context.user.id, status: ConnectionStatus.ACCEPTED },
          ],
        },
        include: {
          sender: true,
          receiver: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    },

    // Get pending requests for the current user
    myPendingRequests: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in to view pending requests');
      }
      return await prisma.userConnection.findMany({
        where: {
          receiverId: context.user.id,
          status: ConnectionStatus.PENDING,
        },
        include: {
          sender: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    // Get sent connection requests for the current user
    mySentConnectionRequests: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('You must be logged in');
      }
      return await prisma.userConnection.findMany({
        where: {
          senderId: context.user.id,
          status: ConnectionStatus.PENDING,
        },
        include: {
          receiver: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    // Get a specific connection
    connection: async (_: any, { id }: { id: string }) => {
      return await prisma.userConnection.findUnique({
        where: { id },
      });
    },

    // Check connection status between current user and another user
    connectionStatus: async (
      _: any,
      { userId }: UserIdArgs,
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to check connection status');
      }

      const connection = await getConnectionBetweenUsers(
        context.user.id,
        userId
      );

      if (!connection) {
        return {
          status: null,
          connectionId: null,
          isConnected: false,
          canConnect: true,
        };
      }

      return {
        status: connection.status,
        connectionId: connection.id,
        isConnected: connection.status === ConnectionStatus.ACCEPTED,
        canConnect: false,
      };
    },
  },

  Mutation: {
    // Send a connection request
    sendConnectionRequest: async (
      _: any,
      { receiverId }: SendConnectionRequestArgs,
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to send connection requests');
      }

      const senderId = context.user.id;

      // Prevent self-connection
      if (senderId === receiverId) {
        throw new Error('You cannot send a connection request to yourself');
      }

      // Check if receiver exists
      const receiver = await getUserById(receiverId);
      if (!receiver) {
        throw new Error('User not found');
      }

      // Check for existing connection (either direction)
      const existingConnection = await getConnectionBetweenUsers(
        senderId,
        receiverId
      );

      if (existingConnection) {
        if (existingConnection.status === ConnectionStatus.PENDING) {
          throw new Error('A connection request already exists');
        } else if (existingConnection.status === ConnectionStatus.ACCEPTED) {
          throw new Error('You are already connected with this user');
        } else if (existingConnection.status === ConnectionStatus.REJECTED) {
          // Allow resending after rejection - update existing record
          return await prisma.userConnection.update({
            where: { id: existingConnection.id },
            data: {
              senderId,
              receiverId,
              status: ConnectionStatus.PENDING,
            },
          });
        }
      }

      // Create new connection request
      return await prisma.userConnection.create({
        data: {
          senderId,
          receiverId,
          status: ConnectionStatus.PENDING,
        },
      });
    },

    // Accept a connection request
    acceptConnectionRequest: async (
      _: any,
      { connectionId }: ConnectionIdArgs,
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to accept connection requests');
      }

      const connection = await prisma.userConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new Error('Connection request not found');
      }

      // Only the receiver can accept
      if (connection.receiverId !== context.user.id) {
        throw new Error('You can only accept connection requests sent to you');
      }

      if (connection.status !== ConnectionStatus.PENDING) {
        throw new Error('This connection request is no longer pending');
      }

      // Update status to accepted
      return await prisma.userConnection.update({
        where: { id: connectionId },
        data: { status: ConnectionStatus.ACCEPTED },
      });
    },

    // Reject a connection request
    rejectConnectionRequest: async (
      _: any,
      { connectionId }: ConnectionIdArgs,
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to reject connection requests');
      }

      const connection = await prisma.userConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new Error('Connection request not found');
      }

      // Only the receiver can reject
      if (connection.receiverId !== context.user.id) {
        throw new Error('You can only reject connection requests sent to you');
      }

      if (connection.status !== ConnectionStatus.PENDING) {
        throw new Error('This connection request is no longer pending');
      }

      // Update status to rejected
      return await prisma.userConnection.update({
        where: { id: connectionId },
        data: { status: ConnectionStatus.REJECTED },
      });
    },

    // Remove a connection
    removeConnection: async (
      _: any,
      { connectionId }: ConnectionIdArgs,
      context: any
    ) => {
      if (!context.user) {
        throw new Error('You must be logged in to remove connections');
      }

      const connection = await prisma.userConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new Error('Connection not found');
      }

      // Either party can remove the connection
      if (
        connection.senderId !== context.user.id &&
        connection.receiverId !== context.user.id
      ) {
        throw new Error('You can only remove your own connections');
      }

      // Delete the connection
      await prisma.userConnection.delete({
        where: { id: connectionId },
      });

      return true;
    },
  },
};
