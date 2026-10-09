require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    // get API key from environment variable
    const apiKey = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',')[0] : process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("No API key found in GEMINI_API_KEYS or GEMINI_API_KEY");
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    try {
        console.log("Fetching available models...");
        // Since there is no listModels method directly on GoogleGenerativeAI in older sdks, 
        // we'll fetch via the REST API if the SDK method fails or we'll just try to use fetch.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        
        if (data.models) {
            console.log("Available Models:");
            data.models.forEach(model => {
                if (model.name.includes("gemini")) {
                    console.log(`- ${model.name} (Methods: ${model.supportedGenerationMethods.join(', ')})`);
                }
            });
        } else {
            console.log("Unexpected response:", data);
        }
    } catch (err) {
        console.error("Error fetching models:", err);
    }
}

listModels();
