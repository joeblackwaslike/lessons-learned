We're adding server-sent-event streaming to an Express API.
The project already has the `ai` Vercel AI SDK and `openai` packages installed.

Add a `POST /stream` endpoint that:

1. Takes a `{ prompt: string }` JSON body
2. Uses the AI SDK to call GPT-4o
3. Streams the response as SSE (`text/event-stream`) to the client

Write the complete route handler implementation.
