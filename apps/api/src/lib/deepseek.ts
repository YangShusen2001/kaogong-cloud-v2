// Worker 侧 DeepSeek 客户端：解释划线句子（fetch 直调 api.deepseek.com）。
export async function explainText(text: string, key: string): Promise<string> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "你是申论/时政辅导老师。用简洁的中文解释用户划线的句子：先说字面含义，再说它的考点或政策背景。100 字左右。",
        },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
  });
  if (!res.ok) throw new Error("deepseek api error: " + res.status);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content.trim() ?? "";
}
