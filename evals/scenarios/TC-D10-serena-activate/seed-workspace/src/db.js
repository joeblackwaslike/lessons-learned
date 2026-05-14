let _conn = null;

export async function connect(url) {
  if (_conn) return _conn;
  _conn = { url, open: true, queries: 0 };
  return _conn;
}

export async function query(sql, params = []) {
  if (!_conn?.open) throw new Error('No open connection');
  _conn.queries++;
  return { rows: [], sql, params, queryId: _conn.queries };
}

export async function close() {
  if (_conn) {
    _conn.open = false;
    _conn = null;
  }
}

export function isConnected() {
  return _conn?.open === true;
}

export async function withConnection(url, fn) {
  const conn = await connect(url);
  try {
    return await fn(conn);
  } finally {
    await close();
  }
}

export async function queryOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] ?? null;
}

export async function batchInsert(table, rows) {
  if (!rows.length) return 0;
  const results = await Promise.all(
    rows.map(row => query(`INSERT INTO ${table} VALUES (?)`, [JSON.stringify(row)]))
  );
  return results.length;
}
