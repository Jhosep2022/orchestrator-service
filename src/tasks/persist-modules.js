import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';
import { randomUUID } from 'crypto';

function resolveOutline(evt) {
  const o1 = evt?.outline;
  if (!o1) return { course: null, modules: [] };
  if (o1.course && o1.modules) return o1;
  if (o1.outline && (o1.outline.course || o1.outline.modules)) return o1.outline;
  return { course: null, modules: [] };
}

export const handler = async (event) => {
  console.log('[PERSIST_MODULES][IN] keys:', Object.keys(event || {}));
  const { course, modules } = resolveOutline(event);
  if (!course?.id) {
    console.error('[PERSIST_MODULES][ERR] Missing course.id', { gotCourse: course });
    throw new Error('MISSING_COURSE_ID');
  }

  const courseId = course.id;
  const list = Array.isArray(modules) ? modules : [];
  if (list.length === 0) return { totalModules: 0, moduleIdMap: {} };

  // Asignamos UUID nuevos a cada módulo y construimos el mapping antiguo->uuid
  const moduleIdMap = {};
  const now = new Date().toISOString();

  const puts = list.map((m, idx) => {
    const oldId = m.id;                        // ej: "m_1"
    const newId = randomUUID();                // UUID real para DB
    const position = Number(m.position ?? (idx + 1));

    moduleIdMap[oldId] = newId;

    return {
      PutRequest: {
        Item: {
          PK: `COURSE#${courseId}`,
          SK: `MODULE#${position}#${newId}`,
          etype: 'MODULE',
          moduleId: newId,
          position,
          title: m.title,
          summary: m.summary ?? null,
          estimatedMinutes: m.estimatedMinutes ?? null,
          lessonsCount: m.lessonsCount ?? 0,
          createdAt: now,
          updatedAt: now
        }
      }
    };
  });

  for (let i = 0; i < puts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.modulesTable]: puts.slice(i, i + 25) }
    }));
  }

  console.log('[PERSIST_MODULES][OUT] totalModules:', list.length);
  // 👇 devolvemos el mapping para que lo usen las siguientes tasks
  return { totalModules: list.length, moduleIdMap };
};
