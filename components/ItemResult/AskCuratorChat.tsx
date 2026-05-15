import React from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';

interface AskCuratorChatProps {
  showChat: boolean;
  setShowChat: (show: boolean) => void;
  chatHistory: { role: string; text: string }[];
  isChatLoading: boolean;
  chatInput: string;
  setChatInput: (val: string) => void;
  handleChat: (text?: string) => void;
}

export const AskCuratorChat: React.FC<AskCuratorChatProps> = ({
  showChat,
  setShowChat,
  chatHistory,
  isChatLoading,
  chatInput,
  setChatInput,
  handleChat
}) => {
  if (!showChat) return null;

  return (
    <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between p-4 border-b border-white/10 pt-[calc(20px+env(safe-area-inset-top))]">
            <span className="font-display text-lg">Curator AI</span>
            <button onClick={() => setShowChat(false)} className="p-2 text-zinc-500 hover:text-white"><X size={20}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[85%] p-4 rounded-2xl text-sm shadow-lg ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-zinc-800/80 border border-white/10 text-zinc-200 rounded-tl-sm'}`}>
                        {m.role === 'model' ? (
                            <div className="markdown-body prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-p:mb-2 prose-ul:list-disc prose-ul:pl-4 prose-li:mb-1">
                                <Markdown>{m.text}</Markdown>
                            </div>
                        ) : (
                            m.text
                        )}
                    </div>
                </div>
            ))}
            {isChatLoading && (
                <div className="flex justify-start">
                    <div className="max-w-[85%] p-4 rounded-2xl rounded-tl-sm bg-zinc-800/80 border border-white/10 text-zinc-400 flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-xs animate-pulse">Analyzing...</span>
                    </div>
                </div>
            )}
        </div>
        <div className="p-4 bg-black border-t border-white/10 flex gap-2 pb-8">
            <input 
                value={chatInput} 
                onChange={e => setChatInput(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && chatInput.trim() && handleChat()}
                className="flex-1 bg-zinc-900 rounded-full px-5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500 border border-zinc-800 transition-all" 
                placeholder="Ask anything..." 
            />
            <button 
                onClick={() => chatInput.trim() && handleChat()} 
                disabled={!chatInput.trim() || isChatLoading}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${chatInput.trim() && !isChatLoading ? 'bg-blue-600 text-white hover:bg-blue-500 hover:scale-105 shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}
            >
                <Send size={18}/>
            </button>
        </div>
    </div>
  );
};
