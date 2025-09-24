-- Add branch assignment to staff profiles
ALTER TABLE profiles ADD COLUMN branch_id UUID REFERENCES pharmacy_branches(id);

-- Update staff management policies to include branch filtering
CREATE OR REPLACE FUNCTION public.get_user_branch()
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM profiles WHERE id = auth.uid()
$$;