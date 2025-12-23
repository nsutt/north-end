// invite
export const inviteTypeDefs = `#graphql
  type Invite {
    id: ID!
    code: String!
    createdAt: String!
    expiresAt: String
    createdBy: User!
    usedBy: [User!]!
    useCount: Int!
  }

  extend type Query {
    invites: [Invite!]!
    invite(code: String!): Invite
  }

  extend type Mutation {
    createInvite(expiresInDays: Int): Invite!
    expireInvite(id: ID!): Invite!
    deleteInvite(id: ID!): Boolean!
  }
`;
