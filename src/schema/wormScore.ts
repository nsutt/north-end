export const wormScoreTypeDefs = `#graphql
  type WormScore {
    id: ID!
    userId: ID!
    user: User
    levelId: String!
    score: Int!
    createdAt: String!
  }

  extend type Query {
    myHighScore(levelId: String!): WormScore
    levelHighScores(levelId: String!, limit: Int): [WormScore!]!
  }

  extend type Mutation {
    submitWormScore(levelId: String!, score: Int!): WormScore!
  }
`;
