// src/tasks/generate-lessons.js
import { generateLessons as aiGenerateLessons } from "../ai/index.js";
import { randomUUID } from "crypto";

/** Heurística simple para detectar UUID */
function looksUUID(s) {
  return typeof s === "string" && s.includes("-") && s.length >= 32;
}

/** Construye esqueleto: 2 lecciones por módulo, usando moduleId UUID y ids UUID para lessons */
function buildLessonSkeleton(modules, moduleIdMap) {
  const out = [];
  let order = 1;

  for (const m of Array.isArray(modules) ? modules : []) {
    const oldMid = m.id;                       // p.ej. "m_1"
    const uuidMid = moduleIdMap?.[oldMid] || oldMid; // UUID pasado por PersistModules

    out.push({
      id: randomUUID(),
      moduleId: uuidMid,
      title: `Introducción: ${m.title}`,
      durationMinutes: 10,
      order: order++,
    });

    out.push({
      id: randomUUID(),
      moduleId: uuidMid,
      title: `Práctica: ${m.title}`,
      durationMinutes: 12,
      order: order++,
    });
  }
  return out;
}

export const handler = async (event) => {
  // outline puede venir en $.outline o $.outline.outline según el orquestador
  const outline = event?.outline?.outline || event?.outline || {};
  const modules = outline?.modules || [];

  // mapping que devuelve PersistModules: { "m_1": "<uuid>", ... }
  const moduleIdMap = event?.persistModules?.moduleIdMap || {};

  // Si el outline ya trae lessons, respétalas PERO normaliza a UUID
  const pre = outline?.lessons?.items || outline?.lessons || [];
  let baseLessons = [];
  if (Array.isArray(pre) && pre.length > 0) {
    baseLessons = pre.map((l, i) => {
      const coercedMid = moduleIdMap?.[l.moduleId] || l.moduleId;
      return {
        id: looksUUID(l.id) ? l.id : randomUUID(),
        moduleId: coercedMid,
        title: l.title || `Lección ${i + 1}`,
        durationMinutes: Number(l.durationMinutes ?? 10),
        order: Number(l.order ?? i + 1),
      };
    });
  } else {
    // Esqueleto 2 por módulo con UUIDs
    baseLessons = buildLessonSkeleton(modules, moduleIdMap);
  }

  // Armamos el payload para IA con módulos ya mapeados a UUID
  const course = {
    ...outline?.course,
    modules: modules.map((m) => ({
      ...m,
      id: moduleIdMap?.[m.id] || m.id, // forzamos UUID en moduleId dentro del prompt
    })),
    lessons: baseLessons,
  };

  // 1) Llamada a IA
  let aiJson;
  try {
    aiJson = await aiGenerateLessons({ course });
  } catch (e) {
    console.error("[LESSONS][gen][ERR-IA]", e);
    aiJson = null;
  }

  // 2) Normalizamos posibles formas
  const aiItems = aiJson?.lessons?.items || aiJson?.lessons || [];
  let items = Array.isArray(aiItems) ? aiItems : [];

  // 3) Si IA devuelve vacío, fallback con baseLessons
  if (items.length === 0) {
    console.warn("[LESSONS][gen] IA devolvió vacío; aplicando Fallback.");
    items = baseLessons.map((l) => ({
      ...l,
      contentMD: `# ${l.title}\n\nContenido en preparación.`,
      tips: [],
      miniChallenge: null,
    }));
  }

  // 4) Normalización final: forzar UUID de lesson.id y moduleId en UUID
  const normalized = items.map((l, idx) => {
    // Corrige moduleId si IA devolvió "m_#"
    const oldMid = l.moduleId;
    const coercedModuleId = moduleIdMap?.[oldMid] || oldMid;

    // Asegura UUID de lesson.id
    const finalId = looksUUID(l.id) ? l.id : randomUUID();

    return {
      id: finalId,
      moduleId: coercedModuleId,
      title: l.title || `Lección ${idx + 1}`,
      durationMinutes: Number(l.durationMinutes ?? 10),
      order: Number(l.order ?? idx + 1),
      contentMD: l.contentMD ?? "",
      summary: l.summary ?? null,
      tips: Array.isArray(l.tips) ? l.tips : [],
      miniChallenge: l.miniChallenge ?? null,
    };
  });

  console.log("[LESSONS][gen] total:", normalized.length);
  // Devolvemos ya con IDs en UUID para que PersistLessons/grupo siguiente lo guarde tal cual
  return { lessons: { items: normalized } };
};
