// 事件总线：模块间解耦 + SSE 广播
const clients = new Set();

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.write(line); } catch { /* ignore */ }
  }
}

export function clientCount() {
  return clients.size;
}
