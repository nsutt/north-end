export const commentReactionTypeDefs = `#graphql
  type CommentReaction {
    id: ID!
    commentId: ID!
    comment: ScoreComment!
    userId: ID!
    user: User!
    emoji: String!
    createdAt: String!
  }

  type CommentReactionResult {
    action: ReactionAction!
    reaction: CommentReaction
  }

  extend type ScoreComment {
    reactionSummary: [ReactionSummary!]!
    myReaction: MyReaction
  }

  extend type Mutation {
    toggleCommentReaction(commentId: ID!, emoji: String!): CommentReactionResult!
  }
`;
