import { generateOutline as aiGenerateOutline } from "../ai/index.js";

export const handler = async (event) => {
  const { payload = {} } = event || {};
  const topic = payload.title || payload.topic || "Curso sin título";
  const level = payload.level || "beginner";
  const tags  = Array.isArray(payload.tags) ? payload.tags : [];

  const raw = await aiGenerateOutline({ topic, level, tags });

  // Normalización
  const course = {
    id: payload.draftCourseId, // <- mantener el draftId creado
    title: raw?.course?.title || topic,
    level: (raw?.course?.level || level).toLowerCase(),
    tags: Array.isArray(raw?.course?.tags) ? raw.course.tags : tags,
  };

  // módulos con posición
  const modules = (raw?.modules || []).map((m, idx) => ({
    id: m.id || `m_${idx + 1}`,
    title: m.title || `Módulo ${idx + 1}`,
    position: typeof m.position === "number" ? m.position : idx + 1,
    lessons: Array.isArray(m.lessons) ? m.lessons : [],
  }));

  // aplanar lecciones y numerarlas
  const items = [];
  let order = 1;
  for (const m of modules) {
    for (const l of (m.lessons || [])) {
      items.push({
        id: l.id || `l_${order}`,
        moduleId: m.id,
        title: l.title || `Lección ${order}`,
        durationMinutes: Number(l.durationMinutes || l.duration_minutes || 10),
        order: order++,
      });
    }
    // limpiamos del módulo; persist-modules no espera lessons embebidas
    delete m.lessons;
  }

  // 👇 DEVOLVEMOS con la forma que esperan los persist-*
  return {
    outline: { course, modules },
    lessons: { items }            // para que luego persist-lessons la tome directo
  };
};
