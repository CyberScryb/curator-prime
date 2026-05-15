import React, { useState } from 'react';
import { AppraisalResult } from '../../types';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Edit2, Check, X } from 'lucide-react';

interface ValuationPanelProps {
  currentResult: AppraisalResult;
  onUpdate?: (result: AppraisalResult) => void;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const UNITS = ['Total', 'grams', 'carats', 'oz', 'kg'];

export const ValuationPanel: React.FC<ValuationPanelProps> = ({ currentResult, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    low: currentResult.valuation.low,
    mid: currentResult.valuation.mid,
    high: currentResult.valuation.high,
    currency: currentResult.valuation.currency || 'USD',
    unit: currentResult.valuation.unit || 'Total'
  });

  const handleSave = () => {
    if (onUpdate) {
      onUpdate({
        ...currentResult,
        valuation: {
          ...currentResult.valuation,
          low: Number(editValues.low),
          mid: Number(editValues.mid),
          high: Number(editValues.high),
          currency: editValues.currency,
          unit: editValues.unit === 'Total' ? undefined : editValues.unit
        }
      });
    }
    setIsEditing(false);
  };

  const getCurrencySymbol = (code: string) => {
    switch (code) {
        case 'EUR': return '€';
        case 'GBP': return '£';
        case 'JPY': return '¥';
        default: return '$';
    }
  };

  const symbol = getCurrencySymbol(currentResult.valuation.currency || 'USD');
  const unitLabel = currentResult.valuation.unit ? ` / ${currentResult.valuation.unit}` : '';

  return (
    <div className="bg-zinc-900/20 border border-white/5 p-6 rounded-3xl mb-4">
        <div className="flex justify-between items-center mb-6">
            <h3 className="text-[10px] font-bold text-white uppercase tracking-[0.2em]">Valuation & 5-Year Projection</h3>
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-[8px] font-mono text-zinc-500">
                    <div className="w-2 h-2 rounded-[2px] bg-emerald-500"></div>
                    <span>EST_MARKET_VALUE_{currentResult.valuation.currency || 'USD'}</span>
                </div>
                {onUpdate && !isEditing && (
                    <button onClick={() => setIsEditing(true)} className="text-zinc-500 hover:text-white transition-colors">
                        <Edit2 size={12} />
                    </button>
                )}
            </div>
        </div>
        
        {isEditing ? (
            <div className="mb-6 p-4 border border-white/10 rounded-2xl bg-black/40">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Manual Override</span>
                    <div className="flex gap-2">
                        <button onClick={() => setIsEditing(false)} className="p-1 text-zinc-500 hover:text-red-400"><X size={14}/></button>
                        <button onClick={handleSave} className="p-1 text-zinc-500 hover:text-emerald-400"><Check size={14}/></button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="text-[8px] uppercase text-zinc-500 font-mono tracking-widest block mb-1">Currency</label>
                        <select 
                            value={editValues.currency}
                            onChange={e => setEditValues({ ...editValues, currency: e.target.value })}
                            className="w-full bg-black border border-white/10 rounded p-1.5 text-xs text-white uppercase font-mono h-8"
                        >
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[8px] uppercase text-zinc-500 font-mono tracking-widest block mb-1">Unit</label>
                        <select 
                            value={editValues.unit}
                            onChange={e => setEditValues({ ...editValues, unit: e.target.value })}
                            className="w-full bg-black border border-white/10 rounded p-1.5 text-xs text-white uppercase font-mono h-8"
                        >
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-[8px] uppercase text-zinc-500 font-mono tracking-widest block mb-1">Low</label>
                        <input 
                            type="number" 
                            value={editValues.low} 
                            onChange={e => setEditValues({ ...editValues, low: Number(e.target.value) })}
                            className="w-full bg-black border border-white/10 rounded p-2 text-sm text-white font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-[8px] uppercase text-blue-400 font-bold tracking-widest block mb-1">Mid</label>
                        <input 
                            type="number" 
                            value={editValues.mid} 
                            onChange={e => setEditValues({ ...editValues, mid: Number(e.target.value) })}
                            className="w-full bg-blue-500/10 border border-blue-500/30 rounded p-2 text-sm text-blue-400 font-mono font-bold"
                        />
                    </div>
                    <div>
                        <label className="text-[8px] uppercase text-zinc-500 font-mono tracking-widest block mb-1">High</label>
                        <input 
                            type="number" 
                            value={editValues.high} 
                            onChange={e => setEditValues({ ...editValues, high: Number(e.target.value) })}
                            className="w-full bg-black border border-white/10 rounded p-2 text-sm text-white font-mono"
                        />
                    </div>
                </div>
            </div>
        ) : (
            <div className="grid grid-cols-3 gap-2 mb-6">
                <div className="p-3 bg-black/40 border border-white/5 rounded-xl border-l-2 border-l-red-500">
                    <div className="text-[8px] uppercase text-zinc-500 font-mono tracking-widest mb-1">Low</div>
                    <div className="font-mono text-white text-lg">{symbol}{currentResult.valuation.low.toLocaleString()}<span className="text-[10px] text-zinc-500">{unitLabel}</span></div>
                </div>
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-8 h-8 bg-blue-500/20 blur-xl"></div>
                    <div className="text-[8px] uppercase text-blue-400 font-bold tracking-widest mb-1">Estimated Mid</div>
                    <div className="font-mono text-blue-400 text-2xl font-bold">{symbol}{currentResult.valuation.mid.toLocaleString()}<span className="text-xs text-blue-500/50">{unitLabel}</span></div>
                </div>
                <div className="p-3 bg-black/40 border border-white/5 rounded-xl border-r-2 border-r-emerald-500 text-right">
                    <div className="text-[8px] uppercase text-zinc-500 font-mono tracking-widest mb-1">High</div>
                    <div className="font-mono text-white text-lg">{symbol}{currentResult.valuation.high.toLocaleString()}<span className="text-[10px] text-zinc-500">{unitLabel}</span></div>
                </div>
            </div>
        )}
        
        {/* Chart */}
        <div className="h-48 w-full -ml-4">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={currentResult.forecast.fiveYearProjection}>
                    <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <XAxis 
                        dataKey="year" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#52525b', fontSize: 10, fontFamily: 'monospace' }} 
                    />
                    <YAxis hide />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px', fontSize: '10px', fontFamily: 'monospace' }}
                        itemStyle={{ color: '#fff' }}
                        labelStyle={{ color: '#71717a', marginBottom: '4px' }}
                        formatter={(value: any) => [`${symbol}${value.toLocaleString()}`, 'Value']}
                    />
                    <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorValue)" 
                        animationDuration={1500}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    </div>
  );
};
