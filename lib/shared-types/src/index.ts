/**
 * RemoteData<T> — discriminated union for async data fields.
 *
 * Replaces the common pattern of `T | null` (or `T | null` + `loading: boolean`
 * + `error: Error | null`) with a single field that makes every state explicit
 * and unrepresentable-invalid.
 *
 * Usage in a Zustand store:
 *
 *   interface MyStore {
 *     userData: RemoteData<User>;
 *     loadUser: (id: string) => Promise<void>;
 *   }
 *
 *   // Reading:
 *   const userData = useMyStore((s) => s.userData);
 *   if (userData.status === 'done') {
 *     console.log(userData.data.name);
 *   }
 *
 * Candidate fields for follow-on migration to RemoteData<T>:
 *   - tidalStore: station + stationStatus → RemoteData<TideStationInfo>
 *   - tidalStore: samples + predictionsStatus → RemoteData<TideSample[]>
 *   - tidalStore: datums + datumsStatus → RemoteData<TideStationDatums>
 *   - classificationStore: zoneMap + loading + error → RemoteData<Uint8Array>
 *   - habitatStore: scores + implicit-loading → RemoteData<Float32Array>
 */

/** Data has not been requested yet. */
export interface RemoteDataIdle {
  readonly status: "idle";
}

/** A fetch/compute is in progress. */
export interface RemoteDataLoading {
  readonly status: "loading";
}

/** Data was successfully fetched/computed. */
export interface RemoteDataDone<T> {
  readonly status: "done";
  readonly data: T;
}

/** The fetch/compute failed. */
export interface RemoteDataError {
  readonly status: "error";
  readonly error: Error;
}

/**
 * Discriminated union for async data. Use `rd.status` to narrow to a branch.
 *
 * - `"idle"`: not yet requested
 * - `"loading"`: request in flight
 * - `"done"`: data available at `rd.data`
 * - `"error"`: failed, reason at `rd.error`
 */
export type RemoteData<T> =
  | RemoteDataIdle
  | RemoteDataLoading
  | RemoteDataDone<T>
  | RemoteDataError;

/** Convenience constructors so call-sites stay terse. */
export const RemoteData = {
  idle: (): RemoteDataIdle => ({ status: "idle" }),
  loading: (): RemoteDataLoading => ({ status: "loading" }),
  done: <T>(data: T): RemoteDataDone<T> => ({ status: "done", data }),
  error: (error: Error): RemoteDataError => ({ status: "error", error }),
} as const;
