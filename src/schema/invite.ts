// invite 
export const inviteTypeDefs = `#graphql
  type Invite {
    id: ID!
    code: String!
    createdAt: String!
    expiresAt: String
    usedAt: String
    usedBy: User
  }

  extend type Query {
    invites: [Invite!]!
    invite(code: String!): Invite
  }

  extend type Mutation {
    createInvite(expiresInDays: Int): Invite!
    deleteInvite(id: ID!): Boolean!
  }
`;
