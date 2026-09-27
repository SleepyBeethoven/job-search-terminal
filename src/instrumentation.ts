export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkAndHandleRecoveryMarker } = await import("./lib/backups/account-backup");
    checkAndHandleRecoveryMarker();
    const { startBrowserBoardFileWatcher } = await import("./lib/scanner/linkedin-file-watcher");
    const { startJobDiscoveryScheduler } = await import("./lib/scanner/scheduler");
    const { startCareerAgentQueueSync } = await import("./lib/scanner/career-agent-queue-sync");
    startBrowserBoardFileWatcher();
    startJobDiscoveryScheduler();
    startCareerAgentQueueSync();
  }
}
