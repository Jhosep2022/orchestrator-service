import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { userId } = event;
  const { course } = event.outline;
  const now = new Date().toISOString();

  const pk = `COURSE#${course.id}`;
  const sk = 'METADATA';

  const cmd = new UpdateCommand({
    TableName: env.coursesTable,
    key: { PK: pk, SK: sk },
    UpdateExpression: `
      SET
        #etype = if_not_exists(#etype, :etype),
        ownerId = if_not_exists(ownerId, :ownerId),
        #title = if_not_exists(#title, :title),
        #level = if_not_exists(#level, :level),
        #tags = if_not_exists(#tags, :tags),
        #isPublished = if_not_exists(#isPublished, :isPublished),
        #status = if_not_exists(#status, :status),
        #createdAt = if_not_exists(#createdAt, :createdAt)
        GSI2PK = if_not_exists(GSI2PK, :gsi2pk),
        GSI2SK = if_not_exists(GSI2SK, :gsi2sk)
    `,
    ExpressionAttributeNames: {
      '#etype': 'etype',
      '#title': 'title',
      '#level': 'level',
      '#tags': 'tags',
      '#isPublished': 'isPublished',
      '#status': 'status',
      '#createdAt': 'createdAt',
    },
    ExpressionAttributeValues: {
      ':etype': 'COURSE',
      ':ownerId': userId,
      ':title': course.title ?? 'Nuevo curso',
      ':level': course.level ?? 'beginner',
      ':tags': Array.isArray(course.tags) ? course.tags : [],
      ':isPublished': true,
      ':status': 'active',
      ':createdAt': now,
      ':gsi2pk': `USER#${userId}`,
      ':gsi2sk': `STATUS#active#${now}`
    }
  });
  await doc.send(cmd);
  return { courseId: course.id };
};
