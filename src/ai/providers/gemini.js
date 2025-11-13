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

async function chatGemini(messages, { maxTokens = 2200 } = {}) {
  if (!env.googleApiKey) throw new Error("Missing GOOGLE_API_KEY");
  const genAI = new GoogleGenerativeAI(env.googleApiKey);
  const { sys, user } = flattenMessages(messages);

  const model = genAI.getGenerativeModel({
    model: env.geminiModelId || "gemini-2.5-flash-lite",
    ...(sys ? { systemInstruction: sys } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  });

  const r = await model.generateContent(user || "");
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

/* ========== NO TOCAR ========== */
export async function generateOutline({ topic, level = "beginner", tags = [] }) {
  const sys = "Eres un generador de planes de curso. Devuelve SOLO JSON válido.";
  const user = `Tema: ${topic}\nNivel: ${level}\nEtiquetas: ${tags.join(", ")}\n\nEstructura JSON:\n{\n  "course": { "id": "c_<algo>", "title": "<titulo>", "level": "<beginner|intermediate|advanced>", "tags": [] },\n  "modules": [\n    { "id": "m_1", "title": "...", "lessons": [ { "id": "l_1", "title": "...", "durationMinutes": 10 } ] }\n  ]\n}`;
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 1500 }
  );
  return JSON.parse(text);
}

export async function generateLessons({ course }) {
  const sys = "Eres un generador de contenido de lecciones para un e-learning de PROGRAMACIÓN. Devuelve SOLO JSON válido (sin fences).";
  const user = `Genera para CADA lección en course.lessons un objeto con:
  - id, moduleId, order (idénticos a entrada)
  - title (mejorado si viene genérico)
  - durationMinutes (8–15 según título)
  - summary (2–3 oraciones; 140–300 caracteres; sin saltos de línea; NO placeholders)
  - contentMD (Markdown con secciones: Objetivos, Conceptos clave, Ejemplo con \`\`\`, Mini-ejercicio)
  - tips (2–4 bullets)
  - miniChallenge (1–2 líneas)

  JSON puro, sin comentarios ni fences.

  SALIDA EXACTA:
  { "lessons": { "items": [ { "id":"l_1","moduleId":"m_1","title":"...","durationMinutes":12,"order":1,"summary":"...","contentMD":"...","tips":["..."],"miniChallenge":"..." } ] } }

  INPUT (recortado):
  ${JSON.stringify(course).slice(0, 6000)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 3000 }
  );
  try { return JSON.parse(text); } catch { throw new Error("AI_JSON_PARSE_ERROR"); }
}
/* ========== /NO TOCAR ========== */

/* =========================
   PARSER para EXAM (robusto)
   ========================= */

/** Correcciones sintácticas comunes ANTES del conteo/parseo. */
function preRepairExamJson(s = "") {
  let t = String(s ?? "");

  // 1) Normalizar comillas “inteligentes” a ASCII
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // 2a) Fix específico de claves comunes: "label" "Valor" -> "label": "Valor"
  t = t.replace(
    /("label"|"title"|"prompt"|"feedback"|"slug"|"description"|"overview"|"actionLabel"|"actionUrl"|"key")\s+("([^"\\]|\\.)*")/g,
    '$1: $2'
  );

  // 2b) Fix GENÉRICO: cualquier "clave" "valor" -> "clave": "valor"
  //    (permite saltos de línea entre clave y valor)
  t = t.replace(
    /"([A-Za-z0-9_]+)"\s+("([^"\\]|\\.)*")/g,
    '"$1": $2'
  );

  // 3) Invisibles y comas colgantes
  t = removeInvisible(t);
  t = removeTrailingCommas(t);

  return t;
}

function safeJsonParseExam(text, ctx = {}) {
  const raw = String(text ?? "");
  log(ctx, "log", "EXAM_RAW", { len: raw.length, head: head(raw), tail: tail(raw) });

  // Pre-repair global
  let t = preRepairExamJson(stripFences(raw));

  // Aislar el objeto exterior probable
  t = sliceOuterObject(t);

  // Balance check
  const count = (str, re) => (str.match(re) || []).length;
  let ob = count(t, /{/g), cb = count(t, /}/g), oB = count(t, /\[/g), cB = count(t, /]/g);

  // Reintento 1: limpiar y recontar
  if (ob !== cb || oB !== cB) {
    t = removeTrailingCommas(sliceOuterObject(t));
    ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
  }

  // Reintento 2: extraer bloque "exam" con questions[] si existe
  if (ob !== cb || oB !== cB) {
    const reExamBlock = /\{\s*"exam"\s*:\s*\{\s*[\s\S]*?"questions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}\s*\}/i;
    const m = raw.match(reExamBlock);
    if (m && m[0]) {
      t = preRepairExamJson(m[0]);
      t = removeTrailingCommas(t);
      ob = count(t, /{/g); cb = count(t, /}/g); oB = count(t, /\[/g); cB = count(t, /]/g);
    }
  }

  // Reintento 3: cerrar ] y } que falten (posible truncado final)
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

  // Parse directo y reintento tras reparar
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

/* =========================
   Generación de EXAM
   ========================= */
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

/* =========================
   Generación de Recursos (igual)
   ========================= */
export async function generateResources({ course }) {
  const sys = "Eres un generador de recursos complementarios. que busca referencias en la web. Devuelve SOLO JSON válido.";
  const user = `Genera recursos variados (article|practice|video|cheatsheet) para el curso tienes que buscarlo en la web no quiero inventados.
DEVUELVE ESTE FORMATO ESTRICTO (sin comentarios, sin claves extra, sin fences):
{
  "resources": {
    "items": [
      { "slug":"kebab-case-unico","title":"string","resourceType":"article|practice|video|cheatsheet","durationMinutes":5,"description":"string","overview":"string|null","actionLabel":"string","actionUrl":"https://...|null","tags":["..."],"lessonId":"l_1|null" }
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
