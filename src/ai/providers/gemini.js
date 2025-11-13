// src/ai/providers/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../core/env.js";

function safeJsonParse(raw) {
  if (raw == null) throw new Error("AI_EMPTY_RESPONSE");
  let text = String(raw);

  // 1) quitar fences ```json ... ``` o ```
  text = text.replace(/```json\s*([\s\S]*?)```/gi, "$1").replace(/```\s*([\s\S]*?)```/g, "$1");

  // 2) normalizar comillas tipográficas → rectas
  const smartToStraight = {
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
    "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'"
  };
  text = text.replace(/[\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B]/g, m => smartToStraight[m] || m);

  // 3) extraer PRIMER objeto balanceado {...}
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

  // 4) limpiar comas colgantes más comunes
  candidate = candidate.replace(/,\s*([}\]])/g, "$1");

  // 5) parse final
  return JSON.parse(candidate);
}

/** Convierte [{role, content}] a systemInstruction + prompt lineal */
function flattenMessages(messages) {
  const sys = messages.find(m => m.role === "system")?.content || null;
  const user = messages
    .filter(m => m.role !== "system")
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  return { sys, user };
}

async function chatGemini(messages, { maxTokens = 2200, responseSchema = null } = {}) {
  if (!env.googleApiKey) throw new Error("Missing GOOGLE_API_KEY");
  const genAI = new GoogleGenerativeAI(env.googleApiKey);
  const { sys, user } = flattenMessages(messages);

  const model = genAI.getGenerativeModel({
    model: env.geminiModelId || "gemini-2.5-flash-lite",
    ...(sys ? { systemInstruction: sys } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {})
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
Estructura:
{
  "course": { "id": "c_<algo>", "title": "<titulo>", "level": "<beginner|intermediate|advanced>", "tags": [] },
  "modules": [{ "id": "m_1", "title": "...", "position": 1 }]
}`;
  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 1500 }
  );
  return safeJsonParse(text);
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



export async function generateQuizzes({ course }) {
  const user = `Genera 2-3 preguntas por lección (multiopción). Incluye isCorrect en opciones.
Salida:
{ "quizzes":[ { "lessonId":"l_1","questions":[{"id":"q1","position":1,"prompt":"...","options":[{"key":"A","label":"...","isCorrect":false,"feedback":"..."}]}]} ] }`;
  const text = await chatGemini([{ role: "user", content: user }], { maxTokens: 3000 });
  return JSON.parse(text);
}

export async function generateExam({ course }) {
  const schema = {
    type: "object",
    properties: {
      exam: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          mode: { type: "string" },
          timeLimitMinutes: { type: "integer" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                position: { type: "integer" },
                prompt: { type: "string" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      label: { type: "string" },
                      isCorrect: { type: "boolean" },
                      feedback: { type: "string" }
                    },
                    required: ["key", "label", "isCorrect"]
                  }
                },
                answerKeys: { type: "array", items: { type: "string" } }
              },
              required: ["id", "position", "prompt", "options"]
            }
          },
          answerSheet: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                answerKeys: { type: "array", items: { type: "string" } }
              },
              required: ["id", "answerKeys"]
            }
          }
        },
        required: ["questions"]
      }
    },
    required: ["exam"]
  };

  const sys = "Eres un generador de exámenes. Devuelve SOLO JSON válido.";
  const user = `Genera examen final de 8–10 preguntas multiopción (A–D) del curso.
Reglas:
- Cada pregunta: { id, position, prompt, options[ {key,label,isCorrect,feedback} ], answerKeys[] }.
- answerSheet es redundante: lista { id, answerKeys[] } para todas las preguntas.
- Nada de texto fuera del JSON.

Salida EXACTA:
{
  "exam": {
    "id":"ex_1",
    "title":"Examen final",
    "mode":"final",
    "timeLimitMinutes": 0,
    "questions":[
      { "id":"q1","position":1,"prompt":"...", "options":[{"key":"A","label":"...","isCorrect":true,"feedback":"..."}], "answerKeys":["A"] }
    ],
    "answerSheet":[ { "id":"q1", "answerKeys":["A"] } ]
  }
}

Contexto (recortado):
${JSON.stringify(course).slice(0, 3500)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 3000, responseSchema: schema }
  );
  return safeJsonParse(text);
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
