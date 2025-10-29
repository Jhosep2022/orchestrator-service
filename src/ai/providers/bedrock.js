import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { env } from '../../core/env.js';

const br = new BedrockRuntimeClient({});

async function chatAnthropic(messages, { maxTokens = 2200 } = {}) {
  // messages: [{role:'user'|'system', content:'...'}]
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    messages
  };
  const r = await br.send(new InvokeModelCommand({
    modelId: env.bedrockModelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body)
  }));
  const payload = JSON.parse(new TextDecoder().decode(r.body));
  const text = payload?.content?.[0]?.text || '';
  return text;
}

export async function generateOutline({ topic, level='beginner', tags=[] }) {
  const sys = "Eres un generador de planes de curso. Devuelve SOLO JSON válido.";
  const user = `Tema: ${topic}\nNivel: ${level}\nEtiquetas: ${tags.join(', ')}

Estructura JSON:
{
  "course": { "id": "c_<algo>", "title": "<titulo>", "level": "<beginner|intermediate|advanced>", "tags": [] },
  "modules": [
    { "id": "m_1", "title": "...", "lessons": [ { "id": "l_1", "title": "...", "durationMinutes": 10 } ] }
  ]
}`;
  const text = await chatAnthropic([{role:'system', content: sys}, {role:'user', content: user}], {maxTokens: 1500});
  return JSON.parse(text);
}

export async function generateLessons({ course }) {
  const user = `Genera contenido breve (Markdown) por lección. Entrada:\n${JSON.stringify(course).slice(0,8000)}
Salida:
{ "lessons":[ { "id":"l_1","moduleId":"m_1","title":"...","durationMinutes":12,"contentMD":"...","tips":["..."],"miniChallenge":"..." } ] }`;
  const text = await chatAnthropic([{role:'user', content: user}], {maxTokens: 3000});
  return JSON.parse(text);
}

export async function generateQuizzes({ course }) {
  const user = `Genera 2-3 preguntas por lección (multiopción). Incluye isCorrect en opciones.
Salida:
{ "quizzes":[ { "lessonId":"l_1","questions":[{"id":"q1","position":1,"prompt":"...","options":[{"key":"A","label":"...","isCorrect":false,"feedback":"..."}]}]} ] }`;
  const text = await chatAnthropic([{role:'user', content: user}], {maxTokens: 3000});
  return JSON.parse(text);
}

export async function generateExam({ course }) {
  const user = `Genera examen final de 8-10 preguntas. Salida:
{ "exam": { "id":"ex_1","title":"Examen final","questions":[{"id":"q1","prompt":"...","options":[{"key":"A","label":"...","isCorrect":true,"feedback":"..."}]}] } }`;
  const text = await chatAnthropic([{role:'user', content: user}], {maxTokens: 3000});
  return JSON.parse(text);
}

export async function generateResources({ course }) {
  const user = `Genera recursos complementarios variados (article|practice|video|cheatsheet).
Salida:
{ "resources":[ { "slug":"guia-clases-objetos","title":"...","resource_type":"cheatsheet","duration_minutes":7,"description":"...","overview":"...","action_label":"Ver detalle","action_url":"https://example.com","tags":["..."] } ] }`;
  const text = await chatAnthropic([{role:'user', content: user}], {maxTokens: 2200});
  return JSON.parse(text);
}
