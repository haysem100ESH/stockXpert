ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS strips_per_pack integer NULL,
  ADD COLUMN IF NOT EXISTS units_per_strip integer NULL;

COMMENT ON COLUMN public.medicines.strips_per_pack IS 'Number of strips inside one pack (for blister-packed countable items). NULL = not strip-packaged.';
COMMENT ON COLUMN public.medicines.units_per_strip IS 'Number of individual units (e.g. tablets) per strip. units_per_pack = strips_per_pack * units_per_strip when both set.';
