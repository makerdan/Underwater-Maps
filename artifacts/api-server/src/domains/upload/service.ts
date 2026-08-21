import { registerCache } from "../../lib/cacheRegistry.js";
import crypto from "crypto";

export type UploadLifecycleStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "done"
  | "error";

export interface UploadSession {
  userId: string;
  /** True while chunk 0 is moving to disk and its durable row is being created. */
  initializing?: boolean;
  /** Whether this process created the session or restored it from upload_jobs. */
  source?: "live" | "rehydrated";
  /** Durable lifecycle state mirrored from upload_jobs. */
  lifecycleStatus?: UploadLifecycleStatus;
  /** Expected chunk count once chunk 0 establishes it. */
  totalChunks?: number;
  /** True while finalize is in flight. */
  finalizing?: boolean;
  /** Set when finalize has been called; prevents double-processing. */
  activeJobId?: string;
  /** Durable row created by chunk 0 and reused by finalize. */
  sessionJobId?: string;
  /** Last request activity, used by the stale-session sweep. */
  lastActivityAt: number;
  /** True only for IDs issued by POST /upload/start. */
  serverIssued?: boolean;
}

export interface UploadJobState {
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  error?: string;
  datasetId?: string;
  userId: string;
  lastActivityAt?: number;
  skippedCount?: number;
  skippedFormats?: string[];
  soundingCount?: number;
  substrateCount?: number;
  parseWarnings?: string[];
  stageTimestamps?: Array<{ progress: number; ts: number }>;
  eta?: number | null;
  fileBytes?: number;
  stageStartedAt?: Date | null;
  fileExt?: string;
  jobStartedAt?: number;
}

/**
 * Process-local owner for resumable-upload state.
 *
 * The route owns HTTP concerns and the parser owns terrain processing. This
 * service owns only the request-independent state shared by start, chunk,
 * status, finalize, recovery, and cleanup transitions.
 */
export const uploadState = {
  sessions: new Map<string, UploadSession>(),
  jobs: new Map<string, UploadJobState>(),

  /** Start the ownership chain before any multipart data is accepted. */
  startSession(userId: string): string {
    const uploadId = crypto.randomUUID();
    this.sessions.set(uploadId, {
      userId,
      serverIssued: true,
      source: "live",
      lifecycleStatus: "uploading",
      lastActivityAt: Date.now(),
    });
    return uploadId;
  },
};

registerCache(() => {
  uploadState.sessions.clear();
  uploadState.jobs.clear();
});