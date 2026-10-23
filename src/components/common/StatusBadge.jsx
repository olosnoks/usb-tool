import React from 'react';

/**
 * StatusBadge Component
 * Premium cyberpunk status pills and indicators
 */
export default function StatusBadge({
  status = 'offline', // 'online' | 'offline' | 'connecting' | 'warning' | 'active'
  label,
  value,
  size = 'md', // 'sm' | 'md' | 'lg'
  dot = true,
  pulse = false,
  className = ''
}) {
  const getStyles = () => {
    switch (status) {
      case 'online':
      case 'success':
        return {
          bg: 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400',
          dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
          glow: 'shadow-[0_0_12px_rgba(16,185,129,0.15)]'
        };
      case 'connecting':
        return {
          bg: 'bg-amber-950/60 border-amber-500/40 text-amber-300',
          dot: 'bg-amber-400 animate-ping shadow-[0_0_8px_rgba(251,191,36,0.8)]',
          glow: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]'
        };
      case 'warning':
        return {
          bg: 'bg-amber-950/60 border-amber-500/40 text-amber-400',
          dot: 'bg-amber-400',
          glow: ''
        };
      case 'active':
        return {
          bg: 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300',
          dot: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]',
          glow: 'shadow-[0_0_12px_rgba(6,182,212,0.15)]'
        };
      case 'break':
      case 'error':
        return {
          bg: 'bg-rose-950/60 border-rose-500/40 text-rose-400',
          dot: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
          glow: 'shadow-[0_0_12px_rgba(244,63,94,0.15)]'
        };
      case 'offline':
      default:
        return {
          bg: 'bg-slate-900/80 border-slate-800 text-slate-400',
          dot: 'bg-slate-600',
          glow: ''
        };
    }
  };

  const current = getStyles();

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-2',
    lg: 'text-sm px-3.5 py-1.5 gap-2.5'
  }[size] || 'text-xs px-2.5 py-1 gap-2';

  return (
    <div
      className={`inline-flex items-center font-mono font-medium rounded-full border transition-all duration-200 ${current.bg} ${current.glow} ${sizeClasses} ${className}`}
    >
      {dot && (
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${current.dot} ${pulse ? 'animate-pulse' : ''}`}
        />
      )}
      {label && <span className="opacity-75 uppercase tracking-wider">{label}</span>}
      {value && <span className="font-bold">{value}</span>}
    </div>
  );
}
