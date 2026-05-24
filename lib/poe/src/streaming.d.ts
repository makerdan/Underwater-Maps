import type { PoeCompleteParams } from "./types.js";
export declare function poeStream(params: Omit<PoeCompleteParams, "stream">): AsyncGenerator<string>;
export declare function poeStreamToString(params: Omit<PoeCompleteParams, "stream">): Promise<string>;
export declare function pipeStreamToResponse(params: Omit<PoeCompleteParams, "stream">, res: {
    write: (data: string) => void;
    end: () => void;
    setHeader: (name: string, value: string) => void;
}): Promise<void>;
