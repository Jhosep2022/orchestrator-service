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
  evt?.outline?.outline?.course?.id ?? // <- orquestadores que anidan outline
  null;

const pickExamBlock = (evt) => {
  // Soporta { exam: { items, meta, answerSheet } } y { exam: { exam: ... } }
  if (evt?.exam?.items || evt?.exam?.meta || evt?.exam?.answerSheet) return evt.exam;
  if (evt?.exam?.exam) return evt.exam.exam;
  return { items: [], meta: {}, answerSheet: [] };
};

const CHUNK = 25;
const pad = (n, size) => String(n).padStart(size, '0');

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

export const handler = async (event = {}) => {
  const requestId = event.requestId || 'no-request-id';
  const courseId  = pickCourseId(event);
  const examBlock = pickExamBlock(event);

  const itemsRaw = Array.isArray(examBlock.items) ? examBlock.items : [];
  const meta      = examBlock.meta || {};
  const nowISO    = new Date().toISOString();

  if (!env.examsTable) {
    console.error('[EXAM][ERR] Missing env.examsTable', {
      requestId,
      envExams: env?.examsTable,
      RAW: process.env.EXAMS_TABLE_NAME
    });
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

  // Normalización mínima por si algún paso anterior vino incompleto:
  const items = itemsRaw.map((q, i) => {
    const position = Number(q.position ?? (i + 1));
    const options  = Array.isArray(q.options) ? q.options : [];
    // Si no viene answerKeys, derivar desde options.isCorrect
    const derivedKeys = options.filter(o => !!o?.isCorrect).map(o => o?.key).filter(Boolean);
    const answerKeys  = asArray(q.answerKeys).length ? asArray(q.answerKeys) : derivedKeys;

    return {
      id: q.id || `q${i + 1}`,
      position,
      prompt: q.prompt || q.question || '',
      options,
      answerKeys
    };
  });

  console.log('[EXAM][IN]', JSON.stringify({
    requestId,
    courseId,
    table: env.examsTable,
    totalItems: items.length,
    metaKeys: Object.keys(meta || {})
  }));

  // 1) Upsert META del examen
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
      createdAt: nowISO,
      updatedAt: nowISO
    }
  }));

  // 2) Preguntas en batch (incluye answerKeys por pregunta)
  const puts = items.map((q, i) => ({
    PutRequest: {
      Item: {
        PK: `COURSE#${courseId}`,
        SK: `EXAM#Q#${pad(i + 1, 3)}#${q.id}`,
        etype: 'EXAM_Q',
        position: Number(q.position || i + 1),
        prompt: q.prompt,
        options: q.options,           // [{ key, label, isCorrect, feedback }]
        answerKeys: asArray(q.answerKeys), // ["A","C"]
        createdAt: nowISO,
        updatedAt: nowISO
      }
    }
  }));

  for (let i = 0; i < puts.length; i += CHUNK) {
    const chunk = puts.slice(i, i + CHUNK);
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.examsTable]: chunk }
    }));
  }

  // 3) Hoja de respuestas consolidada (útil para calificar rápido)
  const sheetFromEvent = Array.isArray(examBlock.answerSheet) ? examBlock.answerSheet : [];
  const answerSheet = sheetFromEvent.length
    ? sheetFromEvent.map(x => ({ id: x.id, answerKeys: asArray(x.answerKeys) }))
    : items.map(q => ({ id: q.id, answerKeys: asArray(q.answerKeys) }));

  await doc.send(new PutCommand({
    TableName: env.examsTable,
    Item: {
      PK: `COURSE#${courseId}`,
      SK: 'EXAM#ANSWERS',
      etype: 'EXAM_ANSWER_SHEET',
      answers: answerSheet,   // [{ id: 'q1-uuid', answerKeys: ['B'] }, ...]
      updatedAt: nowISO
    }
  }));

  console.log('[EXAM][OUT]', JSON.stringify({
    requestId,
    courseId,
    totalQuestions: items.length
  }));

  return { totalQuestions: items.length };
};
