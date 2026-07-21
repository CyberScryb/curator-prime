import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User, LogOut, Mail, Calendar, ShieldCheck, AlertCircle } from 'lucide-react';

export const ProfileTerminal: React.FC = () => {
  const { user, userData, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="h-full flex flex-col bg-canvas overflow-auto p-6 pb-28">
      <div className="max-w-md mx-auto w-full pt-10">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-mute mb-1">Account</p>
        <h1 className="text-3xl font-display text-ink mb-8">Profile</h1>

        <div className="rounded-3xl border border-line bg-surface p-6 shadow-card mb-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-elevated border border-line overflow-hidden flex items-center justify-center">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User size={28} className="text-faint" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl text-ink truncate">
                {userData?.displayName || user.displayName || 'Collector'}
              </h2>
              <p className="text-sm text-mute truncate flex items-center gap-1.5 mt-0.5">
                <Mail size={12} /> {user.email}
              </p>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-line grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-faint mb-1 flex items-center gap-1">
                <Calendar size={11} /> Joined
              </div>
              <div className="text-ink">
                {userData?.createdAt
                  ? new Date(userData.createdAt).toLocaleDateString()
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-faint mb-1 flex items-center gap-1">
                <ShieldCheck size={11} /> Email
              </div>
              <div className={user.emailVerified ? 'text-emerald-400' : 'text-amber-400'}>
                {user.emailVerified ? 'Verified' : 'Not verified'}
              </div>
            </div>
          </div>
        </div>

        {!user.emailVerified && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 mb-4 flex gap-3">
            <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-mute">
              <p className="text-ink font-medium mb-1">Verify your email to save items</p>
              Check your inbox for a verification link so scans can be stored in your vault.
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-elevated p-4 text-sm text-mute mb-6 leading-relaxed">
          Curator Prime uses AI vision to identify items and estimate value ranges. Results are
          guidance for collectors — not a certified appraisal for insurance or tax.
        </div>

        <button
          onClick={() => logout()}
          className="w-full py-3.5 rounded-2xl border border-line bg-surface text-ink text-sm font-semibold flex items-center justify-center gap-2 hover:border-brand/40 transition-colors"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
};
