// src/tasks/persist-lessons.js
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

function resolveOutline(evt) {
  const o1 = evt?.outline;
  if (!o1) return { course: null, modules: [] };
  if (o1.course || o1.modules) return o1;
  if (o1.outline && (o1.outline.course || o1.outline.modules)) return o1.outline;
  return { course: null, modules: [] };
}

export const handler = async (event) => {
  const { course, modules } = resolveOutline(event);
  if (!course?.id) throw new Error('MISSING_COURSE_ID');
  const courseId = course.id;

  let rawLessons =
    event?.lessons?.items ||
    event?.lessons?.lessons?.items ||
    (Array.isArray(event?.lessons) ? event.lessons : []) ||
    [];

  const list = Array.isArray(rawLessons) ? rawLessons : [];
  const mods = Array.isArray(modules) ? modules : [];

  // Posición por módulo (para ordenar GSI)
  const posByModule = new Map(mods.map((m, i) => [m.id, m.position ?? (i + 1)]));

  // Si falta "order" en una lección, lo autoincrementamos por módulo
  const orderByModule = Object.create(null);

  const puts = list.map((l, idx) => {
    const moduleId = l.moduleId || 'm_?';

    // order calculado si no viene
    if (!orderByModule[moduleId]) orderByModule[moduleId] = 0;
    const order = Number.isFinite(l.order) ? l.order : ++orderByModule[moduleId];

    const orderPadded = String(order).padStart(3, '0');
    const mpos = posByModule.get(moduleId) || 0;
    const mposPadded = String(mpos).padStart(2, '0');

    const lessonId = l.id || `auto_${idx + 1}`;

    return {
      PutRequest: {
        Item: {
          PK: `MODULE#${moduleId}`,
          SK: `LESSON#${orderPadded}#${lessonId}`,
          etype: 'LESSON',

          courseId,
          moduleId,
          lessonId,
          title: l.title ?? '',
          durationMinutes: l.durationMinutes ?? 10,
          order,
          contentMD: l.contentMD ?? '',
          summary: l.summary ?? null,
          tips: Array.isArray(l.tips) ? l.tips : [],
          miniChallenge: l.miniChallenge ?? null,
          createdAt: new Date().toISOString(),

          // GSI por curso -> módulo -> lección
          GSI1PK: `COURSE#${courseId}`,
          GSI1SK: `M#${mposPadded}#L#${orderPadded}#${lessonId}`,
        }
      }
    };
  });

  for (let i = 0; i < puts.length; i += 25) {
    const chunk = puts.slice(i, i + 25);
    if (chunk.length === 0) break;
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.lessonsTable]: chunk }
    }));
  }

  return { totalLessons: list.length };
};
