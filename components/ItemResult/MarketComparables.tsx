import React from 'react';
import { AppraisalResult } from '../../types';
import { Tag } from 'lucide-react';

interface MarketComparablesProps {
  currentResult: AppraisalResult;
}

export const MarketComparables: React.FC<MarketComparablesProps> = ({ currentResult }) => {
  if (!currentResult.comparableSales || currentResult.comparableSales.length === 0) return null;

  return (
    <div className="bg-zinc-900/20 border border-white/5 p-5 rounded-2xl mb-3">
        <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest mb-4">Comparable Sales</h3>
        <div className="space-y-3">
            {currentResult.comparableSales.map((comp, idx) => (
                <div key={idx} className="bg-zinc-800/40 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-start mb-1">
                        <div className="text-xs font-bold text-white line-clamp-1">{comp.title}</div>
                        <div className="text-sm font-mono text-emerald-400 pl-2">{comp.price}</div>
                    </div>
                    <div className="flex justify-between items-center text-[9px] font-mono text-zinc-500">
                        <div className="flex items-center gap-1"><Tag size={10} /> {comp.source}</div>
                        <div>{comp.date}</div>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};
