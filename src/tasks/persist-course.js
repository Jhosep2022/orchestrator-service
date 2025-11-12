// src/tasks/persist-course.js
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

// --- helpers robustos ---
const pickCourseId = (evt) =>
  evt?.courseId ??
  evt?.draftCourseId ??
  evt?.payload?.courseId ??
  evt?.payload?.draftCourseId ??
  evt?.outline?.course?.id ??
  evt?.outline?.outline?.course?.id ??           // <- tu caso
  null;

const pickCourseObj = (evt) =>
  evt?.course ??
  evt?.payload?.course ??
  evt?.outline?.course ??
  evt?.outline?.outline?.course ?? null;         // <- tu caso

export const handler = async (event = {}) => {
  const requestId = event.requestId || 'no-request-id';
  const userId =
    event.userId ??
    event.payload?.userId ??
    'unknown';

  // Resuelve nombre de tabla correctamente
  const TableName =
    env.coursesTable ||             // <- variable típica en tu proyecto
    env.tableName ||                // fallback si alguien la llamó así
    process.env.COURSES_TABLE_NAME; // fallback por entorno

  if (!TableName) {
    console.error('[PERSIST][ERR] Missing TableName', {
      requestId,
      envCourses: env?.coursesTable,
      envTable: env?.tableName,
      rawEnv: process.env.COURSES_TABLE_NAME
    });
    throw new Error('MISSING_TABLE_NAME');
  }
  if (!userId || userId === 'unknown') {
    console.error('[PERSIST][ERR] Missing userId', { requestId, userId });
    throw new Error('MISSING_USER_ID');
  }

  const courseId = pickCourseId(event);
  const course = pickCourseObj(event);

  if (!courseId) {
    console.error('[PERSIST][ERR] MISSING_COURSE_ID', {
      requestId,
      fromPayload: event?.payload?.draftCourseId,
      fromOutline: event?.outline?.outline?.course?.id,
    });
    throw new Error('MISSING_COURSE_ID');
  }

  // si vino objeto course sin id, injéctaselo
  const safeCourse = { id: courseId, ...course };

  const now = new Date().toISOString();
  const pk = `COURSE#${safeCourse.id}`;
  const sk = 'METADATA';

  console.log('[PERSIST][IN]', JSON.stringify({
    requestId, TableName, pk, sk, userId,
    courseId: safeCourse.id,
    hasCourse: !!course,
    title: safeCourse.title,
    level: safeCourse.level,
    tagsCount: Array.isArray(safeCourse.tags) ? safeCourse.tags.length : 0
  }));

  const cmd = new UpdateCommand({
    TableName,
    Key: { PK: pk, SK: sk },
    UpdateExpression: `
      SET
        #etype       = if_not_exists(#etype, :etype),
        #ownerId     = if_not_exists(#ownerId, :ownerId),
        #title       = :title,
        #level       = :level,
        #tags        = :tags,
        #status      = if_not_exists(#status, :status),
        #isPublished = if_not_exists(#isPublished, :isPublished),
        #updatedAt   = :now,
        #createdAt   = if_not_exists(#createdAt, :now),
        GSI2PK       = if_not_exists(GSI2PK, :gsi2pk),
        GSI2SK       = :gsi2sk
    `.replace(/\s+/g, ' ').trim(),
    ExpressionAttributeNames: {
      '#etype': 'entityType',
      '#ownerId': 'ownerId',
      '#title': 'title',
      '#level': 'level',
      '#tags': 'tags',
      '#status': 'status',
      '#isPublished': 'isPublished',
      '#updatedAt': 'updatedAt',
      '#createdAt': 'createdAt',
    },
    ExpressionAttributeValues: {
      ':etype': 'COURSE',
      ':ownerId': userId,
      ':title': safeCourse.title ?? 'Nuevo curso',
      ':level': safeCourse.level ?? 'beginner',
      ':tags': Array.isArray(safeCourse.tags) ? safeCourse.tags : [],
      ':status': 'draft',           // si luego publicas, cámbialo a 'active'
      ':isPublished': false,        // idem
      ':now': now,
      ':gsi2pk': `USER#${userId}`,
      ':gsi2sk': `UPDATED#${now}`,
    },
  });

  try {
    const out = await doc.send(cmd);
    console.log('[PERSIST][OUT]', JSON.stringify({
      requestId, updated: true,
      consumed: out?.ConsumedCapacity
    }));
    return { ok: true, courseId: safeCourse.id };
  } catch (e) {
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
