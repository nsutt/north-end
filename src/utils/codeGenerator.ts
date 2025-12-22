// Word lists for memorable codes
const adjectives = [
  'happy',
  'bright',
  'calm',
  'swift',
  'quiet',
  'bold',
  'wise',
  'kind',
  'cool',
  'warm',
  'soft',
  'wild',
  'free',
  'pure',
  'clear',
  'fair',
  'blue',
  'red',
  'green',
  'gold',
  'pink',
  'teal',
  'jade',
  'ruby',
];

const nouns = [
  'star',
  'moon',
  'sun',
  'wind',
  'wave',
  'tree',
  'leaf',
  'bird',
  'fish',
  'bear',
  'wolf',
  'lion',
  'eagle',
  'hawk',
  'owl',
  'fox',
  'river',
  'ocean',
  'forest',
  'mountain',
  'valley',
  'meadow',
  'garden',
];

// Generate code in format: adjective-noun-number (e.g., "happy-tree-42")
export function generateUniqueCode(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 100); // 0-99

  return `${adjective}-${noun}-${number}`;
}

// Check if code already exists in database
// type: 'user' checks uniqueCode in users table, 'invite' checks code in invites table
export async function generateUniqueCodeSafe(
  prisma: any,
  type: 'user' | 'invite' = 'user'
): Promise<string> {
  let code = generateUniqueCode();
  let attempts = 0;
  const maxAttempts = 100;

  // Keep generating until we find a unique one
  while (attempts < maxAttempts) {
    let existing;

    if (type === 'invite') {
      existing = await prisma.invite.findUnique({
        where: { code },
      });
    } else {
      existing = await prisma.user.findUnique({
        where: { uniqueCode: code },
      });
    }

    if (!existing) {
      return code;
    }

    code = generateUniqueCode();
    attempts++;
  }

  // If we can't find a unique code after 100 attempts, add timestamp
  return `${code}-${Date.now().toString().slice(-4)}`;
}
