import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

// Create a PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create the Prisma adapter
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Starting score-to-groups migration...\n');

  // Get all life scores that don't have any group associations yet
  const scoresWithoutGroups = await prisma.lifeScore.findMany({
    where: {
      groups: {
        none: {},
      },
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
    },
  });

  console.log(`Found ${scoresWithoutGroups.length} scores without group associations.\n`);

  if (scoresWithoutGroups.length === 0) {
    console.log('No scores to migrate. Done!');
    return;
  }

  // Get all user group memberships (only ACCEPTED)
  const memberships = await prisma.groupMembership.findMany({
    where: {
      status: 'ACCEPTED',
    },
    select: {
      userId: true,
      groupId: true,
    },
  });

  // Build a map of userId -> groupIds[]
  const userGroupsMap = new Map<string, string[]>();
  for (const membership of memberships) {
    const existing = userGroupsMap.get(membership.userId) || [];
    existing.push(membership.groupId);
    userGroupsMap.set(membership.userId, existing);
  }

  console.log(`Found ${memberships.length} group memberships across ${userGroupsMap.size} users.\n`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const score of scoresWithoutGroups) {
    const userGroups = userGroupsMap.get(score.userId);

    if (!userGroups || userGroups.length === 0) {
      skippedCount++;
      continue;
    }

    // Create LifeScoreGroup entries for each group
    for (const groupId of userGroups) {
      await prisma.lifeScoreGroup.create({
        data: {
          lifeScoreId: score.id,
          groupId: groupId,
        },
      });
      createdCount++;
    }

    console.log(`  Score ${score.id} -> assigned to ${userGroups.length} group(s)`);
  }

  console.log(`\nMigration complete!`);
  console.log(`  - Created ${createdCount} score-group associations`);
  console.log(`  - Skipped ${skippedCount} scores (users not in any groups)`);
}

main()
  .catch((e) => {
    console.error('Error during migration:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
