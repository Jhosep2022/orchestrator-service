// src/tasks/persist-course.js
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const requestId = event?.requestId || 'no-request-id';
  const userId = event?.userId;
  const course = event?.outline?.course;

  // Resuelve table name (por si en algún deploy viene directo del process.env)
  const TableName = env.tableName || process.env.COURSES_TABLE_NAME;

  // Validaciones mínimas para evitar nulls
  if (!TableName) {
    console.error('[PERSIST][ERR] Missing TableName', { requestId, envTable: env?.tableName, rawEnv: process.env.COURSES_TABLE_NAME });
    throw new Error('MISSING_TABLE_NAME');
  }
  if (!userId) {
    console.error('[PERSIST][ERR] Missing userId', { requestId });
    throw new Error('MISSING_USER_ID');
  }
  if (!course?.id) {
    console.error('[PERSIST][ERR] Missing course.id', { requestId, course });
    throw new Error('MISSING_COURSE_ID');
  }

  const now = new Date().toISOString();
  const pk = `COURSE#${course.id}`;
  const sk = 'METADATA';

  // Debug útil
  console.log('[PERSIST][IN]', JSON.stringify({
    requestId, TableName, pk, sk, userId,
    courseId: course.id, title: course.title, level: course.level, tagsCount: Array.isArray(course.tags) ? course.tags.length : 0
  }));

  const cmd = new UpdateCommand({
    TableName,
    // 👇 OJO: Key con mayúscula
    Key: { PK: pk, SK: sk },
    UpdateExpression: `
      SET
        #etype       = if_not_exists(#etype, :etype),
        ownerId      = if_not_exists(ownerId, :ownerId),
        #title       = if_not_exists(#title, :title),
        #level       = if_not_exists(#level, :level),
        #tags        = if_not_exists(#tags, :tags),
        #isPublished = if_not_exists(#isPublished, :isPublished),
        #status      = if_not_exists(#status, :status),
        #createdAt   = if_not_exists(#createdAt, :createdAt),
        GSI2PK       = if_not_exists(GSI2PK, :gsi2pk),
        GSI2SK       = if_not_exists(GSI2SK, :gsi2sk)
    `.replace(/\s+/g, ' ').trim(),
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

  try {
    const out = await doc.send(cmd);
    console.log('[PERSIST][OUT]', JSON.stringify({ requestId, updated: true, outSummary: { ConsumedCapacity: out?.ConsumedCapacity } }));
    return { courseId: course.id };
  } catch (e) {
    // Log completo para CloudWatch
    console.error('[PERSIST][ERR][DDB]', {
      requestId,
      name: e.name,
      message: e.message,
      table: TableName,
      key: { PK: pk, SK: sk }
    });
    throw e;
  }
};
