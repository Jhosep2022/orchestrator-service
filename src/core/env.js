export const env = {
  provider: process.env.LLM_PROVIDER || 'google',

  // Gemini
  geminiModelId: process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash-lite',
  googleApiKey: process.env.GOOGLE_API_KEY,

  // Tablas / EventBridge / CORS (lo que ya usas)
  tableName: process.env.COURSES_TABLE_NAME,
  resourcesTableName: process.env.RESOURCES_TABLE_NAME,
  eventBusName: process.env.EVENT_BUS_NAME || 'default',
  allowedOrigins: process.env.ALLOWED_ORIGINS || '*'
};
