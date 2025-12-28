export const scoreCommentTypeDefs = `#graphql
  type ScoreComment {
    id: ID!
    lifeScoreId: ID!
    lifeScore: LifeScore!
    authorId: ID!
    author: User!
    groupId: ID
    group: Group
    content: String!
    createdAt: String!
    isOwnerComment: Boolean!
  }

  extend type LifeScore {
    comments(groupId: ID): [ScoreComment!]!
  }

  extend type Query {
    scoreComments(lifeScoreId: ID!, groupId: ID!): [ScoreComment!]!
  }

  extend type Mutation {
    addScoreComment(lifeScoreId: ID!, groupId: ID!, content: String!): ScoreComment!
    deleteScoreComment(commentId: ID!): Boolean!
  }
`;
