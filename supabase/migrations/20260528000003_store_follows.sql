-- Create store_follows table
CREATE TABLE store_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (follower_id, store_id)
);

-- Indexes for performance
CREATE INDEX idx_store_follows_follower ON store_follows(follower_id);
CREATE INDEX idx_store_follows_store    ON store_follows(store_id);

-- Enable RLS
ALTER TABLE store_follows ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view store follows"
  ON store_follows FOR SELECT USING (true);

CREATE POLICY "Users can follow stores"
  ON store_follows FOR INSERT
  WITH CHECK ((select auth.uid()) = follower_id);

CREATE POLICY "Users can unfollow stores"
  ON store_follows FOR DELETE
  USING ((select auth.uid()) = follower_id);
