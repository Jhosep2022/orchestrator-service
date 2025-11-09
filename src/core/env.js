export const env = {
  provider: process.env.LLM_PROVIDER || 'google',

  // Gemini
  geminiModelId: process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash-lite',
  googleApiKey: process.env.GOOGLE_API_KEY,

  coursesTable:   process.env.COURSES_TABLE_NAME,  
  modulesTable:   process.env.MODULES_TABLE_NAME,  
  lessonsTable:   process.env.LESSONS_TABLE_NAME,  
  quizzesTable:   process.env.QUIZZES_TABLE_NAME,  
  examsTable:     process.env.EXAMS_TABLE_NAME,    
  resourcesTable: process.env.RESOURCES_TABLE_NAME,

  eventBusName: process.env.EVENT_BUS_NAME || 'default',
  allowedOrigins: process.env.ALLOWED_ORIGINS || '*'
};
