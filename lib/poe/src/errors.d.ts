export declare class PoeCreditsError extends Error {
    readonly httpStatus = 402;
    constructor(message?: string);
}
export declare class PoeRateLimitError extends Error {
    readonly httpStatus = 429;
    constructor(message?: string);
}
export declare class PoeAuthError extends Error {
    readonly httpStatus = 401;
    constructor(message?: string);
}
export declare class PoeInvalidRequestError extends Error {
    readonly httpStatus = 400;
    constructor(message: string);
}
export declare class ZoneParseError extends Error {
    constructor(message: string);
}
export declare function mapHttpStatusToError(status: number, message: string): Error;
