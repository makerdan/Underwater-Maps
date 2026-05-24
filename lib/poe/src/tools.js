export function buildToolSchema(name, description, paramsJsonSchema) {
    return {
        type: "function",
        function: { name, description, parameters: paramsJsonSchema },
    };
}
export function parseToolCalls(message) {
    if (!message.tool_calls || message.tool_calls.length === 0)
        return [];
    return message.tool_calls.map((tc) => {
        let args = {};
        try {
            args = JSON.parse(tc.function.arguments);
        }
        catch {
            args = {};
        }
        return { name: tc.function.name, args, id: tc.id };
    });
}
export function hasToolCalls(message) {
    return (message.tool_calls?.length ?? 0) > 0;
}
export function buildToolResultMessage(toolCallId, result) {
    return { role: "tool", tool_call_id: toolCallId, content: result };
}
