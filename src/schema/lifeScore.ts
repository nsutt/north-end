export const lifeScoreTypeDefs = `#graphql
  type LifeScore {
    id: ID!
    userId: ID!
    user: User
    score: Float!
    createdAt: String!
  }

  extend type User {
    lifeScores: [LifeScore!]!
  }

  extend type Mutation {
    postLifeScore(score: Float!): LifeScore!
    deleteLifeScore(id: ID!): Boolean!
  }
`;
