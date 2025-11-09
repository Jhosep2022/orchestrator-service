import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { userId } = event;
  const { course } = event.outline;
  const now = new Date().toISOString();

  const item = {
    PK: `COURSE#${course.id}`,
    SK: 'METADATA',
    etype: 'COURSE',
    ownerId: userId,
    title: course.title,
    level: course.level || 'beginner',
    tags: course.tags || [],
    isPublished: true,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    GSI2PK: `USER#${userId}`,
    GSI2SK: `STATUS#active#${now}`,
  };

  await doc.send(new PutCommand({
    TableName: env.coursesTable,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));

  return { courseId: course.id, createdAt: now };
};
