// src/ai/providers/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../core/env.js";

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
      // Mismo concepto que max_tokens
      maxOutputTokens: maxTokens,
      // Pedimos JSON crudo
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

// ===== API pública idéntica a la de bedrock.js =====

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

export async function generateLessons({ course }) {
  const sys = "Eres un generador de contenido de lecciones. Devuelve SOLO JSON válido.";

  const user = `Genera para CADA lección en course.lessons un objeto con:
  - id, moduleId, order (idénticos a entrada)
  - title (mejorado si viene muy genérico)
  - durationMinutes (mantén o ajusta 8-15 min según título)
  - summary (2–3 oraciones; 140–300 caracteres; sin saltos de línea)
  - contentMD (Markdown claro con secciones ## Objetivos, ## Conceptos clave, ## Ejemplo, ## Mini-ejercicio)
  - tips (2–4 bullets prácticos)
  - miniChallenge (reto breve, 1-2 líneas)

  SALIDA **ESTRICTA** (JSON puro, sin comentarios ni fences):
  {
    "lessons": {
      "items": [
        {
          "id": "l_1",
          "moduleId": "m_1",
          "title": "string",
          "durationMinutes": 12,
          "order": 1,
          "summary": "string corto (2-3 oraciones)",
          "contentMD": "markdown con secciones",
          "tips": ["...", "..."],
          "miniChallenge": "..."
        }
      ]
    }
  }

  Reglas:
  - No incluyas HTML.
  - Mantén el mismo número de lecciones y los mismos id/moduleId/order.
  - Usa español neutro y ejemplos de JavaScript cuando aplique.

  INPUT course (recortado):
  ${JSON.stringify(course).slice(0, 8000)}`;

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


function safeJsonParseExam(text) {
  // 1) logging preliminar para CloudWatch
  const len = (text || "").length;
  console.log(`[EXAM][RAW][len=${len}] head=`, (text || "").slice(0, 600));

  // 2) saneo básico
  let t = stripCodeFences(text || "");
  t = dropAfterLastBrace(t);

  // 3) chequeo balanceo simple de llaves/corchetes
  const openBraces = (t.match(/{/g) || []).length;
  const closeBraces = (t.match(/}/g) || []).length;
  const openBrackets = (t.match(/\[/g) || []).length;
  const closeBrackets = (t.match(/]/g) || []).length;

  if (openBraces !== closeBraces || openBrackets !== closeBrackets) {
    // último intento: cortar al último } y limpiar comas colgantes
    t = removeTrailingCommas(dropAfterLastBrace(t));
    const ob = (t.match(/{/g) || []).length;
    const cb = (t.match(/}/g) || []).length;
    const oB = (t.match(/\[/g) || []).length;
    const cB = (t.match(/]/g) || []).length;
    if (ob !== cb || oB !== cB) {
      console.error("[EXAM][PARSE][UNBALANCED] counters:", {
        openBraces, closeBraces, openBrackets, closeBrackets,
        afterFix: { ob, cb, oB, cB }
      });
      throw new Error("AI_JSON_UNBALANCED");
    }
  }

  // 4) intento directo
  try {
    return JSON.parse(t);
  } catch (e1) {
    // 5) remover comas colgantes y reintentar
    try {
      const fixed = removeTrailingCommas(t);
      return JSON.parse(fixed);
    } catch (e2) {
      console.error("[EXAM][PARSE][FAIL] sample:", (t || "").slice(0, 800));
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

export async function generateExam({ course }) {
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
            { "key": "A", "label": "string", "isCorrect": false, "feedback": "string" },
            { "key": "B", "label": "string", "isCorrect": false, "feedback": "string" },
            { "key": "C", "label": "string", "isCorrect": true,  "feedback": "string" },
            { "key": "D", "label": "string", "isCorrect": false, "feedback": "string" }
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
  - No incluyas ningún texto fuera del JSON.
  - Escapa comillas internas correctamente.
  - Español neutro, temática del curso.

  Contexto (recortado):
  ${JSON.stringify(course).slice(0, 3500)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200 }
  );

  // Log del tamaño & cabeza del payload ya lo hace safeJsonParseExam
  const json = safeJsonParseExam(text);
  return json;
}

export async function generateResources({ course }) {
  const sys = "Eres un generador de recursos complementarios. que busca referencias en la web. Devuelve SOLO JSON válido.";
  const user = `Genera recursos variados (article|practice|video|cheatsheet) para el curso.
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

Debes generar al MENOS 4 recursos, distribuyéndolos entre tipos.
Mantén consistencia con course.lessons cuando asignes lessonId.

INPUT (course):
${JSON.stringify(course).slice(0, 8000)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200 }
  );
  return JSON.parse(text);
}
