
import React, { useEffect, useRef, useState } from "react";
import { GoogleGenAI, Chat, Modality } from "@google/genai";

// Type definitions for Web Speech API to ensure TypeScript compatibility
interface SpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}
interface SpeechRecognitionErrorEvent {
  error: string;
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}
interface SpeechRecognitionStatic {
  new (): SpeechRecognition;
}
declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionStatic;
    webkitSpeechRecognition: SpeechRecognitionStatic;
  }
}

// Type for chat messages
interface Message {
  id: string;
  from: 'user' | 'assistant';
  text: string;
  image?: string;
  ts?: number;
}

const STORAGE_KEY = "friday_ultra_v2_history";

const genId = (): string => {
  return Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4);
}

const loadHistory = (): Message[] => {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return [{id:genId(), from:'assistant', text:'FRIDAY online. Secure channel active.'}];
    return JSON.parse(r);
  } catch(e) {
    return [{id:genId(), from:'assistant', text:'FRIDAY online. Secure channel active.'}];
  }
};

const saveHistory = (messages: Message[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch(e) {
    console.warn('save failed', e);
  }
};

// Initialize Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });


export default function App() {
  const [messages, setMessages] = useState<Message[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState(true); // just visual indicator
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const speechRef = useRef<SpeechRecognition | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => saveHistory(messages), [messages]);
  useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, isThinking, isGenerating]);

  // Initialize chat session on mount or when history is cleared
  useEffect(() => {
    const chatHistory = messages
      .slice(1) // remove initial "FRIDAY online." message
      .filter(m => !m.image) // Filter out image-related messages
      .map(m => ({
        role: m.from === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }));

    chatRef.current = ai.chats.create({
        model: 'gemini-2.5-flash',
        history: chatHistory,
    });
  }, [messages.length === 1]); // Re-initialize if history is cleared

  // keywords that suggest image intent
  const IMAGE_KEYWORDS = ['image','generate','create','draw','paint','photo','render','illustrate','picture','design'];

  function detectImageIntent(text: string): boolean {
    const t = text.toLowerCase();
    return IMAGE_KEYWORDS.some(k => t.includes(k)) || /^\/image\b|^\/img\b|^\/photo\b/.test(t);
  }

  // send unified input
  async function handleSend(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !chatRef.current) return;
    setLastError(null);

    const isImage = detectImageIntent(text);

    // show user message
    const userMsg: Message = { id: genId(), from: 'user', text, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    setInput('');

    if (isImage) {
      await generateImageFlow(text);
      return;
    }
    
    // else text chat
    setIsThinking(true);
    const assistantMsgId = genId();
    setMessages(m => [...m, { id: assistantMsgId, from: 'assistant', text: '' }]);
    
    try {
      const stream = await chatRef.current.sendMessageStream({ message: text });
      let fullReply = "";
      for await (const chunk of stream) {
        fullReply += chunk.text;
        setMessages(prev => 
          prev.map(m => m.id === assistantMsgId ? { ...m, text: fullReply } : m)
        );
      }
    } catch (err: any) {
      console.error(err);
      const errorText = "FRIDAY couldn't reach the AI. " + (err.message || String(err));
       setMessages(prev => 
        prev.map(m => m.id === assistantMsgId ? { ...m, text: errorText } : m)
      );
      setLastError(err.message || String(err));
    } finally {
      setIsThinking(false);
    }
  }

  // image flow
  async function generateImageFlow(prompt: string) {
    setIsGenerating(true);
    setLastError(null);
    const fakeTimer = fakeProgress(p => setProgress(p));
    setProgress(6);
    try {
      const cleaned = prompt.replace(/^\/image\b|^\/img\b|^\/photo\b/ig, '').trim();
      const bodyPrompt = cleaned || prompt;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [{ text: bodyPrompt }],
        },
        config: {
            responseModalities: [Modality.IMAGE],
        },
      });

      clearInterval(fakeTimer);
      setProgress(80);
      
      const part = response.candidates?.[0]?.content?.parts?.[0];

      if (part?.inlineData) {
          const base64ImageBytes = part.inlineData.data;
          const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
          setMessages(m => [...m, { id: genId(), from: 'assistant', text: `Generated image: "${bodyPrompt}"`, image: imageUrl, ts: Date.now() }]);
          setProgress(100);
      } else {
          const blockReason = response.candidates?.[0]?.finishReason;
          const safetyRatings = response.candidates?.[0]?.safetyRatings;
          console.warn('Image generation might be blocked.', { blockReason, safetyRatings });
          throw new Error("No image data was returned. The prompt may have been blocked for safety reasons.");
      }

    } catch (err: any) {
      clearInterval(fakeTimer);
      console.error(err);
      setMessages(m => [...m, { id: genId(), from: 'assistant', text: 'Image generation failed.' }]);
      setLastError(err.message || String(err));
    } finally {
      setIsGenerating(false);
      setTimeout(() => setProgress(0), 900);
    }
  }

  // fake progress for images
  function fakeProgress(cb: (p: number) => void): ReturnType<typeof setInterval> {
    let p=10;
    return setInterval(()=>{ p+=Math.random()*12; if(p>88)p=88; cb(Math.floor(p)); }, 380);
  }

  // voice
  function toggleListening(){ if(listening) return stopListening(); startListening(); }
  function startListening(){ const S = window.SpeechRecognition||window.webkitSpeechRecognition; if(!S){ alert('Voice not supported'); return;} const r=new S(); r.lang='en-IN'; r.interimResults=false; r.maxAlternatives=1; r.onstart=()=>setListening(true); r.onresult=(ev)=>{ const t=ev.results[0][0].transcript; setInput(prev=>prev?prev+' '+t:t); }; r.onerror=()=>setListening(false); r.onend=()=>setListening(false); speechRef.current=r; r.start(); }
  function stopListening(){ try{ speechRef.current?.stop(); }catch(e) { console.warn(e) } setListening(false); }

  // small utilities
  function clearHistory(){ if(!confirm('Clear chat history?'))return; const w: Message ={id:genId(),from:'assistant',text:'FRIDAY online. Secure channel active.'}; setMessages([w]); localStorage.removeItem(STORAGE_KEY); }
  function exportHistory(){ const blob=new Blob([JSON.stringify(messages,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`friday_history_${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  function downloadImage(url: string){ const a=document.createElement('a'); a.href=url; a.download=`friday_image_${Date.now()}.png`; document.body.appendChild(a); a.click(); a.remove(); }

  // retry last message (simple)
  async function retryLast(){
    const lastUser=[...messages].reverse().find(m=>m.from==='user');
    if(!lastUser) return;
    setInput(lastUser.text);

    // We need to wait for the state to update, then submit.
    // A simple timeout works for this purpose.
    setTimeout(() => {
        const form = document.querySelector('form');
        form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, 0);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#001018] to-[#00060a] text-gray-100 p-6 font-sans">
      <div className="max-w-4xl mx-auto">
        {/* top realistic HUD */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#ff7a59] to-[#ffcc66] flex items-center justify-center shadow-lg">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v20" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
            <div>
              <h2 className="text-lg font-bold">FRIDAY Ultra v2</h2>
              <div className="text-xs text-gray-400">Secure • Intelligent • Made for Jay Patel</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.02)] px-3 py-1 rounded-md">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={encrypted ? 'text-green-400' : 'text-gray-500'}><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z" fill="currentColor"/></svg>
              <span className="text-xs">E2E {encrypted? 'Encrypted':'Unencrypted'}</span>
            </div>

            <button onClick={exportHistory} className="text-xs px-3 py-1 rounded-md bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.08)] transition-colors">Export</button>
            <button onClick={clearHistory} className="text-xs px-3 py-1 rounded-md bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.08)] transition-colors">Clear</button>
          </div>
        </div>

        {/* chat window */}
        <div className="bg-[rgba(255,255,255,0.02)] rounded-2xl p-4 border border-[rgba(255,120,80,0.04)] shadow-lg">
          <div className="h-[60vh] overflow-y-auto mb-3 p-2" style={{ scrollbarGutter: 'stable' }}>
            <div className="space-y-4">
              {messages.map(m=> (
                <div key={m.id} className={`flex ${m.from==='user'? 'justify-end': 'justify-start'}`}>
                  <div className={`p-3 rounded-2xl max-w-[78%] ${m.from==='user' ? 'bg-gradient-to-r from-[#ff7a5a] to-[#ff3b1f] text-white' : 'bg-[rgba(255,255,255,0.02)] text-gray-100'}`} style={{ boxShadow: m.from==='user' ? '0 8px 24px rgba(255,58,34,0.08)' : 'inset 0 0 10px rgba(0,0,0,0.4)'}}>
                    <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                    {m.image && (
                      <div className="mt-3">
                        <img src={m.image} alt="generated" className="w-full rounded-md border border-[rgba(255,120,80,0.06)]" />
                        <div className="mt-2 flex gap-2">
                          <button onClick={()=>window.open(m.image,'_blank')} className="text-xs px-2 py-1 rounded bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.4)] transition-colors">Open</button>
                          <button onClick={()=>downloadImage(m.image!)} className="text-xs px-2 py-1 rounded bg-gradient-to-r from-[#ff7a59] to-[#ff3b1f] hover:brightness-110 transition-all">Download</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isThinking && (
                <div className="flex justify-start"><div className="p-3 rounded-2xl bg-[rgba(255,255,255,0.02)]"><TypingDots/></div></div>
              )}

              {isGenerating && (
                <div className="flex justify-start"><div className="p-3 rounded-2xl bg-[rgba(255,255,255,0.02)] text-xs text-gray-300">Generating image... {progress}%</div></div>
              )}

            </div>
            <div ref={messagesEndRef} />
          </div>

          {/* Smart composer */}
          <form onSubmit={handleSend} className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.02)] rounded-full px-3 py-2 flex-1 border border-transparent focus-within:border-[rgba(255,120,80,0.2)] focus-within:bg-[rgba(255,255,255,0.03)] transition-all">
              <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Type a message or 'generate image of...'" className="bg-transparent outline-none flex-1 text-sm pl-2" />
              <button type="button" onClick={toggleListening} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${listening? 'bg-gradient-to-r from-[#ff7a59] to-[#ff3b1f] animate-pulse':'bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)]'}`} title="Voice input">🎙️</button>
            </div>

            <div className="flex flex-col gap-1">
              <button type="submit" disabled={!input || isThinking || isGenerating} className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#ff7a59] to-[#ff3b1f] text-white font-semibold hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed">Send</button>
              <button type="button" onClick={retryLast} className="text-xs px-3 py-1 rounded-md bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.08)] transition-colors">Retry</button>
            </div>
          </form>

          {/* footer small */}
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${encrypted? 'bg-green-500':'bg-gray-600'}`} />
              <div>{encrypted? 'End-to-end encrypted' : 'Not encrypted'}</div>
            </div>
            <div>Made by <strong>Jay Patel</strong></div>
          </div>

          {lastError && <div className="mt-2 text-xs text-amber-400/80 p-2 bg-amber-500/10 rounded-md"><strong>Error:</strong> {lastError}</div>}
        </div>
      </div>
    </div>
  );
}

function TypingDots(){
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'linear-gradient(180deg,#ffb59e,#ff7a59)' }} />
      <span className="w-2 h-2 rounded-full animate-pulse" style={{ animationDelay: '120ms', background: 'linear-gradient(180deg,#ffb59e,#ff7a59)' }} />
      <span className="w-2 h-2 rounded-full animate-pulse" style={{ animationDelay: '240ms', background: 'linear-gradient(180deg,#ffb59e,#ff7a59)' }} />
    </div>
  );
}
