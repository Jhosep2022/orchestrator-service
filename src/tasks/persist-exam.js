// src/tasks/persist-exam.js
import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

// ---- pickers robustos
const pickCourseId = (evt) =>
  evt?.courseId ??
  evt?.payload?.courseId ??
  evt?.payload?.draftCourseId ??
  evt?.outline?.course?.id ??
  evt?.outline?.outline?.course?.id ?? // <- tu caso actual
  null;

const pickExamBlock = (evt) => {
  // soporta { exam: { items, meta } } y { exam: { exam: { items, meta } } }
  if (evt?.exam?.items || evt?.exam?.meta) return evt.exam;
  if (evt?.exam?.exam) return evt.exam.exam;
  return { items: [], meta: {} };
};

export const handler = async (event = {}) => {
  const requestId = event.requestId || 'no-request-id';
  const courseId  = pickCourseId(event);
  const examBlock = pickExamBlock(event);
  const items     = Array.isArray(examBlock.items) ? examBlock.items : [];
  const meta      = examBlock.meta || {};

  if (!env.examsTable) {
    console.error('[EXAM][ERR] Missing env.examsTable', { requestId, envExams: env?.examsTable, RAW: process.env.EXAMS_TABLE_NAME });
    throw new Error('MISSING_EXAMS_TABLE');
  }
  if (!courseId) {
    console.error('[EXAM][ERR] Missing courseId', {
      requestId,
      fromPayload: event?.payload?.draftCourseId,
      fromOutline: event?.outline?.outline?.course?.id
    });
    throw new Error('MISSING_COURSE_ID');
  }

  console.log('[EXAM][IN]', JSON.stringify({
    requestId, courseId, table: env.examsTable,
    totalItems: items.length, metaKeys: Object.keys(meta || {})
  }));

  // Upsert META del examen
  await doc.send(new PutCommand({
    TableName: env.examsTable,
    Item: {
      PK: `COURSE#${courseId}`,
      SK: 'EXAM#META',
      etype: 'EXAM',
      mode: meta.mode || 'final',
      timeLimitMinutes: Number(meta.timeLimitMinutes || 0),
      totalQuestions: items.length,
      title: meta.title || 'Examen final',
      createdAt: new Date().toISOString(),
    }
  }));

  // Preguntas en batch
  const puts = items.map((q, i) => ({
    PutRequest: {
      Item: {
        PK: `COURSE#${courseId}`,
        SK: `EXAM#Q#${String(i + 1).padStart(3, '0')}#${q.id || `q${i + 1}`}`,
        etype: 'EXAM_Q',
        position: Number(q.position || i + 1),
        prompt: q.prompt,
        options: q.options,
      }
    }
  }));

  for (let i = 0; i < puts.length; i += 25) {
    const chunk = puts.slice(i, i + 25);
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.examsTable]: chunk }
    }));
  }

  console.log('[EXAM][OUT]', JSON.stringify({ requestId, courseId, totalQuestions: items.length }));
  return { totalQuestions: items.length };
};
