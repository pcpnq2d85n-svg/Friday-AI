# FRIDAY AI Assistant - Backend

This directory contains the Node.js backend server for the FRIDAY AI Assistant application. It acts as a secure proxy between the frontend application and the Google Gemini API, protecting the API key and handling AI requests.

## Features

-   **`/api/chat`**: Handles chat conversations using the Gemini Pro model.
-   **`/api/image`**: Generates images using the Imagen model.
-   Securely manages the Google Gemini API key on the server.
-   Ready for deployment on services like Vercel.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later recommended)
-   `npm` or a compatible package manager
-   A Google Gemini API Key. You can get one from [Google AI Studio](https://aistudio.google.com/app/apikey).

## Getting Started

### 1. Clone the repository

If you haven't already, clone the main project repository.

### 2. Navigate to the backend directory

```bash
cd friday-backend
```

### 3. Install dependencies

```bash
npm install
```

### 4. Set up environment variables

Create a `.env` file in the `friday-backend` directory by copying the example file:

```bash
cp .env.example .env
```

Now, open the `.env` file and add your Google Gemini API key:

```
API_KEY="YOUR_GEMINI_API_KEY_HERE"
PORT=3001
```

### 5. Run the server

You can run the server in development mode, which will automatically restart on file changes:

```bash
npm run dev
```

Or run it in production mode:

```bash
npm start
```

The server will start, and you should see the following message in your console:
`FRIDAY backend server listening on http://localhost:3001`

The frontend application can now make requests to this backend server.

## Deployment

This server is configured for easy deployment to [Vercel](https://vercel.com/). Simply link your repository to a new Vercel project. Vercel will automatically detect the `vercel.json` configuration and deploy the server as a serverless function.

Remember to set your `API_KEY` as an environment variable in your Vercel project settings.
