import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { Camera, Mail, Lock, Loader2 } from 'lucide-react';
import { auth } from '../services/firebase';
import { toast } from './Toast';

export const AuthScreen: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success('Welcome back');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        toast.success('Account created — you can start scanning');
      }
    } catch (err: any) {
      toast.error(err?.message?.replace('Firebase: ', '') || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      toast.success('Signed in with Google');
    } catch (err: any) {
      toast.error(err?.message?.replace('Firebase: ', '') || 'Google sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-canvas flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[50%] bg-brand/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[40%] bg-trust/20 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-elevated border border-line mb-5 shadow-card">
            <Camera className="text-brandsoft" size={26} />
          </div>
          <h1 className="font-display text-3xl text-ink tracking-tight mb-2">Curator Prime</h1>
          <p className="text-mute text-sm leading-relaxed max-w-xs mx-auto">
            Photograph a piece. Get ID, value range, authenticity notes, and care tips — then save it to your vault.
          </p>
        </div>

        <div className="bg-surface/90 border border-line rounded-3xl p-6 shadow-card backdrop-blur-xl">
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint ml-1">Email</span>
              <div className="relative mt-1.5">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" size={16} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-elevated border border-line text-ink text-sm outline-none focus:border-brandsoft/60"
                  placeholder="you@email.com"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint ml-1">Password</span>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" size={16} />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-elevated border border-line text-ink text-sm outline-none focus:border-brandsoft/60"
                  placeholder="••••••••"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3.5 rounded-2xl bg-brand hover:bg-brandsoft text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-glow"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-line" /></div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-widest text-faint">
              <span className="bg-surface px-3">or</span>
            </div>
          </div>

          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="w-full py-3.5 rounded-2xl border border-line bg-elevated/50 text-ink text-sm font-medium hover:bg-elevated transition-colors disabled:opacity-50"
          >
            Continue with Google
          </button>

          <p className="mt-6 text-center text-sm text-mute">
            {isLogin ? 'New here?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-brandsoft font-semibold hover:underline"
            >
              {isLogin ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>

        <p className="text-center text-[11px] text-faint mt-6 leading-relaxed">
          Free to try · Photos stay on your device until you save to vault
        </p>
      </div>
    </div>
  );
};
