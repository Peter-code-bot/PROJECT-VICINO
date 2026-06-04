-- Migration: Add FCM Token to profiles
-- Date: 2026-06-04

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Create an index to quickly lookup users by their token if needed (optional)
CREATE INDEX IF NOT EXISTS idx_profiles_fcm_token ON public.profiles(fcm_token);
