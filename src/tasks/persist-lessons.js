import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { doc } from '../core/ddb.js';
import { env } from '../core/env.js';

export const handler = async (event) => {
  const courseId = event.outline.course.id;
  const modules = event.outline.modules || [];
  const lessons = event.lessons.items || [];

  // Mapa móduloId -> posición (para GSI1SK)
  const posByModule = new Map(modules.map((m, i) => [m.id, i + 1]));

  const puts = lessons.map((l) => {
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
          durationMinutes: l.durationMinutes,
          order: l.order,
          contentMD: l.contentMD,
          summary: l.summary,
          // GSI por curso
          GSI1PK: `COURSE#${courseId}`,
          GSI1SK: `M#${mpos}#L#${l.order}#${l.id}`,
        }
      }
    };
  });

  for (let i = 0; i < puts.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: { [env.lessonsTable]: puts.slice(i, i + 25) }
    }));
  }

  return { totalLessons: lessons.length };
};
