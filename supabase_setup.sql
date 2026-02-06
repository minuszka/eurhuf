-- Snake Game Hall of Fame tábla létrehozása
-- Futtasd ezt a Supabase SQL Editor-ban!

CREATE TABLE IF NOT EXISTS public.snake_hof (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(5) NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index a gyorsabb rendezéshez
CREATE INDEX idx_snake_hof_score ON public.snake_hof (score DESC, created_at DESC);

-- RLS (Row Level Security) engedélyezése
ALTER TABLE public.snake_hof ENABLE ROW LEVEL SECURITY;

-- Mindenki olvashat
CREATE POLICY "Mindenki olvashat snake_hof-ot" 
  ON public.snake_hof
  FOR SELECT 
  USING (true);

-- Mindenki írhat (új rekord)
CREATE POLICY "Mindenki írhat snake_hof-ba" 
  ON public.snake_hof
  FOR INSERT 
  WITH CHECK (true);

-- Realtime engedélyezése (élő frissítés)
ALTER PUBLICATION supabase_realtime ADD TABLE public.snake_hof;
