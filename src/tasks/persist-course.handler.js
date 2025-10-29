import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const { userId } = event;
  const { course } = event.outline || event; // por si se llama directo
  const now = new Date().toISOString();

  // METADATA del curso (denormalizada)
  const item = {
    PK: `COURSE#${course.id}`,
    SK: 'METADATA',
    etype: 'COURSE',
    title: course.title,
    level: course.level,
    isPublished: true,
    tags: course.tags || [],
    createdBy: `USER#${userId}`,
    createdAt: now,
    GSI1PK: 'TYPE#COURSE',
    GSI1SK: now
  };
  await doc.send(new PutCommand({ TableName: env.tableName, Item: item }));

  // Enrolment del usuario (estado inicial)
  const enrollment = {
    PK: `USER#${userId}`,
    SK: `COURSE#${course.id}`,
    etype: 'ENROLLMENT',
    status: 'active',
    startedAt: now,
    progressPercent: 0,
    completedLessons: 0,
    totalLessons: 0,
    updatedAt: now,
    GSI2PK: `USER#${userId}`,
    GSI2SK: `STATUS#active#${now}`
  };
  await doc.send(new PutCommand({ TableName: env.tableName, Item: enrollment }));

  // Nodo UC (usuario-curso) con METADATA del curso para joins rápidos
  const ucMeta = {
    PK: `UC#${userId}#${course.id}`,
    SK: 'COURSE#METADATA',
    etype: 'COURSE_META',
    courseId: course.id,
    title: course.title,
    level: course.level,
    createdAt: now,
    totalLessons: 0
  };
  await doc.send(new PutCommand({ TableName: env.tableName, Item: ucMeta }));

  return { courseId: course.id, createdAt: now };
};
