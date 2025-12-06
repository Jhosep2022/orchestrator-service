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

async function chatGemini(messages, { maxTokens = 2800, timeoutMs = 18000 } = {}) {
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
  const sys = "Eres un generador de planes de curso. Devuelve SOLO JSON válido.";
  const user = `Tema: ${topic}\nNivel: ${level}\nEtiquetas: ${tags.join(", ")}\n\nEstructura JSON:\n{\n  "course": { "id": "c_<algo>", "title": "<titulo>", "level": "<beginner|intermediate|advanced>", "tags": [] },\n  "modules": [\n    { "id": "m_1", "title": "...", "lessons": [ { "id": "l_1", "title": "...", "durationMinutes": 10 } ] }\n  ]\n}`;
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2000 }
  );
  return JSON.parse(text);
}

export async function generateLessons({ course }) {
  const sys = `
Eres un generador de contenido de lecciones para un e-learning de PROGRAMACIÓN.
Debes devolver SIEMPRE JSON válido, sin comentarios y sin texto fuera del JSON.
`.trim();

  const user = `
Genera para CADA lección en course.lessons un objeto con:

- id, moduleId, order (igual que los de entrada)
- title (mejorado si viene muy genérico)
- durationMinutes (entre 8 y 15 según el título)
- summary (1 párrafo, 2–3 oraciones, máximo 220 caracteres)
- contentMD con SOLO estas secciones, en este ORDEN exacto:

  1) "# <título de la lección>"
  2) "## Introducción" → 1 párrafo corto (2–3 oraciones, máximo 350 caracteres)
  3) "## Conceptos clave" → lista de 3 a 5 viñetas ("- ...")
  4) "## Ejemplo" → un bloque de código \`\`\`<lenguaje>\`\`\` usando el lenguaje principal detectado

- tips → array de 2 a 4 strings cortos (consejos prácticos)
- miniChallenge → 1 sola línea con un reto un poco más avanzado

REGLAS IMPORTANTES:
- JSON puro, sin comentarios, sin fences adicionales y sin texto fuera del JSON.
- Usa SIEMPRE un único lenguaje de programación por curso.
- Detecta el lenguaje principal a partir de course.title, course.tags o course.description
  (por ejemplo Java, Python, JavaScript, etc.).
- Si el título o tags contienen "Java", TODO el código de ejemplo debe ser Java.
- El bloque de código debe:
  - Tener como máximo 12 líneas.
  - Usar solo comillas simples '...'.
  - No incluir comentarios con comillas ni texto raro que rompa el JSON.

FORMATO EXACTO DE SALIDA (sin claves extra):
{
  "lessons": {
    "items": [
      {
        "id": "l_1",
        "moduleId": "m_1",
        "title": "string",
        "durationMinutes": 12,
        "order": 1,
        "summary": "string",
        "contentMD": "string con Markdown",
        "tips": ["string", "string"],
        "miniChallenge": "string"
      }
    ]
  }
}

INPUT (course recortado):
${JSON.stringify(course).slice(0, 6000)}
`.trim();

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200 } // un poco menos para evitar cortes
  );

  console.log("[AI][LESSONS][RAW]", text.slice(0, 600));

  try {
    const json = safeJsonParseLessons(text, { scope: "lessons" });
    return json;
  } catch (e) {
    console.error("[AI][LESSONS][PARSE_ERROR]", e?.message, {
      head: text.slice(0, 400),
      tail: text.slice(-400),
    });
    throw new Error("AI_JSON_PARSE_ERROR");
  }
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
