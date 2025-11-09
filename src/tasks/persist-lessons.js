import { BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { userId } = event;
  const courseId = event.outline.course.id;
  const items = event.lessons.items;

  // Guardamos lecciones bajo la partición UC#user#course
  const puts = items.map((l) => ({
    PutRequest: {
      Item: {
        PK: `UC#${userId}#${courseId}`,
        SK: `LESSON#${l.id}`,
        etype: 'LESSON',
        courseId,
        moduleId: l.moduleId,
        lessonId: l.id,
        title: l.title,
        durationMinutes: l.durationMinutes,
        order: l.order,
        contentMD: l.contentMD,
        summary: l.summary
      }
    }
  }));

  // Batch (en lotes de 25)
  for (let i = 0; i < puts.length; i += 25) {
    const chunk = puts.slice(i, i + 25);
    await doc.send(new BatchWriteCommand({ RequestItems: { [env.tableName]: chunk } }));
  }

  // Actualiza totales en UC y ENROLLMENT
  const total = items.length;
  await doc.send(new UpdateCommand({
    TableName: env.tableName,
    Key: { PK: `UC#${userId}#${courseId}`, SK: 'COURSE#METADATA' },
    UpdateExpression: 'SET totalLessons = :t',
    ExpressionAttributeValues: { ':t': total }
  }));
  await doc.send(new UpdateCommand({
    TableName: env.tableName,
    Key: { PK: `USER#${userId}`, SK: `COURSE#${courseId}` },
    UpdateExpression: 'SET totalLessons = :t',
    ExpressionAttributeValues: { ':t': total }
  }));

  return { totalLessons: total };
};
