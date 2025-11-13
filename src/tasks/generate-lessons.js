// src/tasks/generate-lessons.js
import { generateLessons as aiGenerateLessons } from "../ai/index.js";
import { randomUUID } from "crypto";

/** Heurística simple para detectar UUID */
function looksUUID(s) {
  return typeof s === "string" && s.includes("-") && s.length >= 32;
}


function buildFallbackContentMD(title = "Lección") {
  const topic = title.replace(/^Práctica:\s*/i, "").trim();
  return [
    `# ${title}`,
    "",
    "## Objetivos",
    "- Comprender el concepto aplicado en Kotlin.",
    "- Implementar un ejemplo simple y ejecutable.",
    "- Practicar con un ejercicio breve.",
    "",
    "## Conceptos clave",
    "- Sintaxis de Kotlin relacionada con el tema.",
    "- Clases, funciones y propiedades pertinentes.",
    "- Buenas prácticas y manejo de errores comunes.",
    "",
    "## Ejemplo",
    "```kotlin",
    "data class Usuario(val nombre: String, val edad: Int)",
    "",
    "fun saludar(u: Usuario): String {",
    '    return "Hola ${u.nombre}, tienes ${u.edad} años"',
    "}",
    "",
    "fun main() {",
    '    val u = Usuario("Ana", 28)',
    "    println(saludar(u))",
    "}",
    "```",
    "",
    "## Mini-ejercicio",
    `- Crea una función relacionada con “${topic}” que reciba parámetros y retorne un resultado; luego imprime el resultado en main().`,
  ].join("\n");
}

function ensureLessonFilled(l, idx = 0) {
  const content = String(l.contentMD || "").trim();
  const title = (l.title || `Lección ${idx + 1}`).trim();

  // Requisitos mínimos: contenido con bloque ```kotlin y longitud razonable
  const hasKotlinBlock = /```kotlin/.test(content);
  const enoughLength = content.length >= 200;
  const contentMD = hasKotlinBlock && enoughLength ? content : buildFallbackContentMD(title);

  const summaryOk = typeof l.summary === "string" && l.summary.trim().length >= 60;
  const summary = summaryOk
    ? l.summary.trim().slice(0, 300)
    : `En esta lección sobre ${title} revisamos conceptos clave y un ejemplo práctico en Kotlin. El objetivo es comprender la idea central y aplicarla con un mini-ejercicio.`;

  const tips = Array.isArray(l.tips) && l.tips.length > 0
    ? l.tips
    : [
        "Compila y ejecuta el ejemplo tal cual para validar el flujo.",
        "Prefiere funciones pequeñas y nombres claros.",
        "Aprovecha data classes y null-safety de Kotlin.",
      ];

  const miniChallenge = l.miniChallenge || `Refactoriza el ejemplo para manejar casos límite y agrega una prueba simple.`;

  return {
    ...l,
    title,
    contentMD,
    summary,
    tips,
    miniChallenge,
  };
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
    items = baseLessons.map((l, i) => ensureLessonFilled({
      ...l,
      contentMD: "", // forzamos a construir contenido útil
      tips: [],
      miniChallenge: null,
    }, i));
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
