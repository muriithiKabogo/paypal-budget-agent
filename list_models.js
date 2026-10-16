
require('dotenv').config();
const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LIST_MODELS_URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

async function listModels() {
  if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in the .env file.");
    return;
  }

  console.log("Fetching available Gemini models...");

  try {
    const response = await axios.get(LIST_MODELS_URL);
    const models = response.data.models;

    if (models && models.length > 0) {
      console.log("Available Models:");
      models.forEach(model => {
        // Log the full model name and its supported generation methods
        console.log(`- Name: ${model.name}`);
        console.log(`  Supported Methods: ${model.supportedGenerationMethods.join(', ')}`);
        console.log('---');
      });
    } else {
      console.log("No models found.");
    }
  } catch (error) {
    console.error("Error fetching models:", error.response ? error.response.data : error.message);
  }
}

listModels();
