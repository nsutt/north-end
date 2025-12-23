export const lifeScoreTypeDefs = `#graphql
  type LifeScore {
    id: ID!
    userId: ID!
    user: User
    score: Float!
    statusText: String
    createdAt: String!
  }

  extend type User {
    lifeScores: [LifeScore!]!
  }

  extend type Mutation {
    postLifeScore(score: Float!, statusText: String): LifeScore!
    deleteLifeScore(id: ID!): Boolean!
  }
`;
