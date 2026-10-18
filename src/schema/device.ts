export const deviceTypeDefs = `#graphql
  enum PushEnvironment {
    SANDBOX
    PRODUCTION
  }

  extend type Mutation {
    # Registers this device's APNs token for the signed-in user (re-assigns it if another account had it)
    registerDeviceToken(token: String!, environment: PushEnvironment!): Boolean!
    unregisterDeviceToken(token: String!): Boolean!
  }
`;
