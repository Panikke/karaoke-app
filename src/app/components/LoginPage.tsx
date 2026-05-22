import { useState } from 'react';
import { Music, LogIn, UserPlus, Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface LoginPageProps {
  onClose: () => void;
}

type Mode = 'login' | 'register';

export function LoginPage({ onClose }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const inputCls =
    'w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-gray-500 ' +
    'focus:outline-none focus:border-purple-500 transition-colors';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onClose();
      } else {
        // Register — create auth user, then insert profile row
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;

        if (data.user) {
          // Upsert profile row (triggers may already create it)
          await supabase.from('profiles').upsert({
            id: data.user.id,
            email,
            display_name: displayName.trim() || email.split('@')[0],
            role: 'pending',
            can_edit_playlist: false,
          }, { onConflict: 'id' });
        }

        setSuccess(
          data.session
            ? 'Account created! You are logged in. An admin must activate your account before you can edit playlists.'
            : 'Account created! Check your email to confirm your address, then ask an admin to activate your account.',
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-sm shadow-2xl">

        {/* Header */}
        <div className="px-8 pt-8 pb-4 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-purple-500/20 mb-4">
            <Music className="w-7 h-7 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold mb-1">
            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-sm text-gray-400">
            {mode === 'login'
              ? 'Sign in to manage playlists and settings'
              : 'Register to request access from the admin'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 pb-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                className={inputCls}
              />
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className={`${inputCls} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          {success && (
            <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">{success}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-600 rounded-xl font-medium transition-all"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : mode === 'login'
              ? <LogIn className="w-4 h-4" />
              : <UserPlus className="w-4 h-4" />
            }
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Register'}
          </button>

          <div className="flex items-center gap-2 text-sm text-center">
            <span className="flex-1 border-t border-white/10" />
            <span className="text-gray-500">
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
            </span>
            <span className="flex-1 border-t border-white/10" />
          </div>

          <button
            type="button"
            onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); setSuccess(''); }}
            className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm transition-colors"
          >
            {mode === 'login' ? 'Create an account' : 'Sign in instead'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm text-gray-500 hover:text-gray-300 transition-colors py-1"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
