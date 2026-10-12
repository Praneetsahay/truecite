/*
  The TrueCite engine: everything that talks to AI providers, runs scans,
  checks answers and produces reports. Pages and Server Actions import from
  here only, never from the internal modules.
*/
export { EngineError, EngineNotReadyError } from "./errors";
export { approveIssue, rejectIssue, type Reviewer } from "./review";
export { sendEmail } from "./email";
export { sendWeeklyDigests } from "./alerts";
export {
  cancelScan,
  ensureWorker,
  retryFailedJobs,
  runScheduledScans,
  scanProgress,
  startRecheck,
  startScan,
  type StartScanInput,
} from "./scans";
export { draftFactSheet } from "./facts";
export { generateQuestionSet } from "./questions";
export { buildReportData, createReport, renderReportPdf, shareReport } from "./reports";
export { createProspectReport, startProspectScan } from "./prospects";
export {
  DEFAULT_SETTINGS,
  getSettings,
  priceFor,
  providerKey,
  providerStatus,
  updateSetting,
  type Effort,
  type FeaturesSetting,
  type LimitsSetting,
  type ModelsSetting,
  type ProviderId,
  type Settings,
} from "./settings";
