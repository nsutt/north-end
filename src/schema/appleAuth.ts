export const appleAuthTypeDefs = `#graphql
  type AppleSignInPayload {
    token: String!
    user: User!
    isNewUser: Boolean!
  }

  extend type User {
    hasAppleId: Boolean!
  }

  extend type Mutation {
    # Signs in with an Apple identity token, creating an account the first time.
    # nonce is the raw nonce the app hashed into the Apple request.
    signInWithApple(identityToken: String!, nonce: String!, displayName: String): AppleSignInPayload!
    # Connects an Apple ID to the signed-in account so it can sign in with Apple.
    connectAppleId(identityToken: String!, nonce: String!): User!
  }
`;
