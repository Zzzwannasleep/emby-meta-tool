import type { Env } from "./types";

export async function aiFillMissing(env: Env, input: any): Promise<any> {
  const baseUrl = env.AI_BASE_URL;
  const apiKey = env.AI_API_KEY;
  const model = env.AI_MODEL || "gpt-4o-mini";

  if (!baseUrl || !apiKey) {
    throw new Error("未配置 AI_BASE_URL / AI_API_KEY，无法使用 AI 补全。");
  }

  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const prompt = {
    role: "user",
    content:
      "你是媒体元数据整理助手。请基于我提供的 JSON，补全缺失字段（不要乱编具体集数；缺失就留空）。" +
      "输出严格 JSON，不要解释文字。\n\n" +
      "需要补全字段示例：title, originalTitle, year, plot, premiered, rating, genres[], studios[], actors[]。\n\n" +
      "输入 JSON:\n" +
      JSON.stringify(input)
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: "只输出 JSON。不要输出 Markdown。" }, prompt],
      temperature: 0.2
    })
  });

  if (!res.ok) throw new Error(`AI 请求失败 ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json<any>();
  const text = data?.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI 返回不是合法 JSON，无法解析。请换模型/降低温度或检查代理兼容性。");
  }
}
