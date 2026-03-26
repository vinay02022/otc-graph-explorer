import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSystemPrompt } from './prompts';
import { validateInput, validateSQL, extractEntityIds } from './guardrails';
import { executeQuery } from './db';
import type { ChatResponse } from '@/types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

interface ConversationMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export async function processChat(
  userMessage: string,
  history: ConversationMessage[] = []
): Promise<ChatResponse> {
  // Layer 1: Pre-LLM guardrail
  const inputCheck = validateInput(userMessage);
  if (!inputCheck.valid) {
    return { answer: inputCheck.reason || 'Invalid input.' };
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: getSystemPrompt(),
  });

  // Layer 2: LLM generates SQL (with guardrails in system prompt)
  const chat = model.startChat({
    history: history.slice(-10),
  });

  const result = await chat.sendMessage(userMessage);
  const response = result.response.text();

  // Check if the LLM refused (guardrail in system prompt worked)
  if (response.includes('designed to answer questions related to the Order to Cash dataset only') ||
      response.includes('designed to answer questions related to the provided dataset only')) {
    return { answer: response };
  }

  // Extract SQL from response
  const sqlMatch = response.match(/```sql\n?([\s\S]*?)```/);
  if (!sqlMatch) {
    // No SQL generated - might be a clarification or explanation
    return { answer: response };
  }

  const sql = sqlMatch[1].trim();

  // Layer 3: Post-LLM SQL validation
  const sqlCheck = validateSQL(sql);
  if (!sqlCheck.valid) {
    return {
      answer: `I generated a query but it was blocked by safety checks: ${sqlCheck.reason}. Please try rephrasing your question.`,
    };
  }

  // Execute the SQL
  try {
    const { rows } = executeQuery(sql);
    const highlightedNodes = extractEntityIds(rows);

    // SECOND PASS: Send results back to LLM for a data-backed natural language summary
    if (rows.length > 0) {
      const dataPreview = rows.slice(0, 15);
      const summaryPrompt = `The user asked: "${userMessage}"

I ran this SQL query:
${sql}

Here are the results (${rows.length} rows total, showing first ${dataPreview.length}):
${JSON.stringify(dataPreview, null, 2)}

Now provide a clear, concise natural language answer summarizing these results. Include specific numbers, product names, document IDs, and amounts from the data. Do NOT include the SQL query in your response. Do NOT describe what the query does - instead, directly answer the user's question using the actual data. Mention relevant entity IDs (like salesOrder, billingDocument, product codes) so they can be highlighted in the graph.`;

      const summaryResult = await chat.sendMessage(summaryPrompt);
      const summaryAnswer = summaryResult.response.text();

      return {
        answer: summaryAnswer,
        sql,
        data: rows,
        highlightedNodes,
      };
    } else {
      return {
        answer: 'The query returned no results. This could mean no data matches the criteria. Try broadening your search or rephrasing the question.',
        sql,
        data: [],
        highlightedNodes: [],
      };
    }
  } catch (error) {
    const errMsg = (error as Error).message;

    // Try to get the LLM to fix the SQL
    try {
      const fixResult = await chat.sendMessage(
        `The SQL query failed with error: "${errMsg}". Please fix the SQL and try again. Remember to use the exact table and column names from the schema.`
      );
      const fixResponse = fixResult.response.text();
      const fixSqlMatch = fixResponse.match(/```sql\n?([\s\S]*?)```/);

      if (fixSqlMatch) {
        const fixedSql = fixSqlMatch[1].trim();
        const fixSqlCheck = validateSQL(fixedSql);
        if (fixSqlCheck.valid) {
          try {
            const { rows } = executeQuery(fixedSql);
            const highlightedNodes = extractEntityIds(rows);

            if (rows.length > 0) {
              const dataPreview = rows.slice(0, 15);
              const summaryPrompt = `The user asked: "${userMessage}"

I ran this corrected SQL query and got ${rows.length} results:
${JSON.stringify(dataPreview, null, 2)}

Provide a clear, concise natural language answer summarizing the actual data. Do NOT include SQL. Directly answer the question with specific numbers and IDs from the results.`;

              const summaryResult = await chat.sendMessage(summaryPrompt);
              return {
                answer: summaryResult.response.text(),
                sql: fixedSql,
                data: rows,
                highlightedNodes,
              };
            }

            return {
              answer: 'The corrected query returned no results.',
              sql: fixedSql,
              data: [],
              highlightedNodes: [],
            };
          } catch (e2) {
            return {
              answer: `Query still failed after correction: ${(e2 as Error).message}. Please try a different question.`,
              sql: fixedSql,
            };
          }
        }
      }

      return { answer: fixResponse };
    } catch {
      return {
        answer: `I encountered an error executing the query: ${errMsg}. Please try rephrasing your question.`,
        sql,
      };
    }
  }
}
