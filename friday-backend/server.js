import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3001;

// --- Security Middleware ---

// Set security-related HTTP headers
app.use(helmet());

// Rate limiting to prevent abuse
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per windowMs
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests, please try again later.' },
});

// Apply the rate limiter to all API requests
app.use('/api/', limiter);


// --- Core Middleware ---
app.use(cors());
// Use express.json() and increase payload size limit for image data
app.use(express.json({ limit: '10mb' }));

// Initialize Google GenAI
if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set");
}
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });


// --- API Routes ---

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { history, message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Use gemini-2.5-flash for faster chat responses
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            history: history || [],
        });
        
        const response = await chat.sendMessage({ message });

        res.json({ reply: response.text });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

// Image generation endpoint
app.post('/api/image', async (req, res) => {
    try {
        const { prompt, style } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const fullPrompt = `${prompt}, ${style || 'Cinematic'} style, high detail, masterpiece`;
        
        // Use gemini-2.5-flash-image with generateContent
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: fullPrompt }],
            },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });
        
        // Extract the image data from the response
        const part = response.candidates?.[0]?.content?.parts?.[0];

        if (part?.inlineData) {
            const base64ImageBytes = part.inlineData.data;
            const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
            res.json({ imageUrl });
        } else {
            // Check for a blocked response for safety reasons
            const blockReason = response.candidates?.[0]?.finishReason;
            const safetyRatings = response.candidates?.[0]?.safetyRatings;
            console.warn('Image generation might be blocked.', { blockReason, safetyRatings });
            throw new Error("No image data was returned from the API. The prompt may have been blocked for safety reasons.");
        }

    } catch (error) {
        console.error('Error in /api/image:', error);
        res.status(500).json({ error: error.message || 'Failed to generate image' });
    }
});


// Start server
app.listen(port, () => {
    console.log(`FRIDAY backend server listening on http://localhost:${port}`);
});

// Export the app for serverless environments like Vercel
export default app;
