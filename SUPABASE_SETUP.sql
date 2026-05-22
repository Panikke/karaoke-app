-- ============================================================
-- Karaoke App — Supabase Setup
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Profiles table (extends auth.users)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text,
  display_name     text,
  role             text NOT NULL DEFAULT 'pending'
                     CHECK (role IN ('admin', 'dj', 'viewer', 'pending')),
  can_edit_playlist boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 2. Auto-create a profile row whenever a new user signs up
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role, can_edit_playlist)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'pending',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 3. Row-Level Security (RLS)
-- -----------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone logged in can read all profiles
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can update their own display_name only
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can update any profile (role, can_edit_playlist, etc.)
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );


-- 4. Make yourself admin
-- -----------------------------------------------------------------
-- After you register for the first time, run this with YOUR email:
--
--   UPDATE public.profiles
--   SET role = 'admin', can_edit_playlist = true
--   WHERE email = 'your@email.com';
--
-- You only need to do this once. After that you can promote others
-- from the in-app Admin Dashboard.


-- 5. Optional: helper view for the admin dashboard
-- -----------------------------------------------------------------
CREATE OR REPLACE VIEW public.admin_users AS
  SELECT
    p.id,
    p.email,
    p.display_name,
    p.role,
    p.can_edit_playlist,
    p.created_at,
    u.last_sign_in_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id;

-- Grant read access to authenticated users (RLS on profiles still applies)
GRANT SELECT ON public.admin_users TO authenticated;
