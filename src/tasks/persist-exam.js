import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { userId } = event;
  const courseId = event.outline.course.id;
  const examQs = event.exam.items;

  // Cabecera EXAM (en UC para fácil lectura del user)
  await doc.send(new PutCommand({
    TableName: env.tableName,
    Item: {
      PK: `UC#${userId}#${courseId}`,
      SK: 'EXAM#COURSE#META',
      etype: 'COURSE_EXAM',
      mode: event.exam.meta?.mode || 'final',
      timeLimitMinutes: event.exam.meta?.timeLimitMinutes || 0,
      totalQuestions: examQs.length
    }
  }));

  // Preguntas
  const puts = examQs.map((q, i) => ({
    PutRequest: {
      Item: {
        PK: `UC#${userId}#${courseId}`,
        SK: `EXAM#COURSE#Q#${q.id}`,
        etype: 'COURSE_EXAM_Q',
        position: i + 1,
        prompt: q.prompt,
        options: q.options
      }
    }
  }));

  for (let i = 0; i < puts.length; i += 25) {
    const chunk = puts.slice(i, i + 25);
    await doc.send(new BatchWriteCommand({ RequestItems: { [env.tableName]: chunk } }));
  }

  return { totalQuestions: examQs.length };
};
