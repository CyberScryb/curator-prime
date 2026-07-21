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
    <div className="absolute inset-0 z-[100] bg-canvas/98 backdrop-blur-xl flex flex-col animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between p-4 border-b border-line pt-[calc(12px+env(safe-area-inset-top))]">
            <div>
              <div className="font-display text-lg text-ink">Ask Curator</div>
              <div className="text-[11px] text-mute">Practical answers about this piece</div>
            </div>
            <button onClick={() => setShowChat(false)} className="p-2 text-faint hover:text-ink rounded-full border border-line"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.length === 0 && (
              <p className="text-sm text-mute text-center pt-8 px-6 leading-relaxed">
                Ask about authenticity, pricing, care, selling, or history.
              </p>
            )}
            {chatHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[88%] p-4 rounded-2xl text-sm shadow-card ${m.role === 'user' ? 'bg-brand text-white rounded-tr-sm' : 'bg-elevated border border-line text-ink rounded-tl-sm'}`}>
                        {m.role === 'model' ? (
                            <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-p:mb-2 prose-ul:list-disc prose-ul:pl-4 prose-li:mb-1">
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
                    <div className="max-w-[85%] p-4 rounded-2xl rounded-tl-sm bg-elevated border border-line text-mute flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-xs">Thinking…</span>
                    </div>
                </div>
            )}
        </div>
        <div className="p-4 bg-surface border-t border-line flex gap-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <input 
                value={chatInput} 
                onChange={e => setChatInput(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && chatInput.trim() && handleChat()}
                className="flex-1 bg-elevated rounded-2xl px-5 text-sm text-ink outline-none focus:border-brandsoft/50 border border-line" 
                placeholder="Ask anything about this item…" 
            />
            <button 
                onClick={() => chatInput.trim() && handleChat()} 
                disabled={!chatInput.trim() || isChatLoading}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${chatInput.trim() && !isChatLoading ? 'bg-brand text-white shadow-glow' : 'bg-elevated text-faint cursor-not-allowed border border-line'}`}
            >
                <Send size={18}/>
            </button>
        </div>
    </div>
  );
};
