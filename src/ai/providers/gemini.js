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


function safeJsonParseExam(raw) {
  if (raw == null) throw new Error("AI_EMPTY_RESPONSE");
  let text = String(raw);

  // quitar fences
  text = text.replace(/```json\s*([\s\S]*?)```/gi, "$1").replace(/```\s*([\s\S]*?)```/g, "$1");

  // normalizar comillas tipográficas
  const smartMap = {
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
    "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'"
  };
  text = text.replace(/[\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B]/g, m => smartMap[m] || m);

  // extraer PRIMER objeto balanceado {...}
  const start = text.indexOf("{");
  if (start === -1) throw new Error("AI_JSON_NOT_FOUND");
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (!esc && ch === '"') inStr = false;
      esc = ch === "\\" && !esc;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
  }
  if (end === -1) throw new Error("AI_JSON_UNBALANCED");
  let candidate = text.slice(start, end + 1);

  // limpiar comas colgantes
  candidate = candidate.replace(/,\s*([}\]])/g, "$1");

  return JSON.parse(candidate);
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
  const user = `Genera un examen final de 8–10 preguntas multiopción (A–D) del curso.

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
- Usa SOLO estas claves: id,title,mode,timeLimitMinutes,questions,position,prompt,options,key,label,isCorrect,feedback,answerKeys,answerSheet.
- Escapa comillas internas correctamente.
- Español neutro, temática del curso.

Contexto (recortado):
${JSON.stringify(course).slice(0, 3500)}`;

  // Llamada igual (no se toca chatGemini)
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200 }
  );

  // Parse robusto SOLO para exam
  const parsed = safeJsonParseExam(text);

  // Normalización mínima y construcción de answerSheet
  const ex = parsed?.exam ?? {};
  const questions = Array.isArray(ex?.questions) ? ex.questions : [];

  const items = questions.map((q, i) => normalizeExamQuestion(q, i));

  const answerSheet =
    Array.isArray(ex?.answerSheet) && ex.answerSheet.length
      ? ex.answerSheet.map(x => ({
          id: String(x?.id ?? "").trim(),
          answerKeys: Array.isArray(x?.answerKeys) ? x.answerKeys : []
        }))
      : items.map(q => ({ id: q.id, answerKeys: q.answerKeys }));

  const out = {
    exam: {
      id: String(ex?.id ?? "ex_1"),
      title: String(ex?.title ?? "Examen final"),
      mode: String(ex?.mode ?? "final"),
      timeLimitMinutes: Number(ex?.timeLimitMinutes ?? 0),
      questions: items,
      answerSheet
    }
  };

  return out;
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
