import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface PharmacyOwner {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  pharmacy_address?: string;
  active: boolean;
  subscription: {
    subscription_credit: number;
    status: string;
    deposit_amount: number;
  } | null;
}

interface EditOwnerDialogProps {
  owner: PharmacyOwner | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOwnerUpdated: () => void;
}

export default function EditOwnerDialog({ owner, open, onOpenChange, onOwnerUpdated }: EditOwnerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    pharmacy_address: '',
    active: true
  });
  const { toast } = useToast();

  useEffect(() => {
    if (owner) {
      setFormData({
        full_name: owner.full_name || '',
        phone: owner.phone || '',
        pharmacy_address: owner.pharmacy_address || '',
        active: owner.active
      });
    }
  }, [owner]);

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!owner || !formData.full_name) {
      toast({
        title: "Error",
        description: "Owner name is required",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          phone: formData.phone || null,
          pharmacy_address: formData.pharmacy_address || null
        })
        .eq('id', owner.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Owner information updated successfully"
      });
      
      onOpenChange(false);
      onOwnerUpdated();
    } catch (error: any) {
      console.error('Error updating owner:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update owner information",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  if (!owner) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Owner: {owner.full_name}</DialogTitle>
          <DialogDescription>
            Update pharmacy owner information and account status
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="full_name">Owner Name *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => handleInputChange('full_name', e.target.value)}
              placeholder="Enter owner's full name"
              required
            />
          </div>

          <div>
            <Label htmlFor="email">Email (Read-only)</Label>
            <Input
              id="email"
              value={owner.email}
              disabled
              className="bg-muted"
            />
          </div>

          <div>
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div>
            <Label htmlFor="pharmacy_address">Pharmacy Address</Label>
            <Textarea
              id="pharmacy_address"
              value={formData.pharmacy_address}
              onChange={(e) => handleInputChange('pharmacy_address', e.target.value)}
              placeholder="123 Main St, City, State 12345"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}