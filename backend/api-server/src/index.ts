import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './lib/database.js';
import { sendDueChargingReminders } from './jobs/reminders.js';

console.info('SANFAANI API startup: environment loaded');
console.info('SANFAANI API startup: database connecting');
try {
  await connectDatabase();
} catch (error) {
  console.error('SANFAANI API startup failed during database connection');
  throw error;
}
console.info('SANFAANI API startup: database connected');
const server = app.listen(env.SERVER_PORT, () => console.log(`SANFAANI API listening on port ${env.SERVER_PORT}`));
const reminderTimer = setInterval(() => { void sendDueChargingReminders().catch(console.error); }, 60_000);
reminderTimer.unref();
async function shutdown() {
  clearInterval(reminderTimer);
  server.close(async () => { await disconnectDatabase(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
