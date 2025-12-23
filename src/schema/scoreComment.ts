export const scoreCommentTypeDefs = `#graphql
  type ScoreComment {
    id: ID!
    lifeScoreId: ID!
    lifeScore: LifeScore!
    authorId: ID!
    author: User!
    content: String!
    createdAt: String!
    isOwnerComment: Boolean!
  }

  extend type LifeScore {
    comments: [ScoreComment!]!
  }

  extend type Query {
    scoreComments(lifeScoreId: ID!): [ScoreComment!]!
  }

  extend type Mutation {
    addScoreComment(lifeScoreId: ID!, content: String!): ScoreComment!
    deleteScoreComment(commentId: ID!): Boolean!
  }
`;
