export const groupTypeDefs = `#graphql
  enum GroupRole {
    OWNER
    MEMBER
  }

  enum MembershipStatus {
    PENDING
    ACCEPTED
  }

  type Group {
    id: ID!
    name: String!
    createdById: ID!
    createdBy: User!
    members: [GroupMembership!]!
    memberCount: Int!
    myRole: GroupRole
    myLatestScore: LifeScore
    unreadCommentCount: Int!
    recentActivity: GroupRecentActivity
    createdAt: String!
    updatedAt: String!
  }

  type GroupRecentActivity {
    user: User!
    score: Float!
    createdAt: String!
  }

  type GroupMembership {
    id: ID!
    groupId: ID!
    group: Group!
    userId: ID!
    user: User!
    role: GroupRole!
    status: MembershipStatus!
    invitedBy: User
    createdAt: String!
    joinedAt: String
  }

  extend type User {
    groups: [Group!]!
    pendingGroupInvites: [GroupMembership!]!
  }

  extend type Query {
    group(id: ID!): Group
    myGroups: [Group!]!
    myPendingGroupInvites: [GroupMembership!]!
  }

  extend type Mutation {
    createGroup(name: String!): Group!
    updateGroup(id: ID!, name: String!): Group!
    deleteGroup(id: ID!): Boolean!
    inviteToGroup(groupId: ID!, userId: ID!): GroupMembership!
    acceptGroupInvite(groupId: ID!): GroupMembership!
    declineGroupInvite(groupId: ID!): Boolean!
    leaveGroup(groupId: ID!): Boolean!
    removeFromGroup(groupId: ID!, userId: ID!): Boolean!
    markCommentsRead(lifeScoreId: ID!, groupId: ID!): Boolean!
  }
`;
