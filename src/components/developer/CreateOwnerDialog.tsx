import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Loader2, Trash2 } from 'lucide-react';

interface CreateOwnerDialogProps {
  onOwnerCreated: () => void;
}

export default function CreateOwnerDialog({ onOwnerCreated }: CreateOwnerDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    pharmacy_name: '',
    pharmacy_address: ''
  });
  const [creditPlans, setCreditPlans] = useState([{ days: 30, price: 50 }]);
  const { toast } = useToast();

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addCreditPlan = () => {
    setCreditPlans([...creditPlans, { days: 30, price: 50 }]);
  };

  const removeCreditPlan = (index: number) => {
    if (creditPlans.length > 1) {
      setCreditPlans(creditPlans.filter((_, i) => i !== index));
    }
  };

  const updateCreditPlan = (index: number, field: 'days' | 'price', value: number) => {
    const updated = [...creditPlans];
    updated[index] = { ...updated[index], [field]: value };
    setCreditPlans(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.full_name || !formData.email || !formData.password) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-pharmacy-owner', {
        body: { ...formData, creditPlans }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Pharmacy owner account created successfully"
      });

      setFormData({
        full_name: '',
        email: '',
        password: '',
        phone: '',
        pharmacy_name: '',
        pharmacy_address: ''
      });
      setCreditPlans([{ days: 30, price: 50 }]);
      
      setOpen(false);
      onOwnerCreated();
    } catch (error: any) {
      console.error('Error creating owner:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create pharmacy owner account",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Owner Account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Pharmacy Owner Account</DialogTitle>
          <DialogDescription>
            Create a new pharmacy owner account with full access credentials
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
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              placeholder="owner@pharmacy.com"
              required
            />
          </div>

          <div>
            <Label htmlFor="password">Password *</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              placeholder="Minimum 6 characters"
              required
              minLength={6}
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
            <Label htmlFor="pharmacy_name">Pharmacy Name</Label>
            <Input
              id="pharmacy_name"
              value={formData.pharmacy_name}
              onChange={(e) => handleInputChange('pharmacy_name', e.target.value)}
              placeholder="ABC Pharmacy"
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

          <div>
            <div className="flex items-center justify-between">
              <Label>Credit Plans</Label>
              <Button type="button" variant="outline" size="sm" onClick={addCreditPlan}>
                <Plus className="h-4 w-4 mr-1" />
                Add Plan
              </Button>
            </div>
            <div className="space-y-2 mt-2">
              {creditPlans.map((plan, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Days"
                    value={plan.days}
                    onChange={(e) => updateCreditPlan(index, 'days', parseInt(e.target.value) || 0)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">days →</span>
                  <span className="text-sm">$</span>
                  <Input
                    type="number"
                    placeholder="Price"
                    value={plan.price}
                    onChange={(e) => updateCreditPlan(index, 'price', parseFloat(e.target.value) || 0)}
                    className="w-20"
                  />
                  {creditPlans.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCreditPlan(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}