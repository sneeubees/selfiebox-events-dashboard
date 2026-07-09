import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Monday 05:00 UTC = 07:00 South Africa (SAST has no DST). The handler no-ops
// unless the backend has AI_CRON_ENABLED=1, so only live runs the weekly report.
crons.cron("weekly AI analysis", "0 5 * * 1", internal.aiAnalysis.cronRun, {});

export default crons;
