import { useEffect, useState } from 'react';

// Calls every endpoint exposed by src/api.py. Keep this in sync with the API.
const ENDPOINTS = ['/users', '/items'];

export function App() {
  const [data, setData] = useState<Record<string, unknown>>({});

  useEffect(() => {
    Promise.all(
      ENDPOINTS.map((path) => fetch(path).then((r) => r.json().then((j) => [path, j] as const)))
    ).then((pairs) => setData(Object.fromEntries(pairs)));
  }, []);

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
