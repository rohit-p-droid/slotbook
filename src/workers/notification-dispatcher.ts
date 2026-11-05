import { dispatchPendingNotifications } from '../lib/notifications';

async function runWorker() {
  console.log('📬 Notification Outbox Worker started...');

  const intervalMs = 5000;

  const loop = async () => {
    try {
      const result = await dispatchPendingNotifications(25);
      if (result.processed > 0 || result.failed > 0) {
        console.log(`[Worker] Processed ${result.processed} notifications, ${result.failed} failed.`);
      }
    } catch (err) {
      console.error('[Worker Error]:', err);
    }
    setTimeout(loop, intervalMs);
  };

  loop();
}

runWorker();
