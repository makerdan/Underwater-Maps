import type { Response } from "express";

export interface ApiErrorResponse {
  error: string;
  details: string;
}

export function sendApiError(
  res: Response,
  status: number,
  error: string,
  details: string,
): void {
  res.status(status).json({ error, details } satisfies ApiErrorResponse);
}
