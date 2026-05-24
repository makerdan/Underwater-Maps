import type { ResponsesInputItem, TerrainGrid } from "./types.js";
export declare function buildVisionInput(prompt: string, imageDataUrl: string): ResponsesInputItem[];
export declare function buildMultiModalMessages(systemPrompt: string, userText: string, imageDataUrl: string): Array<{
    role: string;
    content: Array<{
        type: string;
        text?: string;
        image_url?: {
            url: string;
        };
    }>;
}>;
export declare function depthGridToBase64Png(grid: TerrainGrid, targetSize?: number): string;
