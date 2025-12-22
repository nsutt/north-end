export const userTypeDefs = `#graphql
  type User {
    id: ID!
    displayName: String!
    avatarUrl: String
    uniqueCode: String
    createdAt: String!
    updatedAt: String!
    currentScore: LifeScore
  }

  type AuthPayload {
    user: User!
    token: String!
  }

  type Query {
    user(id: ID!): User
    users: [User!]!
    me: User
  }

  type Mutation {
    createUser(input: CreateUserInput): AuthPayload!
    updateUser(id: ID!, input: UpdateUserInput!): User!
    deleteUser(id: ID!): Boolean!
    loginWithCode(code: String!): AuthPayload!
    regenerateCode: String!
    claimAccount(code: String!, displayName: String!): AuthPayload!
  }

  input CreateUserInput {
    displayName: String!
    avatarUrl: String
  }

  input UpdateUserInput {
    displayName: String
    avatarUrl: String
  }
`;
