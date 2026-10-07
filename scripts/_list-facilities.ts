import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(__dirname, '..', '.env.local'));
loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.metrcFacility.findMany({
    where: { metrcEnvironment: 'sandbox', isActive: true },
    select: { id: true, name: true, licenseNumber: true, facilityType: true },
    orderBy: { name: 'asc' },
    take: 30,
  });

  if (facilities.length === 0) {
    console.log('No sandbox facilities found. Run: npx tsx scripts/seed-sandbox.ts --provision-all');
  } else {
    console.log(`Found ${facilities.length} sandbox facilities:\n`);
    for (const f of facilities) {
      console.log(`  ${f.id}  ${f.licenseNumber}  ${f.name}  (${f.facilityType})`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
