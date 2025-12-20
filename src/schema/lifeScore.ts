export const lifeScoreTypeDefs = `#graphql
  type LifeScore {
    id: ID!
    userId: ID!
    user: User
    score: Int!
    createdAt: String!
  }

  extend type User {
    lifeScores: [LifeScore!]!
  }

  extend type Mutation {
    postLifeScore(score: Int!): LifeScore!
    deleteLifeScore(id: ID!): Boolean!
  }
`;
