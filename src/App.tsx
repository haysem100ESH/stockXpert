import React from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import Dashboard from "./pages/Dashboard";
import InventoryPage from "./pages/InventoryPage";
import SalesPage from "./pages/SalesPage";
import FinancePage from "./pages/FinancePage";
import SuppliersPage from "./pages/SuppliersPage";
import StaffPage from "./pages/StaffPage";
import AccountPage from "./pages/AccountPage";
import DeveloperPage from "./pages/DeveloperPage";
import BranchPage from "./pages/BranchPage";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

import { useState } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<Layout><SubscriptionGuard><Dashboard /></SubscriptionGuard></Layout>} />
              <Route path="/inventory" element={<Layout><SubscriptionGuard><InventoryPage /></SubscriptionGuard></Layout>} />
              <Route path="/sales" element={<Layout><SubscriptionGuard><SalesPage /></SubscriptionGuard></Layout>} />
              <Route path="/finance" element={<Layout><SubscriptionGuard><FinancePage /></SubscriptionGuard></Layout>} />
              <Route path="/suppliers" element={<Layout><SubscriptionGuard><SuppliersPage /></SubscriptionGuard></Layout>} />
              <Route path="/staff" element={<Layout><SubscriptionGuard><StaffPage /></SubscriptionGuard></Layout>} />
              <Route path="/branches" element={<Layout><SubscriptionGuard><BranchPage /></SubscriptionGuard></Layout>} />
              <Route path="/developer" element={<Layout><DeveloperPage /></Layout>} />
              <Route path="/account" element={<Layout><AccountPage /></Layout>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
