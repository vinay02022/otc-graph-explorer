import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSystemPrompt } from '@/lib/prompts';
import { validateInput, validateSQL, extractEntityIds } from '@/lib/guardrails';
import { executeQuery } from '@/lib/db';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

export async function POST(request: NextRequest) {
  const { message, history } = await request.json();

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Layer 1: Pre-LLM guardrail
  const inputCheck = validateInput(message);
  if (!inputCheck.valid) {
    return new Response(
      `data: ${JSON.stringify({ type: 'answer', content: inputCheck.reason })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const systemPrompt = await getSystemPrompt();
        const model = genAI.getGenerativeModel({
          model: 'gemini-2.0-flash',
          systemInstruction: systemPrompt,
        });

        const geminiHistory = (history || []).map((msg: { role: string; content: string }) => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        }));

        const chat = model.startChat({ history: geminiHistory.slice(-10) });

        // Pass 1: Generate SQL
        send({ type: 'status', content: 'Generating query...' });
        const result = await chat.sendMessage(message);
        const response = result.response.text();

        // Check guardrail refusal
        if (response.includes('designed to answer questions related to the Order to Cash dataset only') ||
            response.includes('designed to answer questions related to the provided dataset only')) {
          send({ type: 'answer', content: response });
          send({ type: 'done' });
          controller.close();
          return;
        }

        // Extract SQL
        const sqlMatch = response.match(/```sql\n?([\s\S]*?)```/);
        if (!sqlMatch) {
          send({ type: 'answer', content: response });
          send({ type: 'done' });
          controller.close();
          return;
        }

        const sql = sqlMatch[1].trim();
        send({ type: 'sql', content: sql });

        // Layer 3: Validate SQL
        const sqlCheck = await validateSQL(sql);
        if (!sqlCheck.valid) {
          send({ type: 'answer', content: `Query blocked by safety checks: ${sqlCheck.reason}` });
          send({ type: 'done' });
          controller.close();
          return;
        }

        // Execute SQL
        send({ type: 'status', content: 'Executing query...' });
        const { rows } = await executeQuery(sql);
        const highlightedNodes = extractEntityIds(rows);
        send({ type: 'data', content: JSON.stringify(rows) });
        send({ type: 'highlightedNodes', content: JSON.stringify(highlightedNodes) });

        if (rows.length === 0) {
          send({ type: 'answer', content: 'The query returned no results. Try broadening your search.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

        // Pass 2: Stream the summary
        send({ type: 'status', content: 'Analyzing results...' });
        const dataPreview = rows.slice(0, 15);
        const summaryPrompt = `The user asked: "${message}"

I ran this SQL query:
${sql}

Here are the results (${rows.length} rows total, showing first ${dataPreview.length}):
${JSON.stringify(dataPreview, null, 2)}

Now provide a clear, concise natural language answer summarizing these results. Include specific numbers, product names, document IDs, and amounts from the data. Do NOT include the SQL query in your response. Do NOT describe what the query does - instead, directly answer the user's question using the actual data. Mention relevant entity IDs (like salesOrder, billingDocument, product codes) so they can be highlighted in the graph.`;

        const streamResult = await chat.sendMessageStream(summaryPrompt);
        for await (const chunk of streamResult.stream) {
          const text = chunk.text();
          if (text) {
            send({ type: 'chunk', content: text });
          }
        }

        send({ type: 'done' });
      } catch (error) {
        send({ type: 'error', content: (error as Error).message });
        send({ type: 'done' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
