import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Package } from 'lucide-react';
import SalesManagement from '@/components/sales/SalesManagement';
import StaffInventoryView from '@/components/inventory/StaffInventoryView';

export default function StaffDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Staff Dashboard</h1>
      </div>

      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <ShoppingCart className="h-5 w-5" />
                <span>Sales Management</span>
              </CardTitle>
              <CardDescription>
                Process sales and manage customer transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SalesManagement />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Package className="h-5 w-5" />
                <span>Inventory View</span>
              </CardTitle>
              <CardDescription>
                View medicine inventory and update stock quantities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StaffInventoryView />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}