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

interface GroupData {
  name: string;
  ownerId: string;
  memberIds: string[];
}

const groups: GroupData[] = [
  {
    name: 'Go Blue Pals',
    ownerId: 'fc199248-1395-4ae1-aca6-7a0dd1002f9d',
    memberIds: [
      '76371d32-b64a-4064-ad41-a6007659fffe',
      '98507d11-3446-4c65-b83f-979d9b74ac29',
      '729b316e-2726-4137-8ed3-ca40c14caa75',
      '412421ab-36d9-437c-b596-c80513bd59ee',
      '07209a91-0a4c-47d1-be1c-6f3ca8249b19',
      '4c17246c-2ae0-4869-8696-280c3414aa8d',
      '5c592bff-6541-436b-93de-a2506f1f95d3',
      'b44daaf3-0dbd-41b2-aba6-4e21611c78a7',
      'ef1d76e9-c9ed-47f7-a759-84c87dde8a6e',
      '53e67993-71e6-46da-9481-7b910959745e',
      'fc199248-1395-4ae1-aca6-7a0dd1002f9d',
    ],
  },
  {
    name: 'Dudes Go Blue',
    ownerId: 'fc199248-1395-4ae1-aca6-7a0dd1002f9d',
    memberIds: [
      '412421ab-36d9-437c-b596-c80513bd59ee',
      '4c17246c-2ae0-4869-8696-280c3414aa8d',
      'b44daaf3-0dbd-41b2-aba6-4e21611c78a7',
      '53e67993-71e6-46da-9481-7b910959745e',
      'fc199248-1395-4ae1-aca6-7a0dd1002f9d',
    ],
  },
  {
    name: 'DGB',
    ownerId: '729b316e-2726-4137-8ed3-ca40c14caa75',
    memberIds: [
      '98507d11-3446-4c65-b83f-979d9b74ac29',
      '729b316e-2726-4137-8ed3-ca40c14caa75',
      '07209a91-0a4c-47d1-be1c-6f3ca8249b19',
      '5c592bff-6541-436b-93de-a2506f1f95d3',
      'ef1d76e9-c9ed-47f7-a759-84c87dde8a6e',
    ],
  },
  {
    name: 'Sutt Fam',
    ownerId: 'fc199248-1395-4ae1-aca6-7a0dd1002f9d',
    memberIds: [
      'fc199248-1395-4ae1-aca6-7a0dd1002f9d',
      'ff412ba9-469b-4a24-8015-f5bc6529497f',
      '03afdaca-a4ac-4819-80e6-a9cb24c47a34',
      'e4580749-0703-48f4-ac7a-539f86b78bf0',
    ],
  },
];

async function main() {
  console.log('Starting group migration...\n');

  for (const groupData of groups) {
    console.log(`Creating group: ${groupData.name}`);

    // Create the group
    const group = await prisma.group.create({
      data: {
        name: groupData.name,
        createdById: groupData.ownerId,
      },
    });

    console.log(`  Created group with ID: ${group.id}`);

    // Create memberships for all members
    for (const userId of groupData.memberIds) {
      const isOwner = userId === groupData.ownerId;

      await prisma.groupMembership.create({
        data: {
          groupId: group.id,
          userId: userId,
          role: isOwner ? 'OWNER' : 'MEMBER',
          status: 'ACCEPTED',
          joinedAt: new Date(),
        },
      });

      console.log(`  Added member: ${userId} (${isOwner ? 'OWNER' : 'MEMBER'})`);
    }

    console.log(`  Total members: ${groupData.memberIds.length}\n`);
  }

  console.log('Group migration complete!');
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
