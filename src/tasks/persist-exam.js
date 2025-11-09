import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const courseId = event.outline.course.id;
  const examQs = event.exam.items || [];

  await doc.send(new PutCommand({
    TableName: env.examsTable,
    Item: {
      PK: `COURSE#${courseId}`,
      SK: 'EXAM#META',
      etype: 'EXAM',
      mode: event.exam.meta?.mode || 'final',
      timeLimitMinutes: event.exam.meta?.timeLimitMinutes || 0,
      totalQuestions: examQs.length,
      createdAt: new Date().toISOString(),
    }
  }));

  const puts = examQs.map((q, i) => ({
    PutRequest: {
      Item: {
        PK: `COURSE#${courseId}`,
        SK: `EXAM#Q#${String(i + 1).padStart(3, '0')}#${q.id}`,
        etype: 'EXAM_Q',
        position: i + 1,
        prompt: q.prompt,
        options: q.options,
      }
    }
  }));

  for (let i = 0; i < puts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.examsTable]: puts.slice(i, i + 25) }
    }));
  }

  return { totalQuestions: examQs.length };
};
