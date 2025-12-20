import { generateToken } from '../utils/auth';

interface User {
  id: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateUserInput {
  displayName?: string;
  avatarUrl?: string;
}

interface UpdateUserInput {
  displayName?: string;
  avatarUrl?: string;
}

// In-memory storage (replace with database later)
const users: Map<string, User> = new Map();
let nextId = 1;

// Export for use by other resolvers
export function getUserById(id: string): User | null {
  return users.get(id) || null;
}

export const userResolvers = {
  Query: {
    user: (_: any, { id }: { id: string }) => {
      return users.get(id) || null;
    },
    users: () => {
      return Array.from(users.values());
    },
    me: (_: any, __: any, context: any) => {
      if (!context.user) {
        return null;
      }
      return users.get(context.user.id) || null;
    },
  },
  Mutation: {
    createUser: (_: any, { input }: { input?: CreateUserInput }) => {
      const now = new Date().toISOString();
      const user: User = {
        id: String(nextId++),
        displayName: input?.displayName,
        avatarUrl: input?.avatarUrl,
        createdAt: now,
        updatedAt: now,
      };
      users.set(user.id, user);

      // Generate JWT token
      const token = generateToken(user.id);

      return {
        user,
        token,
      };
    },
    updateUser: (
      _: any,
      { id, input }: { id: string; input: UpdateUserInput }
    ) => {
      const user = users.get(id);
      if (!user) {
        throw new Error(`User with id ${id} not found`);
      }
      const updatedUser: User = {
        ...user,
        displayName: input.displayName ?? user.displayName,
        avatarUrl: input.avatarUrl ?? user.avatarUrl,
        updatedAt: new Date().toISOString(),
      };
      users.set(id, updatedUser);
      return updatedUser;
    },
  },
};
