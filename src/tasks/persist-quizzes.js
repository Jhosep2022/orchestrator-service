import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const quizzes = event.quizzes.items || [];

  const requests = [];
  for (const qz of quizzes) {
    for (const q of qz.questions) {
      requests.push({
        PutRequest: {
          Item: {
            PK: `LESSON#${qz.lessonId}`,
            SK: `Q#${q.position}#${q.id}`,
            etype: 'QUIZ_Q',
            lessonId: qz.lessonId,
            questionId: q.id,
            position: q.position,
            prompt: q.prompt,
            options: q.options
          }
        }
      });
    }
  }

  for (let i = 0; i < requests.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.quizzesTable]: requests.slice(i, i + 25) }
    }));
  }

  return { questions: requests.length };
};
