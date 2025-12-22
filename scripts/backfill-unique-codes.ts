import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { generateUniqueCodeSafe } from '../src/utils/codeGenerator';

async function backfillUniqueCodes() {
  try {
    console.log('🔍 Finding users without unique codes...');

    // Find all users without a uniqueCode
    const usersWithoutCodes = await prisma.user.findMany({
      where: {
        uniqueCode: null,
      },
    });

    console.log(`📊 Found ${usersWithoutCodes.length} users without codes`);

    if (usersWithoutCodes.length === 0) {
      console.log('✅ All users already have unique codes!');
      return;
    }

    console.log('🔄 Generating codes...\n');

    // Generate and assign codes
    for (const user of usersWithoutCodes) {
      const uniqueCode = await generateUniqueCodeSafe(prisma);

      await prisma.user.update({
        where: { id: user.id },
        data: { uniqueCode },
      });

      console.log(`✓ ${user.displayName || 'Anonymous'} (${user.id}): ${uniqueCode}`);
    }

    console.log(`\n✅ Successfully generated codes for ${usersWithoutCodes.length} users!`);
  } catch (error) {
    console.error('❌ Error backfilling codes:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

backfillUniqueCodes();
