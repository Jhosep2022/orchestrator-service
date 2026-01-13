// src/ai/providers/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../core/env.js";

/* =========================
   Helpers de logging & utils
   ========================= */
function head(s = "", n = 400) {
  try { return String(s).slice(0, n); } catch { return ""; }
}
function tail(s = "", n = 400) {
  try { const t = String(s); return t.slice(Math.max(0, t.length - n)); } catch { return ""; }
}
function safeStringify(obj) {
  try { return JSON.stringify(obj); } catch { return String(obj); }
}
function log(ctx = {}, level = "log", tag = "LOG", data = {}) {
  const rid = ctx.requestId || ctx.rid || ctx.reqId || null;
  const payload = { tag, ...(rid ? { requestId: rid } : {}), ...data };
  const fn = (console[level] || console.log).bind(console);
  try { fn(`[AI] ${tag}`, payload); } catch { try { fn(`[AI] ${tag} ${safeStringify(payload)}`); } catch {} }
}

/* =========================
   Utilidades JSON comunes
   ========================= */
function flattenMessages(messages) {
  const sys = messages.find(m => m.role === "system")?.content || null;
  const user = messages
    .filter(m => m.role !== "system")
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  return { sys, user };
}

async function chatGemini(
  messages,
  { maxTokens = 2800, timeoutMs = 18000, mimeType = "application/json" } = {}
) {
  if (!env.googleApiKey) throw new Error("Missing GOOGLE_API_KEY");
  const genAI = new GoogleGenerativeAI(env.googleApiKey);
  const { sys, user } = flattenMessages(messages);

  const model = genAI.getGenerativeModel({
    model: env.geminiModelId || "gemini-2.5-flash-lite",
    ...(sys ? { systemInstruction: sys } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: mimeType,
    },
  });

  const task = model.generateContent(user || "");
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("AI_TIMEOUT")), timeoutMs)
  );

  const r = await Promise.race([task, timeout]);
  const text = r?.response?.text?.() ?? "";
  return text;
}


function removeTrailingCommas(s = "") { return s.replace(/,\s*([}\]])/g, "$1"); }
function stripFences(s = "") {
  return s.replace(/```json\s*([\s\S]*?)```/gi, "$1").replace(/```\s*([\s\S]*?)```/g, "$1");
}
function removeInvisible(s = "") {
  return s.replace(/^\uFEFF/, "")
    .replace(/\u200B|\u200C|\u200D/g, "")
    .replace(/\u2028|\u2029/g, " ");
}
function sliceOuterObject(s = "") {
  const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) return s;
  return s.slice(a, b + 1);
}

function safeJsonParseLessons(text, ctx = {}) {
  const raw = String(text ?? "");
  log(ctx, "log", "LESSONS_RAW_JSON", { len: raw.length, head: head(raw), tail: tail(raw) });

  let t = preRepairLessonsJson(raw);

  // Nos quedamos con el objeto externo principal
  t = sliceOuterObject(t);

  // Helper para balancear llaves y corchetes y parsear
  const balanceAndParse = (src) => {
    let s = src;

    const count = (str, re) => (str.match(re) || []).length;
    let ob = count(s, /{/g);
    let cb = count(s, /}/g);
    let oB = count(s, /\[/g);
    let cB = count(s, /]/g);

    // Quitar coma colgante final si existe
    s = s.replace(/,\s*$/g, "");
    s = removeTrailingCommas(s);

    // Completar cierres necesarios
    ob = count(s, /{/g);
    cb = count(s, /}/g);
    oB = count(s, /\[/g);
    cB = count(s, /]/g);

    const needCloseBrackets = Math.max(0, oB - cB);
    const needCloseBraces   = Math.max(0, ob - cb);

    if (needCloseBrackets > 0 || needCloseBraces > 0) {
      s = s + "]".repeat(needCloseBrackets) + "}".repeat(needCloseBraces);
    }

    return JSON.parse(s);
  };

  try {
    // Primer intento directo
    return JSON.parse(t);
  } catch (e1) {
    log(ctx, "error", "LESSONS_PARSE_FAIL_1", { msg: e1?.message });

    // Segundo intento: cortar la ÚLTIMA propiedad contentMD (la que suele quedar truncada)
    const marker = '"contentMD"';
    const lastIdx = t.lastIndexOf(marker);
    if (lastIdx !== -1) {
      // Buscamos la coma que viene justo antes de "contentMD"
      const commaIdx = t.lastIndexOf(",", lastIdx);
      const cutIdx = commaIdx !== -1 ? commaIdx : lastIdx;

      let trimmed = t.slice(0, cutIdx);
      try {
        const json = balanceAndParse(trimmed);
        return json;
      } catch (e2) {
        log(ctx, "error", "LESSONS_PARSE_FAIL_2", { msg: e2?.message, head: head(trimmed, 800) });
      }
    }

    // Tercer intento: recortar hasta el último '}' y balancear
    const lastBrace = t.lastIndexOf("}");
    if (lastBrace > 0) {
      const sliced = t.slice(0, lastBrace + 1);
      try {
        const json = balanceAndParse(sliced);
        return json;
      } catch (e3) {
        log(ctx, "error", "LESSONS_PARSE_FAIL_3", { msg: e3?.message, head: head(sliced, 800) });
      }
    }

    // Si nada funcionó, ya no hay mucho que salvar
    throw new Error("AI_JSON_PARSE_ERROR");
  }
}


function preRepairLessonsJson(s = "") {
  let t = String(s ?? "");

  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = removeInvisible(t);
  t = stripFences(t);

  const stringKeys = ["summary", "contentMD", "miniChallenge", "title"];
  for (const key of stringKeys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"(.*?)"`, "gs");
    t = t.replace(re, (_m, inner) => {
      const safeInner = inner.replace(/"/g, "'");
      return `"${key}":"${safeInner}"`;
    });
  }

  t = removeTrailingCommas(t);

  return t;
}


/* ========== NO TOCAR ========== */
export async function generateOutline({ topic, level = "beginner", tags = [] }) {
  const sys =
    "Eres un experto en DISENO de planes de curso de programacion. " +
    "Tu especialidad es crear esquemas claros y coherentes segun el nivel solicitado. " +
    "Devuelves SOLO JSON valido.";
  const user = `Tema: ${topic}\nNivel: ${level} (respeta estrictamente este nivel)\nEtiquetas: ${tags.join(
    ", "
  )}\n\nEstructura JSON:\n{\n  "course": { "id": "c_<algo>", "title": "<titulo>", "level": "<beginner|intermediate|advanced>", "tags": [] },\n  "modules": [\n    { "id": "m_1", "title": "...", "lessons": [ { "id": "l_1", "title": "...", "durationMinutes": 10 } ] }\n  ]\n}`;
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2000 }
  );
  return JSON.parse(text);
}

export async function generateLessons({ course }) {
  const sys = `
Eres un generador de contenido de lecciones para un e-learning de PROGRAMACIÓN.
Devuelves SOLO texto plano (no JSON).
`.trim();

  // Le pasamos a la IA las lecciones base
  const lessonsInfo = (course.lessons || []).map(l => ({
    id: l.id,
    moduleId: l.moduleId,
    title: l.title,
  }));

  const user = `
Tienes las siguientes lecciones:

${lessonsInfo.map(l => `- id=${l.id}, moduleId=${l.moduleId}, title="${l.title}"`).join("\n")}

Para CADA lección genera un bloque de Markdown con el siguiente formato EXACTO:

=== LESSON <id> START ===
# <título de la lección>
## Introducción
<1 párrafo corto explicando el tema, 2–3 oraciones>
## Conceptos clave
- punto 1
- punto 2
- punto 3
## Ejemplo
\`\`\`<lenguaje>
<ejemplo de código corto (máx. 10–12 líneas, usando solo comillas simples en los strings)>
\`\`\`
## Mini-ejercicio
- actividad breve 1
- actividad breve 2
=== LESSON <id> END ===

REGLAS:
- Usa SIEMPRE un único lenguaje principal para TODO el curso (Java, Python, JavaScript, etc.).
- Detecta el lenguaje a partir de course.title, course.tags o course.description.
- No devuelvas nada fuera de esos bloques.
- No devuelvas JSON, solo texto plano con los bloques anteriores.

course (recortado):
${JSON.stringify(course).slice(0, 4000)}
`.trim();

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2600, mimeType: "text/plain" }
  );

  console.log("[AI][LESSONS][RAW]", text.slice(0, 600));

  // Parsear bloques: === LESSON <id> START === ... === LESSON <id> END ===
  const blocksById = {};
  const re = /=== LESSON ([^=\n]+) START ===([\s\S]*?)=== LESSON \1 END ===/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const id = String(match[1]).trim();
    const body = String(match[2] || "").trim();
    blocksById[id] = body;
  }

  // Construimos JSON nosotros mismos
  const items = (course.lessons || []).map((l, idx) => ({
    id: l.id,
    moduleId: l.moduleId,
    title: l.title || `Lección ${idx + 1}`,
    durationMinutes: Number(l.durationMinutes ?? 10),
    order: Number(l.order ?? idx + 1),
    // Solo ponemos contentMD. summary/tips/miniChallenge los completa ensureLessonFilled
    contentMD: blocksById[l.id] || "",
    summary: null,
    tips: [],
    miniChallenge: null,
  }));

  return { lessons: { items } };
}



/** Correcciones sintácticas comunes ANTES del conteo/parseo. */
function preRepairExamJson(s = "") {
  let t = String(s ?? "");
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(
    /("label"|"title"|"prompt"|"feedback"|"slug"|"description"|"overview"|"actionLabel"|"actionUrl"|"key")\s+("([^"\\]|\\.)*")/g,
    '$1: $2'
  );

  t = t.replace(
    /"([A-Za-z0-9_]+)"\s+("([^"\\]|\\.)*")/g,
    '"$1": $2'
  );

  t = removeInvisible(t);
  t = removeTrailingCommas(t);

  return t;
}

function safeJsonParseExam(text, ctx = {}) {
  const raw = String(text ?? "");
  log(ctx, "log", "EXAM_RAW", { len: raw.length, head: head(raw), tail: tail(raw) });

  let t = preRepairExamJson(stripFences(raw));

  t = sliceOuterObject(t);

  const count = (str, re) => (str.match(re) || []).length;
  let ob = count(t, /{/g), cb = count(t, /}/g), oB = count(t, /\[/g), cB = count(t, /]/g);

  if (ob !== cb || oB !== cB) {
    t = removeTrailingCommas(sliceOuterObject(t));
    ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
  }

  if (ob !== cb || oB !== cB) {
    const reExamBlock = /\{\s*"exam"\s*:\s*\{\s*[\s\S]*?"questions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}\s*\}/i;
    const m = raw.match(reExamBlock);
    if (m && m[0]) {
      t = preRepairExamJson(m[0]);
      t = removeTrailingCommas(t);
      ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
    }
  }

  if (ob !== cb || oB !== cB) {
    t = t.replace(/,\s*$/g, "");
    const needCloseBrackets = Math.max(0, oB - cB);
    const needCloseBraces   = Math.max(0, ob - cb);
    if (needCloseBrackets > 0 || needCloseBraces > 0) {
      t = removeTrailingCommas(t) + "]".repeat(needCloseBrackets) + "}".repeat(needCloseBraces);
      ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
    }
  }

  if (ob !== cb || oB !== cB) {
    log(ctx, "error", "EXAM_UNBALANCED", { ob, cb, oB, cB, head: head(t), tail: tail(t) });
    throw new Error("AI_JSON_UNBALANCED");
  }

  try {
    return JSON.parse(t);
  } catch {
    try {
      const retry = preRepairExamJson(t);
      return JSON.parse(retry);
    } catch (e2) {
      log(ctx, "error", "EXAM_PARSE_FAIL", { sampleHead: head(t, 800), msg: e2?.message });
      throw new Error("AI_JSON_PARSE_ERROR");
    }
  }
}

/** Normaliza una pregunta */
function normalizeExamQuestion(q, idx) {
  const pos = Number(q?.position ?? idx + 1);
  const prompt = String(q?.prompt ?? q?.question ?? "").trim();
  const options = Array.isArray(q?.options) ? q.options.map(o => ({
    key: String(o?.key ?? "").trim(),
    label: String(o?.label ?? "").trim(),
    isCorrect: !!o?.isCorrect,
    feedback: String(o?.feedback ?? "").trim()
  })) : [];
  const derived = options.filter(o => o.isCorrect).map(o => o.key).filter(Boolean);
  const answerKeys = Array.isArray(q?.answerKeys) && q.answerKeys.length ? q?.answerKeys : derived;
  return { id: String(q?.id ?? `q${idx + 1}`), position: pos, prompt, options, answerKeys };
}

export async function generateExam({ course, ctx = {} }) {
  const sys = "Eres un generador de exámenes. Devuelve SOLO JSON válido.";
  const user = `Genera un examen final de 6 preguntas multiopción (A–C) relacionado al curso.
  FORMATO EXACTO (nada fuera del JSON):
  {
    "exam": {
      "id": "ex_1",
      "title": "Examen final",
      "mode": "final",
      "timeLimitMinutes": 60,
      "questions": [
        {
          "id": "q1",
          "position": 1,
          "prompt": "string",
          "options": [
            { "key": "A", "label": "string sin comillas internas", "isCorrect": false, "feedback": "frase breve" },
            { "key": "B", "label": "string sin comillas internas", "isCorrect": false, "feedback": "frase breve" },
            { "key": "C", "label": "string sin comillas internas", "isCorrect": true,  "feedback": "frase breve" }
          ],
          "answerKeys": ["C"]
        }
      ],
      "answerSheet": [ { "id": "q1", "answerKeys": ["C"] } ]
    }
  }

  REGLAS:
  - Sólo claves: id,title,mode,timeLimitMinutes,questions,position,prompt,options,key,label,isCorrect,feedback,answerKeys,answerSheet.
  - NO uses comillas dentro de los valores de "label" ni "prompt" (evita \\"Integer\\" etc.).
  - Español neutro. JSON puro, sin comentarios, sin fences.

  CONTEXTO (recortado):
  ${JSON.stringify(course).slice(0, 3200)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2500 }
  );

  const json = safeJsonParseExam(text, ctx);
  log(ctx, "log", "EXAM_JSON_OK", { questions: json?.exam?.questions?.length ?? 0 });
  return json;
}

export async function generateResources({ course }) {
  const sys = "Eres un generador de recursos complementarios. que busca referencias en la web. Devuelve SOLO JSON válido.";
  const user = `Genera recursos variados (article|practice|cheatsheet) para el curso tienes que buscarlo en la web no quiero inventados.
DEVUELVE ESTE FORMATO ESTRICTO (sin comentarios, sin claves extra, sin fences):
{
  "resources": {
    "items": [
      { "slug":"kebab-case-unico","title":"string","resourceType":"article|practice|cheatsheet","durationMinutes":5,"description":"string","overview":"string|null","actionLabel":"string","actionUrl":"https://...|null","tags":["..."],"lessonId":"l_1|null" }
    ]
  }
}

Debes generar al MENOS 2 recursos, distribuyéndolos entre tipos.
Mantén consistencia con course.lessons cuando asignes lessonId.

INPUT (course):
${JSON.stringify(course).slice(0, 8000)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200 }
  );
  return JSON.parse(text);
}

export { normalizeExamQuestion };
