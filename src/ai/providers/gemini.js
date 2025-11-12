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
  const user = `Genera contenido breve (Markdown) por lección PARA CADA lección listada en course.lessons.
La salida DEBE mantener el mismo número de lecciones y respetar id, moduleId y order.

SALIDA ESTRICTA (JSON sin comentarios, sin markdown fences):
{
  "lessons": {
    "items": [
      {
        "id": "l_1",
        "moduleId": "m_1",
        "title": "string",
        "durationMinutes": 12,
        "order": 1,
        "contentMD": "markdown corto",
        "tips": ["..."],
        "miniChallenge": "..."
      }
    ]
  }
}

INPUT course:
${JSON.stringify(course).slice(0, 8000)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 3000 }
  );
  return JSON.parse(text);
}



export async function generateQuizzes({ course }) {
  const user = `Genera 2-3 preguntas por lección (multiopción). Incluye isCorrect en opciones.
Salida:
{ "quizzes":[ { "lessonId":"l_1","questions":[{"id":"q1","position":1,"prompt":"...","options":[{"key":"A","label":"...","isCorrect":false,"feedback":"..."}]}]} ] }`;
  const text = await chatGemini([{ role: "user", content: user }], { maxTokens: 3000 });
  return JSON.parse(text);
}

export async function generateExam({ course }) {
  const user = `Genera examen final de 8-10 preguntas. Salida:
{ "exam": { "id":"ex_1","title":"Examen final","questions":[{"id":"q1","prompt":"...","options":[{"key":"A","label":"...","isCorrect":true,"feedback":"..."}]}] } }`;
  const text = await chatGemini([{ role: "user", content: user }], { maxTokens: 3000 });
  return JSON.parse(text);
}

export async function generateResources({ course }) {
  const sys = "Eres un generador de recursos complementarios. Devuelve SOLO JSON válido.";
  const user = `Genera recursos variados (article|practice|video|cheatsheet) para el curso.
DEVUELVE ESTE FORMATO ESTRICTO (sin comentarios, sin claves extra):
{
  "resources": {
    "items": [
      {
        "slug": "kebab-case-unico",
        "title": "string",
        "resourceType": "article|practice|video|cheatsheet",
        "durationMinutes": 5,
        "description": "string",
        "overview": "string",
        "actionLabel": "string",
        "actionUrl": "https://...",
        "tags": ["..."],
        "lessonId": "l_1"   // opcional, si aplica
      }
    ]
  }
}

INPUT (course):
${JSON.stringify(course).slice(0, 8000)}`;

  const text = await chatGemini(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 2200 }
  );
  return JSON.parse(text);
}