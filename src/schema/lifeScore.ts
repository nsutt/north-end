export const lifeScoreTypeDefs = `#graphql
  type LifeScore {
    id: ID!
    userId: ID!
    user: User
    score: Float!
    statusText: String
    gifUrl: String
    createdAt: String!
    groups: [Group!]!
    commentCount(groupId: ID!): Int!
    unreadCommentCount(groupId: ID!): Int!
    latestComment(groupId: ID!): ScoreComment
  }

  extend type User {
    lifeScores: [LifeScore!]!
  }

  extend type Query {
    lifeScore(id: ID!): LifeScore
    groupScores(groupId: ID!): [LifeScore!]!
  }

  extend type Mutation {
    postLifeScore(score: Float!, statusText: String, gifUrl: String, groupIds: [ID!]): LifeScore!
    deleteLifeScore(id: ID!): Boolean!
  }
`;
