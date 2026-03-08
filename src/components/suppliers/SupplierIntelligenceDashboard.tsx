import { useState } from 'react';
import { useSupplierIntelligence, SupplierScore } from '@/hooks/useSupplierIntelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Truck, TrendingUp, AlertTriangle, DollarSign, Award, Search,
  RefreshCw, Shield, BarChart3, Users
} from 'lucide-react';
import SupplierScoreCard from './SupplierScoreCard';
import PriceComparisonTable from './PriceComparisonTable';
import SupplierDependenceChart from './SupplierDependenceChart';

export default function SupplierIntelligenceDashboard() {
  const {
    supplierScores, priceComparisons, dependenceRisks, riskySuppliers,
    loading, isPharmacy, refetch
  } = useSupplierIntelligence();
  const [search, setSearch] = useState('');

  const label = isPharmacy ? 'Medicine' : 'Item';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-muted-foreground text-lg">Analyzing supplier intelligence...</span>
      </div>
    );
  }

  const avgScore = supplierScores.length > 0
    ? Math.round(supplierScores.reduce((s, sup) => s + sup.overallScore, 0) / supplierScores.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Truck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Supplier Intelligence</h2>
            <p className="text-sm text-muted-foreground">
              Performance scoring, price comparison & smart purchasing
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <p className="text-2xl font-bold">{supplierScores.length}</p>
            <p className="text-xs text-muted-foreground">Total Suppliers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-2xl font-bold">{avgScore}%</p>
            <p className="text-xs text-muted-foreground">Avg Performance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-5 w-5 text-blue-500" />
            </div>
            <p className="text-2xl font-bold">{priceComparisons.length}</p>
            <p className="text-xs text-muted-foreground">{label}s Priced</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <p className="text-2xl font-bold">{riskySuppliers.length + dependenceRisks.length}</p>
            <p className="text-xs text-muted-foreground">Risk Alerts</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="scores" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
          <TabsTrigger value="scores" className="gap-1">
            <Award className="h-4 w-4" />
            <span className="hidden sm:inline">Scores</span>
          </TabsTrigger>
          <TabsTrigger value="prices" className="gap-1">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Prices</span>
          </TabsTrigger>
          <TabsTrigger value="dependence" className="gap-1">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Dependence</span>
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Risks</span>
            {(riskySuppliers.length + dependenceRisks.length) > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs h-5 px-1.5">
                {riskySuppliers.length + dependenceRisks.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scores">
          <div className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {supplierScores
                .filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
                .map(supplier => (
                  <SupplierScoreCard key={supplier.id} supplier={supplier} />
                ))}
            </div>
            {supplierScores.length === 0 && (
              <p className="text-muted-foreground text-center py-8">No suppliers found. Add suppliers to see intelligence data.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="prices">
          <PriceComparisonTable comparisons={priceComparisons} isPharmacy={isPharmacy} />
        </TabsContent>

        <TabsContent value="dependence">
          <SupplierDependenceChart suppliers={supplierScores} />
        </TabsContent>

        <TabsContent value="risks">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Risk Alerts
              </CardTitle>
              <CardDescription>Suppliers that need attention</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {riskySuppliers.length === 0 && dependenceRisks.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No risk alerts at this time.</p>
              ) : (
                <>
                  {riskySuppliers.map(s => (
                    <div key={`risky-${s.id}`} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Low performance score ({s.overallScore}%). Consider reviewing this supplier relationship.
                        </p>
                      </div>
                      <Badge variant="destructive">Score: {s.overallScore}</Badge>
                    </div>
                  ))}
                  {dependenceRisks.map(s => (
                    <div key={`dep-${s.id}`} className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Shield className="h-5 w-5 text-amber-500 shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-sm text-muted-foreground">
                          High dependence risk — {s.purchaseShare}% of your purchases come from this supplier.
                        </p>
                      </div>
                      <Badge variant="outline" className="text-amber-600">{s.purchaseShare}% share</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
