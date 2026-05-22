import { useState, useEffect, useCallback } from 'react';
import { X, Shield, UserCheck, UserX, Loader2, RefreshCw, Check, ChevronDown } from 'lucide-react';
import { supabase, type Profile, type UserRole } from '../../lib/supabase';

interface AdminDashboardProps {
  onClose: () => void;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  dj: 'DJ',
  viewer: 'Viewer',
  pending: 'Pending',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-500/20 text-red-300 border-red-500/30',
  dj: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  viewer: 'bg-green-500/20 text-green-300 border-green-500/30',
  pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
};

const ALL_ROLES: UserRole[] = ['admin', 'dj', 'viewer', 'pending'];

export function AdminDashboard({ onClose }: AdminDashboardProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // profile id being saved
  const [error, setError] = useState('');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (err) setError(err.message);
    else setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!openDropdown) return;
    const handler = () => setOpenDropdown(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [openDropdown]);

  const updateProfile = async (
    id: string,
    patch: Partial<Pick<Profile, 'role' | 'can_edit_playlist'>>,
  ) => {
    setSaving(id);
    const { error: err } = await supabase.from('profiles').update(patch).eq('id', id);
    if (err) {
      setError(err.message);
    } else {
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    }
    setSaving(null);
  };

  const pendingCount = profiles.filter(p => p.role === 'pending').length;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-bold">Admin Dashboard</h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-full text-xs font-medium">
                {pendingCount} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadProfiles}
              disabled={loading}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Role legend */}
        <div className="px-6 py-3 border-b border-white/5 flex gap-3 flex-wrap text-xs flex-shrink-0">
          {ALL_ROLES.map(role => (
            <span key={role} className={`px-2.5 py-1 rounded-full border font-medium ${ROLE_COLORS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
          ))}
          <span className="text-gray-500 self-center ml-2">
            Admin = full access · DJ = edit playlists · Viewer = read-only · Pending = awaiting approval
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading users…
            </div>
          ) : profiles.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <UserX className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No users found.</p>
              <p className="text-sm mt-1">Users appear here after they register.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {profiles.map(profile => {
                const isSaving = saving === profile.id;
                return (
                  <div
                    key={profile.id}
                    className={`bg-black/30 border rounded-xl p-4 flex items-center gap-4 transition-all ${
                      profile.role === 'pending'
                        ? 'border-yellow-500/30'
                        : 'border-white/10'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 text-purple-300 font-semibold">
                      {(profile.display_name || profile.email || '?')[0].toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {profile.display_name || '—'}
                      </p>
                      <p className="text-sm text-gray-400 truncate">{profile.email}</p>
                    </div>

                    {/* Role dropdown */}
                    <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setOpenDropdown(openDropdown === profile.id ? null : profile.id)}
                        disabled={isSaving}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${ROLE_COLORS[profile.role]} hover:opacity-80`}
                      >
                        {isSaving
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : ROLE_LABELS[profile.role]
                        }
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>

                      {openDropdown === profile.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 bg-gray-800 border border-white/20 rounded-xl shadow-xl z-10 py-1 overflow-hidden">
                          {ALL_ROLES.map(role => (
                            <button
                              key={role}
                              onClick={() => {
                                setOpenDropdown(null);
                                updateProfile(profile.id, {
                                  role,
                                  // Auto-grant playlist editing for admin/dj
                                  can_edit_playlist: role === 'admin' || role === 'dj'
                                    ? true
                                    : profile.can_edit_playlist,
                                });
                              }}
                              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10 text-sm text-left transition-colors"
                            >
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[role]}`}>
                                {ROLE_LABELS[role]}
                              </span>
                              {profile.role === role && <Check className="w-3.5 h-3.5 text-purple-400" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Can edit playlist toggle */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => updateProfile(profile.id, { can_edit_playlist: !profile.can_edit_playlist })}
                        disabled={isSaving || profile.role === 'admin'}
                        title="Toggle playlist editing permission"
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          profile.can_edit_playlist || profile.role === 'admin'
                            ? 'bg-green-500/20 text-green-300 border-green-500/30 hover:bg-green-500/30'
                            : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {profile.can_edit_playlist || profile.role === 'admin'
                          ? <><UserCheck className="w-3.5 h-3.5" /> Playlist</>
                          : <><UserX className="w-3.5 h-3.5" /> Playlist</>
                        }
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-4 border-t border-white/10 flex-shrink-0">
          <p className="text-xs text-gray-500">
            {profiles.length} user{profiles.length !== 1 ? 's' : ''} total.
            To add new users: have them register on the app, then set their role here.
            You can also create users directly in the{' '}
            <span className="text-gray-400">Supabase dashboard → Authentication → Users</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
