// src/tasks/generate-lessons.js
import { generateLessons as aiGenerateLessons } from "../ai/index.js";

/** De modules + (opcional) lessons predefinidas armamos un esqueleto mínimo */
function buildLessonSkeleton(outline) {
  const mods = Array.isArray(outline?.modules) ? outline.modules : [];
  const pre  = outline?.lessons?.items || outline?.lessons || [];

  // Si ya vienen lessons en outline, respétalas
  if (Array.isArray(pre) && pre.length > 0) return pre.map((l, i) => ({
    id: l.id || `l_${i + 1}`,
    moduleId: l.moduleId,
    title: l.title || `Lección ${i + 1}`,
    durationMinutes: Number(l.durationMinutes ?? 10),
    order: Number(l.order ?? i + 1)
  }));

  // Si no, construimos 2 por módulo como placeholder
  const out = [];
  let order = 1;
  for (const m of mods) {
    out.push({
      id: `l_${order}`, moduleId: m.id, title: `Introducción: ${m.title}`,
      durationMinutes: 10, order: order++
    });
    out.push({
      id: `l_${order}`, moduleId: m.id, title: `Práctica: ${m.title}`,
      durationMinutes: 12, order: order++
    });
  }
  return out;
}

export const handler = async (event) => {
  const outline = event?.outline?.outline || event?.outline || {};
  const course  = {
    ...outline?.course,
    modules: outline?.modules || [],
    // pasamos un esqueleto para que la IA sepa “cuántas” y “cuáles”
    lessons: buildLessonSkeleton(outline)
  };

  // 1) Pedimos a la IA con wrapper { lessons: { items: [...] } }
  let aiJson;
  try {
    aiJson = await aiGenerateLessons({ course });
  } catch (e) {
    console.error('[LESSONS][gen][ERR-IA]', e);
    aiJson = null;
  }

  // 2) Normalizamos posibles formas
  const aiItems =
    aiJson?.lessons?.items ||
    aiJson?.lessons ||
    [];

  // 3) Validación dura: si viene vacío, hacemos fallback con el esqueleto
  let items = Array.isArray(aiItems) ? aiItems : [];
  if (items.length === 0) {
    console.warn('[LESSONS][gen] IA devolvió vacío; aplicando Fallback.');
    items = course.lessons.map((l) => ({
      id: l.id,
      moduleId: l.moduleId,
      title: l.title,
      durationMinutes: Number(l.durationMinutes ?? 10),
      order: Number(l.order ?? 1),
      contentMD: `# ${l.title}\n\nContenido en preparación.`,
      tips: [],
      miniChallenge: null
    }));
  }

  // 4) Saneamos tipos/campos finales
  const normalized = items.map((l, idx) => ({
    id: l.id || `l_${idx + 1}`,
    moduleId: l.moduleId,
    title: l.title || `Lección ${idx + 1}`,
    durationMinutes: Number(l.durationMinutes ?? 10),
    order: Number(l.order ?? idx + 1),
    contentMD: l.contentMD ?? '',
    summary: l.summary ?? null,
    tips: Array.isArray(l.tips) ? l.tips : [],
    miniChallenge: l.miniChallenge ?? null
  }));

  console.log('[LESSONS][gen] total:', normalized.length);
  return { lessons: { items: normalized } };
};
