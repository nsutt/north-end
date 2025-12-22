export const userConnectionTypeDefs = `#graphql
  enum ConnectionStatus {
    PENDING
    ACCEPTED
    REJECTED
  }

  type UserConnection {
    id: ID!
    senderId: ID!
    receiverId: ID!
    sender: User!
    receiver: User!
    status: ConnectionStatus!
    createdAt: String!
    updatedAt: String!
  }

  # Extend User type with connection fields
  extend type User {
    # All accepted connections (mutual friends)
    connections: [User!]!

    # Pending connection requests sent TO this user
    pendingConnectionRequests: [UserConnection!]!

    # Pending connection requests sent BY this user
    sentConnectionRequests: [UserConnection!]!

    # Get connection status with a specific user
    connectionStatusWith(userId: ID!): ConnectionStatusResult
  }

  type ConnectionStatusResult {
    status: ConnectionStatus
    connectionId: ID
    isConnected: Boolean!
    canConnect: Boolean!
  }

  # Queries
  extend type Query {
    # Get all connections for the current user
    myConnections: [UserConnection!]!

    # Get pending requests for the current user
    myPendingRequests: [UserConnection!]!

    # Get sent connection requests for the current user
    mySentConnectionRequests: [UserConnection!]!

    # Get a specific connection
    connection(id: ID!): UserConnection

    # Check connection status between current user and another user
    connectionStatus(userId: ID!): ConnectionStatusResult!
  }

  # Mutations
  extend type Mutation {
    # Send a connection request to another user
    sendConnectionRequest(receiverId: ID!): UserConnection!

    # Accept a connection request
    acceptConnectionRequest(connectionId: ID!): UserConnection!

    # Reject a connection request
    rejectConnectionRequest(connectionId: ID!): UserConnection!

    # Remove an existing connection
    removeConnection(connectionId: ID!): Boolean!
  }
`;
