// src/tasks/persist-lessons.js
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

const CHUNK = 25;
const pad = (n, size) => String(n).padStart(size, '0');

// 🔧 Fallback seguro para summary (2 oraciones o hasta 300 chars)
function shortSummaryFallback(md = '') {
  const txt = String(md).replace(/\s+/g, ' ').trim();
  if (!txt) return null;
  // Intenta capturar 2 oraciones
  const m = txt.match(/^(.+?\.)\s+(.+?\.)/);
  const s = (m ? m[0] : txt.slice(0, 220)).slice(0, 300);
  return s;
}

function resolveOutline(evt) {
  const o1 = evt?.outline;
  if (!o1) return { course: null, modules: [] };
  if (o1.course || o1.modules) return o1;
  if (o1.outline && (o1.outline.course || o1.outline.modules)) return o1.outline;
  return { course: null, modules: [] };
}

function pickLessonsArray(evt) {
  const l1 = evt?.lessons?.lessons?.items;
  if (Array.isArray(l1) && l1.length) return l1;
  const l2 = evt?.lessons?.items;
  if (Array.isArray(l2) && l2.length) return l2;
  const l3 = evt?.lessons;
  if (Array.isArray(l3) && l3.length) return l3;
  return [];
}

export const handler = async (event) => {
  const requestId = event?.requestId || 'no-request-id';

  // ✅ Resuelve nombre de tabla con alias y fallbacks
  const lessonsTable =
    env.lessonsTable ||
    env.lessonsTableName ||
    process.env.LESSONS_TABLE_NAME ||
    env.tableName ||
    process.env.TABLE_NAME;

  const { course, modules } = resolveOutline(event);
  const courseId =
    course?.id ||
    event?.outline?.course?.id ||
    event?.payload?.draftCourseId;

  const finalLessons = pickLessonsArray(event);
  const moduleIdMap = event?.persistModules?.moduleIdMap || {}; // { m_1: <uuid>, ... }

  if (!lessonsTable) {
    console.error('[LESSONS][ERR] Missing lessonsTable', { requestId, env });
    throw new Error('MISSING_LESSONS_TABLE');
  }
  if (!courseId) {
    console.error('[LESSONS][ERR] Missing courseId', { requestId });
    throw new Error('MISSING_COURSE_ID');
  }
  if (!Array.isArray(finalLessons) || finalLessons.length === 0) {
    console.warn('[LESSONS][WARN] No lessons to persist', { requestId });
    return { ok: true, persisted: 0, courseId };
  }

  // Mapa: UUID de módulo -> position (usa IDs del outline, que ya deberían ser UUID aquí)
  const modulePosById = new Map(
    (modules || []).map(m => [m.id, Number(m.position) || 0])
  );

  const nowISO = new Date().toISOString();
  const normalized = finalLessons.map((L, idx) => {
    const oldModuleId = L.moduleId;                      // p.ej. "m_3"
    const realModuleId = moduleIdMap[oldModuleId] || oldModuleId; // UUID resuelto
    const lessonId = L.lessonId || L.id;
    const order = Number(L.order ?? (idx + 1));

    // ✅ Usa el UUID real para resolver la posición del módulo
    const modulePos = Number(modulePosById.get(realModuleId) || 0);

    // ✅ Summary robusto: usa IA si viene bien; si no, deriva de contentMD
    const summary =
      (L.summary && String(L.summary).trim().length >= 60)
        ? String(L.summary).trim().slice(0, 300)
        : shortSummaryFallback(L.contentMD || '');

    if (!realModuleId) {
      console.error('[LESSONS][ERR] Missing realModuleId', { requestId, oldModuleId, lessonId, title: L?.title });
      throw new Error('MISSING_REAL_MODULE_ID');
    }
    if (!lessonId) {
      console.error('[LESSONS][ERR] Missing lessonId', { requestId, L });
      throw new Error('MISSING_LESSON_ID');
    }

    return {
      // Clave principal por módulo
      PK: `MODULE#${realModuleId}`,
      SK: `LESSON#${pad(order, 4)}#${lessonId}`,

      etype: 'LESSON',

      // GSI para consultar por curso ordenado por módulo + orden de lección
      GSI1PK: `COURSE#${courseId}`,
      GSI1SK: `M#${pad(modulePos, 5)}#L#${pad(order, 5)}#${lessonId}`,

      // Datos
      courseId,
      moduleId: realModuleId,
      lessonId,
      title: L.title,
      order,
      durationMinutes: Number(L.durationMinutes ?? 0) || null,
      contentMD: L.contentMD ?? '',
      contentUrl: L.contentUrl ?? '',
      summary: summary ?? null,
      tips: Array.isArray(L.tips) ? L.tips : [],
      miniChallenge: L.miniChallenge ?? null,

      createdAt: nowISO,
      updatedAt: nowISO,
    };
  });

  // Batch write (25)
  const chunks = [];
  for (let i = 0; i < normalized.length; i += CHUNK) {
    chunks.push(normalized.slice(i, i + CHUNK));
  }

  let total = 0;
  for (const batch of chunks) {
    const cmd = new BatchWriteCommand({
      RequestItems: {
        [lessonsTable]: batch.map(Item => ({ PutRequest: { Item } })),
      },
    });

    const res = await doc.send(cmd);
    const unprocessed = res?.UnprocessedItems?.[lessonsTable]?.length || 0;
    total += (batch.length - unprocessed);

    if (unprocessed > 0) {
      console.warn('[LESSONS][WARN] UnprocessedItems', { requestId, unprocessed });
    }
  }

  console.info('[LESSONS][OK] Persisted lessons', {
    requestId, courseId, total, table: lessonsTable,
  });

  return { ok: true, persisted: total, courseId };
};
