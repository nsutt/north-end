export const scoreReactionTypeDefs = `#graphql
  type ScoreReaction {
    id: ID!
    lifeScoreId: ID!
    lifeScore: LifeScore!
    userId: ID!
    user: User!
    groupId: ID!
    group: Group!
    emoji: String!
    createdAt: String!
  }

  type ReactionSummary {
    emoji: String!
    count: Int!
    hasReacted: Boolean!
    users: [User!]!
  }

  type MyReaction {
    id: ID!
    emoji: String!
  }

  type ScoreReactionResult {
    action: ReactionAction!
    reaction: ScoreReaction
  }

  enum ReactionAction {
    ADDED
    REMOVED
    REPLACED
  }

  extend type LifeScore {
    reactionSummary(groupId: ID!): [ReactionSummary!]!
    myReaction(groupId: ID!): MyReaction
  }

  extend type Mutation {
    toggleScoreReaction(lifeScoreId: ID!, groupId: ID!, emoji: String!): ScoreReactionResult!
  }
`;
