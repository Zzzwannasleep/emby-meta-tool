export type SSEMessage =
  | { event: "progress"; data: any }
  | { event: "done"; data: any }
  | { event: "error"; data: any };

export async function postSSE(url: string, body: any, onMsg: (m: SSEMessage) => void): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`SSE 请求失败: ${res.status} ${t}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // 解析 SSE: 以 \n\n 分隔
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event = "message";
      let dataStr = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (!dataStr) continue;

      try {
        const data = JSON.parse(dataStr);
        onMsg({ event: event as any, data });
      } catch {
        onMsg({ event: "error", data: { message: "解析 SSE 数据失败", raw: dataStr } });
      }
    }
  }
}
