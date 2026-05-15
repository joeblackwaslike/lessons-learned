The `processQueue` function in `src/queue.js` is hanging under concurrent load.
We're seeing it stall after ~50 items when 3 workers run simultaneously.

Find the root cause and fix it. Show me exactly what's wrong and the corrected code.
