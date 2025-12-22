import { prisma } from '../src/lib/prisma';

async function getNoahCode() {
  const noah = await prisma.user.findFirst({
    where: { displayName: 'Noah' },
    select: { displayName: true, uniqueCode: true }
  });

  console.log(JSON.stringify(noah, null, 2));
  await prisma.$disconnect();
}

getNoahCode();
