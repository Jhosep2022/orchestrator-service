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
/** log(ctx, level, tag, data) -> usa console[level] con contexto seguro */
function log(ctx = {}, level = "log", tag = "LOG", data = {}) {
  const rid = ctx.requestId || ctx.rid || ctx.reqId || null;
  const payload = { tag, ...(rid ? { requestId: rid } : {}), ...data };
  const fn = (console[level] || console.log).bind(console);
  try { fn(`[AI] ${tag}`, payload); } catch { try { fn(`[AI] ${tag} ${safeStringify(payload)}`); } catch {} }
}

/* =========================
   Utilidades JSON comunes
   ========================= */
/** Convierte [{role, content}] a systemInstruction + prompt lineal */
function flattenMessages(messages) {
  const sys = messages.find(m => m.role === "system")?.content || null;
  const user = messages
    .filter(m => m.role !== "system")
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  return { sys, user };
}

async function chatGemini(messages, { maxTokens = 2200 } = {}) {
  if (!env.googleApiKey) throw new Error("Missing GOOGLE_API_KEY");
  const genAI = new GoogleGenerativeAI(env.googleApiKey);
  const { sys, user } = flattenMessages(messages);

  const model = genAI.getGenerativeModel({
    model: env.geminiModelId || "gemini-2.5-flash-lite",
    ...(sys ? { systemInstruction: sys } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json"
    }
  });

  const r = await model.generateContent(user || "");
  const text = r?.response?.text?.() ?? "";
  return text;
}

function stripCodeFences(s = "") {
  // quita ```json ... ``` o ``` ... ```
  return s.replace(/```json\s*([\s\S]*?)```/gi, "$1").replace(/```\s*([\s\S]*?)```/g, "$1");
}

function dropAfterLastBrace(s = "") {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return s;
  return s.slice(start, end + 1);
}

function removeTrailingCommas(s = "") {
  // elimina comas colgantes en objetos y arrays: {...,} o [...,]
  return s.replace(/,\s*([}\]])/g, "$1");
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {}
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  const fixed = text
    .replace(/(\s"label")\s+"([^"]+)"/g, '$1: "$2"')
    .replace(/(\s"id")\s+"([^"]+)"/g, '$1: "$2"')
    .replace(/(\s"prompt")\s+"([^"]+)"/g, '$1: "$2"')
    .replace(/(\s"title")\s+"([^"]+)"/g, '$1: "$2"');
  return JSON.parse(fixed);
}

/* =========================
   Generación de Outline
   ========================= */
export async function generateOutline({ topic, level = "beginner", tags = [] }) {
  const sys = "Eres un generador de planes de curso. Devuelve SOLO JSON válido.";
  const user = `Tema: ${topic}\nNivel: ${level}\nEtiquetas: ${tags.join(", ")}

Estructura JSON:
{
  "course": { "id": "c_<algo>", "title": "<titulo>", "level": "<beginner|intermediate|advanced>", "tags": [] },
  "modules": [
    { "id": "m_1", "title": "...", "lessons": [ { "id": "l_1", "title": "...", "durationMinutes": 10 } ] }
  ]
}`;
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 1500 }
  );
  return JSON.parse(text);
}

/* =========================
   Generación de Lecciones
   ========================= */
export async function generateLessons({ course }) {
  const sys = "Eres un generador de contenido de lecciones para un e-learning de PROGRAMACIÓN. Devuelve SOLO JSON válido (sin fences).";

  const user = `Genera para CADA lección en course.lessons un objeto con:
  - id, moduleId, order (idénticos a entrada)
  - title (mejorado si viene genérico)
  - durationMinutes (8–15 según título)
  - summary (2–3 oraciones; 140–300 caracteres; sin saltos de línea; NO placeholders)
  - contentMD (Markdown con SECCIONES obligatorias: 
      ## Objetivos (bullets)
      ## Conceptos clave (bullets)
      ## Ejemplo (al menos un bloque de código con triple fence \`\`\` ... \`\`\`)
      ## Mini-ejercicio (1–2 líneas orientadas a práctica)
    )
  - tips (2–4 bullets prácticos, concretos para distintos lenguajes de programación)
  - miniChallenge (reto breve, 1–2 líneas, distinto al mini-ejercicio)

  RESTRICCIONES ESTRICTAS:
  - Tema: Programación en distintos lenguajes de programacion.
  - Prohibido texto placebo como "Contenido en preparación", "por definir", etc.
  - contentMD debe tener >= 400 caracteres y al menos un bloque \`\`\`.
  - JSON puro, sin comentarios ni fences.

  SALIDA (estructura EXACTA):
  {
    "lessons": {
      "items": [
        {
          "id": "l_1",
          "moduleId": "m_1",
          "title": "string",
          "durationMinutes": 12,
          "order": 1,
          "summary": "string (2-3 oraciones, 140-300 caracteres)",
          "contentMD": "markdown con secciones y código",
          "tips": ["...", "..."],
          "miniChallenge": "..."
        }
      ]
    }
  }

  INPUT course (recortado a 6k):
  ${JSON.stringify(course).slice(0, 6000)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 3000 }
  );

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("AI_JSON_PARSE_ERROR");
  }
  return json;
}

/* =========================
   PARSER para EXAM (robusto)
   ========================= */
function safeJsonParseExam(text, ctx = {}) {
  const raw = String(text ?? "");
  log(ctx, "log", "EXAM_RAW", { len: raw.length, head: head(raw), tail: tail(raw) });

  // Helpers locales de limpieza
  const stripFences = (s = "") =>
    s.replace(/```json\s*([\s\S]*?)```/gi, "$1")
     .replace(/```\s*([\s\S]*?)```/g, "$1");
  const removeInvisible = (s = "") =>
    s.replace(/^\uFEFF/, "")
     .replace(/\u200B|\u200C|\u200D/g, "")
     .replace(/\u2028|\u2029/g, " ");
  const removeTrailing = (s = "") => s.replace(/,\s*([}\]])/g, "$1");
  const sliceOuterObject = (s = "") => {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a === -1 || b === -1 || b <= a) return s;
    return s.slice(a, b + 1);
  };
  const count = (s, re) => (s.match(re) || []).length;

  // Limpiezas iniciales
  let t = sliceOuterObject(removeInvisible(stripFences(raw)));
  let ob = count(t, /{/g), cb = count(t, /}/g), oB = count(t, /\[/g), cB = count(t, /]/g);

  // Primer reintento simple
  if (ob !== cb || oB !== cB) {
    t = removeTrailing(sliceOuterObject(t));
    ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
  }

  // Extracción por patrón si sigue desbalanceado
  if (ob !== cb || oB !== cB) {
    const reExamBlock = /\{\s*"exam"\s*:\s*\{\s*[\s\S]*?"questions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}\s*\}/i;
    const m = raw.match(reExamBlock);
    if (m && m[0]) {
      t = removeTrailing(m[0]);
      ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
    }
  }

  // --- NUEVO: Curación si sigue desbalanceado (probable truncación al final)
  if (ob !== cb || oB !== cB) {
    // Si el último char termina en coma, quítala
    t = t.replace(/,\s*$/g, "");

    // Cierra arreglos primero, luego objetos
    const needCloseBrackets = Math.max(0, oB - cB); // arrays
    const needCloseBraces   = Math.max(0, ob - cb); // objetos

    if (needCloseBrackets > 0 || needCloseBraces > 0) {
      const closeBrackets = "]".repeat(needCloseBrackets);
      const closeBraces   = "}".repeat(needCloseBraces);
      t = removeTrailing(t) + closeBrackets + closeBraces;

      // Recontar
      ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
    }
  }

  if (ob !== cb || oB !== cB) {
    log(ctx, "error", "EXAM_UNBALANCED", { ob, cb, oB, cB, head: head(t), tail: tail(t) });
    throw new Error("AI_JSON_UNBALANCED");
  }

  // Parse directo + retry sin comas colgantes
  try {
    const parsed = JSON.parse(t);
    return parsed;
  } catch {
    try {
      const parsed = JSON.parse(removeTrailing(t));
      return parsed;
    } catch (e2) {
      log(ctx, "error", "EXAM_PARSE_FAIL", { sampleHead: head(t, 800), msg: e2?.message });
      throw new Error("AI_JSON_PARSE_ERROR");
    }
  }
}

/** Normaliza una pregunta: asegura keys A–D, arrays, y deriva answerKeys si faltan. */
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
  const answerKeys =
    Array.isArray(q?.answerKeys) && q.answerKeys.length ? q.answerKeys : derived;

  return {
    id: String(q?.id ?? `q${idx + 1}`),
    position: pos,
    prompt,
    options,
    answerKeys
  };
}

/* =========================
   Generación de EXAM
   ========================= */
export async function generateExam({ course, ctx = {} }) {
  const sys = "Eres un generador de exámenes. Devuelve SOLO JSON válido.";
  const user = `Genera un examen final de 8–10 preguntas multiopción (A–D) relacionado al curso.
  FORMATO ESTRICTO (sin texto fuera del JSON):
  {
    "exam": {
      "id": "ex_1",
      "title": "Examen final",
      "mode": "final",
      "timeLimitMinutes": 0,
      "questions": [
        {
          "id": "q1",
          "position": 1,
          "prompt": "string",
          "options": [
            { "key": "A", "label": "string", "isCorrect": false, "feedback": "frase corta (<= 16 palabras)" },
            { "key": "B", "label": "string", "isCorrect": false, "feedback": "frase corta (<= 16 palabras)" },
            { "key": "C", "label": "string", "isCorrect": true,  "feedback": "frase corta (<= 16 palabras)" },
            { "key": "D", "label": "string", "isCorrect": false, "feedback": "frase corta (<= 16 palabras)" }
          ],
          "answerKeys": ["C"]
        }
      ],
      "answerSheet": [
        { "id": "q1", "answerKeys": ["C"] }
      ]
    }
  }

  Reglas:
  - Usa solo las claves: id,title,mode,timeLimitMinutes,questions,position,prompt,options,key,label,isCorrect,feedback,answerKeys,answerSheet.
  - NO incluyas nada fuera del JSON. No fences. No comentarios.
  - Limita cada "feedback" a una frase corta (máx. ~16 palabras) para reducir tamaño.
  - Español neutro, temática del curso.

  Contexto (recortado):
  ${JSON.stringify(course).slice(0, 3500)}`;

  // Subimos el tope para mitigar truncados; ajusta según tu modelo/costo.
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 3000 }
  );

  const json = safeJsonParseExam(text, ctx);
  log(ctx, "log", "EXAM_JSON_OK", { questions: json?.exam?.questions?.length ?? 0 });
  return json;
}

/* =========================
   Generación de Recursos
   ========================= */
export async function generateResources({ course }) {
  const sys = "Eres un generador de recursos complementarios. que busca referencias en la web. Devuelve SOLO JSON válido.";
  const user = `Genera recursos variados (article|practice|video|cheatsheet) para el curso tienes que buscarlo en la web no quiero inventados.
DEVUELVE ESTE FORMATO ESTRICTO (sin comentarios, sin claves extra, sin fences):
{
  "resources": {
    "items": [
      {
        "slug": "kebab-case-unico",
        "title": "string",
        "resourceType": "article|practice|video|cheatsheet",
        "durationMinutes": 5,
        "description": "string",
        "overview": "string|null",
        "actionLabel": "string",
        "actionUrl": "https://...|null",
        "tags": ["..."],
        "lessonId": "l_1|null"
      }
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
