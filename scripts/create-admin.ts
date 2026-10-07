import { createInterface } from 'node:readline';
import { dashboardPrisma } from '../src/lib/prisma';
import { createAdmin, hasSuperAdmin } from '../src/services/setup/create-admin';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void });
    write._writeToOutput = (s: string) => { if (s.includes(question)) process.stdout.write(s); };
    let answered = false;
    rl.on('close', () => { if (!answered) reject(new Error('Input closed before a password was entered')); });
    rl.question(question, (answer) => { answered = true; rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const db = dashboardPrisma as never;
  if (process.argv.includes('--check')) {
    process.exit((await hasSuperAdmin(db)) ? 0 : 3);
  }
  const email = arg('email') ?? process.env.ADMIN_EMAIL;
  if (!email) {
    console.error('Usage: create-admin --email <email> [--password <pw>] [--org <name>]');
    process.exit(2);
  }
  let password = arg('password') ?? process.env.ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('No TTY: set ADMIN_PASSWORD or pass --password');
      process.exit(2);
    }
    password = await promptHidden('Password: ');
    if (password !== (await promptHidden('Confirm password: '))) {
      console.error('Passwords do not match');
      process.exit(2);
    }
  }
  const r = await createAdmin(db, { email, password, orgName: arg('org') ?? process.env.ADMIN_ORG });
  console.log(`${r.created ? 'Created' : 'Updated'} super admin ${email.trim().toLowerCase()} (organization ${r.organizationId})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
