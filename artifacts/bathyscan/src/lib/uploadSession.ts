export const UPLOAD_SESSION_KEY = "bathyscan_upload_session";

export interface SavedUploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  totalChunks: number;
  jobId?: string;
}

export function saveUploadSession(session: SavedUploadSession): void {
  try {
    sessionStorage.setItem(UPLOAD_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
}

export function clearUploadSession(): void {
  try {
    sessionStorage.removeItem(UPLOAD_SESSION_KEY);
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
}

export function loadUploadSession(): SavedUploadSession | null {
  try {
    const raw = sessionStorage.getItem(UPLOAD_SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedUploadSession) : null;
  } catch {
    return null;
  }
}
