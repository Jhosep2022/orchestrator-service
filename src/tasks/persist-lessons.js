// src/tasks/persist-lessons.js (fragmento inicial)
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

  // 👇 NUEVO: soporta los 3 casos
  const rawLessons =
    event?.lessons?.items ||
    event?.lessons?.lessons?.items ||
    event?.lessons ||
    [];
  const list = Array.isArray(rawLessons) ? rawLessons : [];
  const mods = Array.isArray(modules) ? modules : [];

  const posByModule = new Map(mods.map((m, i) => [m.id, m.position ?? (i + 1)]));

  const puts = list.map((l) => {
    const mpos = posByModule.get(l.moduleId) || 0;
    return {
      PutRequest: {
        Item: {
          PK: `MODULE#${l.moduleId}`,
          SK: `LESSON#${l.order}#${l.id}`,
          etype: 'LESSON',
          courseId,
          moduleId: l.moduleId,
          lessonId: l.id,
          title: l.title,
          durationMinutes: Number(l.durationMinutes ?? 10),
          order: Number(l.order ?? 0),
          contentMD: l.contentMD ?? '',
          summary: l.summary ?? null,
          GSI1PK: `COURSE#${courseId}`,
          GSI1SK: `M#${String(mpos).padStart(4,'0')}#L#${String(l.order ?? 0).padStart(4,'0')}#${l.id}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    };
  });

  for (let i = 0; i < puts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.lessonsTable]: puts.slice(i, i + 25) }
    }));
  }

  return { totalLessons: list.length };
};
